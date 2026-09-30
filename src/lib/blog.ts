import { createAdminClient } from "./supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RarityTier } from "./rarity";

export interface AutoPostBadgeInfo {
  slug: string;
  title: string;
  setId: string;
  imageUrl2x: string | null;
  category: string;
  isPaid: boolean;
  howToEarn: string | null;
  startDate: string | null;
  endDate: string | null;
  rarityTier: RarityTier;
  rarityScore: number;
  /** Helix occasionally ships one; badgebase-discovered rows always have it. */
  description?: string | null;
}

/**
 * Free context the global sync already holds in memory when a drop is
 * detected — feeds the category-context and co-drop sections of the article.
 */
export interface DropPostContext {
  detectedAt?: string;
  source?: string;
  catalogTotal?: number;
  categoryCount?: number;
  categoryActive?: number;
  coDropTitles?: string[];
}

/** House floor for auto articles — the owner's explicit requirement. */
const MIN_CONTENT_CHARS = 600;

const GENERIC_CONTEXT_BLOCK = [
  "## About this tracker",
  "",
  "This database catalogs every global Twitch badge with live owner statistics, a six-signal rarity index (TBRI), claim windows and drop history. Catalog scans run daily, owner statistics refresh throughout the day, and every catalog change is recorded with a timestamp in the [changelog](/en/changelog). Browse all current drops on the [active list](/en/active) or explore the numbers on the [statistics dashboard](/en/stats).",
].join("\n");

function formatDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString().slice(0, 10);
}

/**
 * Pure article builder so the length floor is testable without a DB.
 * Every section has an unconditional fallback: at drop-detection time the
 * badgebase/potat passes have not enriched the row yet, so howToEarn/dates
 * are usually null and rarity still sits at its DB default — the template
 * must stand on its own in exactly that case.
 */
export function buildDropArticle(
  badge: AutoPostBadgeInfo,
  context: DropPostContext = {},
): { content: string; excerpt: string } {
  const detected = context.detectedAt
    ? formatDate(context.detectedAt)
    : new Date().toISOString().slice(0, 10);
  const catalogTotal = context.catalogTotal;

  const sections: string[] = [];

  sections.push(
    `A new global Twitch badge just went live: **${badge.title}** (\`${badge.setId}\`). Our catalog scan picked it up on ${detected}${context.source ? ` from the ${context.source} feed` : ""} and it is now tracked in the ${badge.category} category${catalogTotal ? ` alongside ${Math.max(0, catalogTotal - 1)} other badges` : ""}. This automatic drop alert sums up what is confirmed so far, what is still unknown, and where to follow the live numbers as they come in.`,
  );

  sections.push("## What this badge is");
  if (badge.description) {
    sections.push(badge.description);
  } else {
    sections.push(
      `Twitch has not published an official description for this set yet. The badge is registered in the global catalog under the set ID \`${badge.setId}\`, which means it is not limited to a single channel: once a viewer earns it, it can appear next to their name in any chat on the platform. Global badges like this are the ones collectors track, because they keep working everywhere on Twitch.`,
    );
  }

  sections.push("## How to earn it");
  if (badge.howToEarn) {
    sections.push(`**Requirements:** ${badge.howToEarn}`);
  } else {
    sections.push(
      `The exact unlock steps are not documented yet. Our drop-window tracker refreshes daily from the badge listing feed, and this article does not change after publication — the [badge page](/en/badges/${badge.slug}) always shows the current claim status and requirements the moment we have them.`,
    );
  }

  sections.push("## Rarity assessment");
  if (badge.rarityScore > 0 && badge.rarityTier !== "common") {
    sections.push(
      `The Twitch Badge Rarity Index (TBRI) currently rates **${badge.title}** at **${badge.rarityScore}/100 — ${badge.rarityTier}**. The score blends six signals — scarcity of ownership, wear (how many owners still wear it), obtainability, age, 24-hour momentum, and the brevity of the claim window — so it moves as owner statistics are polled.`,
    );
  } else {
    sections.push(
      `This drop is brand new and has not been rated yet — fresh badges start at the bottom of the scale until owner statistics are polled. The [badge page](/en/badges/${badge.slug}) shows the live score as soon as the first poll lands; expect it to settle within a day.`,
    );
  }

  sections.push("## Claim window");
  if (badge.startDate && badge.endDate) {
    sections.push(
      `Redeemable from **${formatDate(badge.startDate)}** until **${formatDate(badge.endDate)}** (UTC). Once the window closes, the badge moves to the expired archive — earned copies stay visible, but no new ones can be claimed.`,
    );
  } else if (badge.endDate) {
    sections.push(
      `Redeemable until **${formatDate(badge.endDate)}** (UTC). Once the window closes, the badge moves to the expired archive — earned copies stay visible, but no new ones can be claimed.`,
    );
  } else if (badge.startDate) {
    sections.push(
      `Redeemable from **${formatDate(badge.startDate)}** (UTC); no end date has been announced, so the drop may be open-ended.`,
    );
  } else {
    sections.push(
      `No start or end date has been published for this badge yet. Some drops are permanent once earned, others are only redeemable during a short event window — until an official claim window is confirmed, treat availability as unverified and watch the [active drops list](/en/active).`,
    );
  }

  sections.push("## Category context");
  const catCount = context.categoryCount;
  const catActive = context.categoryActive;
  if (catCount && catCount > 1) {
    sections.push(
      `The ${badge.category} category currently tracks **${catCount} badges** in our database${catActive != null ? `, ${catActive} of them redeemable right now` : ""}. **${badge.title}** sits alongside the rest of the group — the [category listing](/en/badges?category=${encodeURIComponent(badge.category)}) is the fastest way to compare artwork and rarity at a glance.`,
    );
  } else {
    sections.push(
      `**${badge.title}** is the first badge we track in the ${badge.category} category. The [category listing](/en/badges?category=${encodeURIComponent(badge.category)}) shows everything that joins it from here on.`,
    );
  }

  const coDrops = (context.coDropTitles ?? []).filter((t) => t !== badge.title);
  sections.push("## Where to go next");
  sections.push(
    [
      `Full details, live owner counts and the claim countdown (once a window is confirmed) live on the [badge page](/en/badges/${badge.slug}). The [blog](/en/blog) covers every drop we detect, and the [changelog](/en/changelog) records every catalog change with a timestamp.`,
      coDrops.length > 0 ? `This wave also detected: ${coDrops.slice(0, 5).join(", ")}${coDrops.length > 5 ? " and others" : ""}.` : "",
    ]
      .filter(Boolean)
      .join(" "),
  );

  sections.push(
    `**Availability:** unverified · **Cost:** ${badge.isPaid ? "Paid" : "Free"} · **Set:** \`${badge.setId}\``,
  );

  let content = sections.join("\n\n");
  if (content.length < MIN_CONTENT_CHARS) {
    content += `\n\n${GENERIC_CONTEXT_BLOCK}`;
  }

  const excerpt = `A new global Twitch badge went live: ${badge.title} (${badge.setId}). What is confirmed, what is still unknown, and where to follow the live rarity and claim-window numbers.`;

  return { content, excerpt };
}

