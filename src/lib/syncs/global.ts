import { createAdminClient } from "@/lib/supabase/admin";
import { fetchGlobalBadgeCatalog } from "@/lib/twitch/catalog";
import {
  badgeSlug,
  badgeStatus,
  guessCategory,
  type BadgeVersionSource,
} from "@/lib/twitch/types";
import { logChange } from "@/lib/changelog";
import { createDropPost } from "@/lib/blog";
import { sendPushToAll, recordNotification } from "@/lib/push";

export interface GlobalSyncSummary {
  source: "helix" | "ivr";
  versions: number;
  added: number;
  updated: number;
  removed: number;
  statusChanged: number;
  addedTitles: string[];
}

interface ExistingBadge {
  id: string;
  set_id: string;
  version: string;
  slug: string;
  title: string;
  description: string | null;
  image_url_1x: string | null;
  image_url_2x: string | null;
  image_url_4x: string | null;
  click_url: string | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  removed_at: string | null;
}

const PAID_SET_PATTERNS =
  /subtember|paid|premium|turbo|all.?access|pass|sub-?gift/i;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export async function runGlobalSync(): Promise<GlobalSyncSummary> {
  const supabase = createAdminClient();
  const { sets, source } = await fetchGlobalBadgeCatalog();
  const incoming: BadgeVersionSource[] = sets.flatMap((set) => set.versions);

  // Load the full current catalog (paginated).
  const existing = new Map<string, ExistingBadge>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("badges")
      .select(
        "id,set_id,version,slug,title,description,image_url_1x,image_url_2x,image_url_4x,click_url,status,start_date,end_date,removed_at",
      )
      .range(offset, offset + 999);
    if (error) throw error;
    for (const row of (data ?? []) as ExistingBadge[]) {
      existing.set(`${row.set_id}:${row.version}`, row);
    }
    if (!data || data.length < 1000) break;
  }

  const now = new Date();
  const incomingKeys = new Set(incoming.map((v) => `${v.setId}:${v.version}`));

  const addedTitles: string[] = [];
  let updated = 0;
  let statusChanged = 0;

  type UpsertRow = Record<string, unknown>;
  const upserts: UpsertRow[] = [];

  for (const v of incoming) {
    const key = `${v.setId}:${v.version}`;
    const ex = existing.get(key);

    if (!ex) {
      const status = "active"; // refined below by dates, and by badgebase sync
      const slug = badgeSlug(v.setId, v.version);
      upserts.push({
        set_id: v.setId,
        version: v.version,
        slug,
        title: v.title?.trim() || `${v.setId} ${v.version}`,
        description: v.description,
        image_url_1x: v.imageUrl1x,
        image_url_2x: v.imageUrl2x,
        image_url_4x: v.imageUrl4x,
        click_url: v.clickUrl,
        category: guessCategory(v.setId),
        is_paid: PAID_SET_PATTERNS.test(v.setId),
        status,
        source: source === "helix" ? "helix" : "ivr",
        first_seen_at: now.toISOString(),
        last_seen_at: now.toISOString(),
      });
      addedTitles.push(v.title?.trim() || v.setId);
      continue;
    }

    // Existing badge: refresh fields, restore removed badges, refresh status.
    const patch: UpsertRow = { last_seen_at: now.toISOString() };
    const fieldChanged =
      (v.title?.trim() || "") !== ex.title ||
      (v.description ?? null) !== ex.description ||
      (v.imageUrl1x ?? null) !== ex.image_url_1x ||
      (v.imageUrl2x ?? null) !== ex.image_url_2x ||
      (v.imageUrl4x ?? null) !== ex.image_url_4x ||
      (v.clickUrl ?? null) !== ex.click_url;
    if (fieldChanged) {
      patch.title = v.title?.trim() || ex.title;
      patch.description = v.description;
      patch.image_url_1x = v.imageUrl1x;
      patch.image_url_2x = v.imageUrl2x;
      patch.image_url_4x = v.imageUrl4x;
      patch.click_url = v.clickUrl;
      updated += 1;
    }

    const nextStatus = ex.removed_at
      ? "active" // reappeared: restock
      : badgeStatus(
          { start_date: ex.start_date, end_date: ex.end_date },
          now,
        );
    if (ex.removed_at || ex.status !== nextStatus) {
      patch.status = nextStatus;
      patch.removed_at = null;
      statusChanged += 1;
    }

    upserts.push({ ...patch, set_id: v.setId, version: v.version });
  }

  // Badges missing from the live catalog are marked removed.
  const removed: Array<{ id: string; title: string }> = [];
  for (const [key, ex] of existing) {
    if (!incomingKeys.has(key) && ex.status !== "removed") {
      removed.push({ id: ex.id, title: ex.title });
    }
  }

  for (const batch of chunk(upserts, 200)) {
    const { error } = await supabase
      .from("badges")
      .upsert(batch, { onConflict: "set_id,version" });
    if (error) throw error;
  }

  if (removed.length > 0) {
    for (const batch of chunk(removed, 200)) {
      const { error } = await supabase
        .from("badges")
        .update({
          status: "removed",
          removed_at: now.toISOString(),
        })
        .in(
          "id",
          batch.map((r) => r.id),
        );
      if (error) throw error;
    }
  }

  // History events + changelog + blog + push for newly added badges.
  // The very first run populates the whole catalog at once — treat it as a
  // seed, not as a drop wave (no per-badge blog posts, no push blast).
  const isInitialSeed = existing.size === 0 && addedTitles.length > 0;
  if (addedTitles.length > 0) {
    const { data: fresh } = await supabase
      .from("badges")
      .select(
        "id,slug,title,set_id,image_url_2x,category,is_paid,how_to_earn,start_date,end_date,rarity_tier,rarity_score",
      )
      .in("set_id", incoming.map((v) => v.setId))
      .order("first_seen_at", { ascending: false })
      .limit(addedTitles.length + 10);

    const freshRows = (fresh ?? []) as Array<{
      id: string;
      slug: string;
      title: string;
      set_id: string;
      image_url_2x: string | null;
      category: string;
      is_paid: boolean;
      how_to_earn: string | null;
      start_date: string | null;
      end_date: string | null;
      rarity_tier: "common";
      rarity_score: number;
    }>;

    if (freshRows.length > 0) {
      await supabase.from("badge_events").insert(
        freshRows.map((row) => ({
          badge_id: row.id,
          kind: "added" as const,
          detail: { source, set_id: row.set_id },
        })),
      );
      if (!isInitialSeed) {
        for (const row of freshRows) {
          await createDropPost(
            {
              slug: row.slug,
              title: row.title,
              setId: row.set_id,
              imageUrl2x: row.image_url_2x,
              category: row.category,
              isPaid: row.is_paid,
              howToEarn: row.how_to_earn,
              startDate: row.start_date,
              endDate: row.end_date,
              rarityTier: row.rarity_tier,
              rarityScore: row.rarity_score,
            },
            supabase,
          );
        }
      }
    }

    await logChange(
      {
        kind: "badge_added",
        title: isInitialSeed
          ? `Initial catalog seeded: ${addedTitles.length} badges`
          : addedTitles.length === 1
            ? `New badge: ${addedTitles[0]}`
            : `${addedTitles.length} new badges detected`,
        body: isInitialSeed
          ? `First catalog import from the Twitch API (source: ${source}).`
          : addedTitles.slice(0, 12).join(", "),
        payload: { source, initialSeed: isInitialSeed, titles: addedTitles.slice(0, 50) },
      },
      supabase,
    );

    // Desktop notification: "new badge is live" — skipped on initial seed.
    if (!isInitialSeed) {
      const first = freshRows[0];
      const url = `/en/badges/${first?.slug ?? ""}`;
      await recordNotification({
        kind: "badge_added",
        title:
          addedTitles.length === 1
            ? `New Twitch badge: ${addedTitles[0]}`
            : `${addedTitles.length} new Twitch badges just went live`,
        body: addedTitles.slice(0, 5).join(", "),
        url,
        tag: "new-badges",
      }).catch((err) => console.warn("[notify] failed:", err));
      await sendPushToAll({
        title:
          addedTitles.length === 1
            ? `New Twitch badge: ${addedTitles[0]}`
            : `${addedTitles.length} new Twitch badges just went live`,
        body: addedTitles.slice(0, 5).join(", "),
        url,
        tag: "new-badges",
      }).catch((err) => console.warn("[push] failed:", err));
    }
  }

  if (updated > 0) {
    await logChange(
      {
        kind: "badge_updated",
        title: `${updated} badge${updated === 1 ? "" : "s"} updated`,
        body: "Metadata or artwork refreshed from the Twitch catalog.",
        payload: { count: updated },
      },
      supabase,
    );
  }
  if (removed.length > 0) {
    await supabase.from("badge_events").insert(
      removed.map((r) => ({
        badge_id: r.id,
        kind: "removed" as const,
        detail: null,
      })),
    );
    await logChange(
      {
        kind: "badge_removed",
        title: `${removed.length} badge${removed.length === 1 ? "" : "s"} no longer available`,
        body: removed.slice(0, 12).map((r) => r.title).join(", "),
        payload: { titles: removed.slice(0, 50).map((r) => r.title) },
      },
      supabase,
    );
  }
  if (statusChanged > 0 && addedTitles.length === 0 && updated === 0 && removed.length === 0) {
    // Only log pure status sweeps when nothing else was logged this run.
    await logChange(
      {
        kind: "badge_updated",
        title: `${statusChanged} badge status transition${statusChanged === 1 ? "" : "s"}`,
        body: "Availability windows started or expired.",
        payload: { count: statusChanged },
      },
      supabase,
    );
  }

  await logChange(
    {
      kind: "data_sync",
      title: "Catalog sync completed",
      body: `Source: ${source}. ${incoming.length} versions checked, ${addedTitles.length} added, ${updated} updated, ${removed.length} removed, ${statusChanged} status changes.`,
      payload: {
        source,
        versions: incoming.length,
        added: addedTitles.length,
        updated,
        removed: removed.length,
        statusChanged,
        ranAt: now.toISOString(),
      },
    },
    supabase,
  );

  return {
    source,
    versions: incoming.length,
    added: addedTitles.length,
    updated,
    removed: removed.length,
    statusChanged,
    addedTitles,
  };
}