/**
 * Auto-publish a "new badge drop" blog post when the catalog sync detects a
 * badge for the first time. Marked is_auto so editors can tell machine posts
 * from editorial ones. The article is guaranteed >= 600 characters
 * (MIN_CONTENT_CHARS): the builder appends a fixed context block if a
 * template regression ever drops below the floor (defense in depth — with the
 * current template the worst case is ~2,100 chars).
 *
 * Returns whether a post was published this call (false on failure OR on an
 * idempotent re-run) so the sync can count fan-out failures.
 */
export async function createDropPost(
  badge: AutoPostBadgeInfo,
  client?: SupabaseClient,
  context: DropPostContext = {},
): Promise<boolean> {
  try {
    const supabase = client ?? createAdminClient();
    const { content, excerpt } = buildDropArticle(badge, context);
    if (content.length < MIN_CONTENT_CHARS) {
      // Should be unreachable — the builder appends the fallback itself.
      console.warn(
        "[blog] drop post length guard fired for",
        badge.slug,
        `(${content.length} chars)`,
      );
    }
    // `.select("id")` so the changelog row below only fires on a real insert
    // (ignoreDuplicates makes a re-run write nothing — same contract as
    // createFeaturePost).
    const { data: inserted, error } = await supabase
      .from("blog_posts")
      .upsert(
        {
          slug: `drop-${badge.slug}`,
          title: `New badge drop: ${badge.title}`,
          excerpt,
          content,
          cover_url: badge.imageUrl2x,
          status: "published",
          is_auto: true,
          tags: ["drop", badge.category],
        },
        { onConflict: "slug", ignoreDuplicates: true },
      )
      .select("id");
    if (error) throw error;
    if (!inserted || inserted.length === 0) return false;
    await supabase
      .from("changelog")
      .insert({
        kind: "blog",
        title: `Blog post published: New badge drop: ${badge.title}`,
        body: excerpt,
        payload: { slug: `drop-${badge.slug}`, chars: content.length },
      })
      .then(() => undefined, () => undefined);
    return true;
  } catch (error) {
    console.warn("[blog] auto drop post failed:", error);
    return false;
  }
}

export interface FeaturePostInput {
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  tags?: string[];
  cover?: string | null;
}

/**
 * Auto-publish a blog post for a shipped feature, game or special event
 * (turbo jackpot, …). Idempotent by slug.
 */
export async function createFeaturePost(post: FeaturePostInput): Promise<void> {
  const supabase = createAdminClient();
  // `.select("id")` makes the upsert report whether it inserted: with
  // `ignoreDuplicates` a re-run writes nothing, but the changelog row below was
  // written unconditionally, so every call claimed a publication that had not
  // happened (the live table held 139 of these rows under 24 distinct titles).
  const { data: inserted, error } = await supabase
    .from("blog_posts")
    .upsert(
      {
        slug: post.slug,
        title: post.title,
        excerpt: post.excerpt,
        content: post.content,
        cover_url: post.cover ?? null,
        status: "published",
        is_auto: true,
        tags: ["feature", ...(post.tags ?? [])],
      },
      { onConflict: "slug", ignoreDuplicates: true },
    )
    .select("id");
  if (error) throw error;
  if (!inserted || inserted.length === 0) return;
  await supabase.from("changelog").insert({
    kind: "blog",
    title: `Blog post published: ${post.title}`,
    body: post.excerpt,
    payload: { slug: post.slug },
  }).then(() => undefined, () => undefined);
}
