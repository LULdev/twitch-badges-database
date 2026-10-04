import { getTranslations, setRequestLocale } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getInventory, listBadges } from "@/lib/queries";
import { readProgress } from "@/lib/gamification/xp";
import { getEconomy } from "@/lib/settings";
import { FREEZE_MAX } from "@/lib/gamification/items";
import BadgeGrid from "@/components/badges/BadgeGrid";
import SyncButton from "@/components/inventory/SyncButton";
import TwitchLoginButton from "@/components/TwitchLoginButton";
import CoinFlowCard, {
  coinFlowSince,
  fetchCoinRows,
} from "@/components/profile/CoinFlowCard";
import BestRoundsCard, {
  type BestRoundRow,
  type RecordHistoryEntry,
} from "@/components/profile/BestRoundsCard";
import ItemIcon, { ITEM_COLORS } from "@/components/items/ItemIcon";
import BuyFreezeButton from "@/components/items/BuyFreezeButton";

export const dynamic = "force-dynamic";

// Cold item-shelf state (one freeze left): fixed snow-dot geometry as a
// module literal — no randomness during render (React Compiler purity rule;
// identical on server and client, so hydration is stable). Mirrors the
// profile page's shelf.
const SNOW_DOTS = [
  { left: "7%", size: 4, delay: "-1.2s", duration: "9s" },
  { left: "26%", size: 3, delay: "-5.4s", duration: "11s" },
  { left: "48%", size: 5, delay: "-3.1s", duration: "8.5s" },
  { left: "69%", size: 3, delay: "-7.8s", duration: "10s" },
  { left: "88%", size: 4, delay: "-2.3s", duration: "12s" },
] as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "inventory" });
  return { title: t("title"), robots: { index: false } };
}

export default async function InventoryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("inventory");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <h1 className="text-2xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted">
          {t("loginRequired")}
        </p>
        <div className="mt-8">
          <TwitchLoginButton />
        </div>
      </div>
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("username, avatar_url, display_name")
    .eq("id", user.id)
    .maybeSingle();

  const [{ data: syncState }, inventory, catalog] = await Promise.all([
    supabase
      .from("user_sync_state")
      .select("last_synced_at, owned_count")
      .eq("user_id", user.id)
      .maybeSingle(),
    getInventory(user.id).catch(() => []),
    listBadges({ perPage: 96, sort: "rarity", status: "active" }).catch(() => null),
  ]);

  const ownedIds = new Set(
    inventory.map((item) => item.badge?.id).filter(Boolean) as string[],
  );
  const totalCatalog = catalog?.total ?? 0;

  // Owned badges from the inventory join; missing = rarest-first catalog slice.
  const ownedBadges = inventory
    .map((item) => item.badge)
    .filter(Boolean) as NonNullable<(typeof inventory)[number]["badge"]>[];
  const missingBadges = (catalog?.items ?? [])
    .filter((badge) => !ownedIds.has(badge.id))
    .slice(0, 48);

  const percent =
    totalCatalog > 0 ? Math.round((ownedIds.size / totalCatalog) * 100) : 0;

  // The three owner surfaces under the grids (coin flow, best rounds, item
  // shelf) read the same tables the profile page does. Same admin-client
  // split: user_items and activity_events are service-role reads because
  // user_id is not anon-readable (0040); the best-rounds view and the record
  // history RPC ride along on the same client. The viewer here is always the
  // owner — the inventory is auth-gated above — so the profile's privacy
  // flags (showCoins, inventory_public) do not apply to this page.
  const tp = await getTranslations("profile");
  const economy = await getEconomy();
  const admin = createAdminClient();
  const since = coinFlowSince();
  const [
    progressRow,
    coinRows,
    bestRows,
    recordHistory,
    itemsRes,
    rescuesRes,
    rescuesCountRes,
  ] = await Promise.all([
    readProgress(user.id).catch(() => null),
    fetchCoinRows(admin, user.id, since).catch(() => []),
    // PostgrestBuilder is only a PromiseLike (no .catch of its own), so both
    // view reads are lifted into a real Promise first — a network rejection
    // must degrade to an empty section, not 500 the page.
    Promise.resolve(
      admin
        .from("stats_player_best_rounds")
        .select("game,best_net,rounds")
        .eq("user_id", user.id)
        .order("best_net", { ascending: false }),
    )
      .then((r) => (r.data ?? []) as BestRoundRow[])
      .catch(() => [] as BestRoundRow[]),
    Promise.resolve(
      admin.rpc("player_record_history", { p_user: user.id, p_limit: 5 }),
    )
      .then((r) => (r.data ?? []) as RecordHistoryEntry[])
      .catch(() => [] as RecordHistoryEntry[]),
    admin
      .from("user_items")
      .select("item_key, quantity")
      .eq("user_id", user.id)
      .eq("item_key", "streak_freeze")
      .maybeSingle(),
    admin
      .from("activity_events")
      .select("created_at")
      .eq("user_id", user.id)
      .eq("kind", "streak_freeze")
      .order("created_at", { ascending: false })
      .limit(3),
    admin
      .from("activity_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("kind", "streak_freeze"),
  ]);
  const itemFreezes =
    (itemsRes.data as { quantity: number } | null)?.quantity ?? null;
  const rescueDates = ((rescuesRes.data ?? []) as Array<{ created_at: string }>).map(
    (row) => row.created_at,
  );
  const guardianRescues = rescuesCountRes.count ?? 0;

  return (
    <div className="space-y-8">
      <header className="card flex flex-col gap-4 p-6 sm:flex-row sm:items-center">
        <div className="flex items-center gap-4">
          {profile?.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.avatar_url}
              alt={profile.username ?? "avatar"}
              width={56}
              height={56}
              className="rounded-full"
            />
          ) : (
            <span className="grid size-14 place-items-center rounded-full bg-accent-soft text-lg font-bold text-accent">
              {(profile?.username ?? "?").slice(0, 2).toUpperCase()}
            </span>
          )}
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">{t("title")}</h1>
            <p className="text-sm text-muted">
              @{profile?.username ?? "…"} · {t("subtitle")}
            </p>
          </div>
        </div>
        <div className="sm:ms-auto">
          <SyncButton />
        </div>
      </header>

      <p className="text-xs text-muted">
        {syncState?.last_synced_at
          ? t("lastSync", {
              time: new Date(syncState.last_synced_at).toLocaleString(locale),
            })
          : t("neverSynced")}
      </p>

      {/* Progress */}
      <section className="card p-6">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-semibold">
            {t("progress", { owned: ownedIds.size, total: totalCatalog, percent })}
          </p>
        </div>
        <div
          className="mt-3 h-2.5 overflow-hidden rounded-full bg-surface-3"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${Math.min(100, percent)}%` }}
          />
        </div>
        <p className="mt-3 text-xs text-muted">{t("channelNote")}</p>
      </section>

      {/* Owned */}
      <section aria-labelledby="owned">
        <div className="section-title">
          <h2 id="owned">
            {t("owned")} ({ownedBadges.length})
          </h2>
        </div>
        {ownedBadges.length > 0 ? (
          <BadgeGrid badges={ownedBadges} showCountdown={false} />
        ) : (
          <div className="card p-10 text-center text-sm text-muted">
            {t("emptyOwned")}
          </div>
        )}
      </section>

      {/* Missing */}
      <section aria-labelledby="missing">
        <div className="section-title">
          <h2 id="missing">{t("missing")}</h2>
        </div>
        {missingBadges.length > 0 ? (
          <>
            <BadgeGrid badges={missingBadges} showCountdown={false} />
            {totalCatalog > ownedIds.size + missingBadges.length && (
              <p className="mt-3 text-center text-xs text-muted">
                {t("moreHidden", {
                  count: totalCatalog - ownedIds.size - missingBadges.length,
                })}
              </p>
            )}
          </>
        ) : (
          <div className="card p-10 text-center text-sm text-muted">
            {t("emptyMissing")}
          </div>
        )}
      </section>

      {/* Coin flow — the shared card, also rendered on the profile and the
          owner block of /stats. Gated on a progress row existing: a member
          who never earned a coin has no row and gets no zero-card. */}
      {progressRow && <CoinFlowCard rows={coinRows} id="inventory-coin-flow" />}

      {/* Best rounds — same owner tile row as the profile's, fed by the
          per-player aggregate view (0055) and the record-break RPC (0056). */}
      {bestRows.length > 0 && (
        <BestRoundsCard
          rows={bestRows}
          history={recordHistory}
          id="inventory-best-rounds"
        />
      )}

      {/* Item shelf — the profile's shelf markup, always own-view here (the
          inventory is auth-gated), so the buy button is self-service without
          a visibility flag. A member who burned every freeze keeps the shelf
          when rescue history exists; with one or zero left the stage runs the
          cold snow state. */}
      {itemFreezes !== null &&
        (itemFreezes > 0 || rescueDates.length > 0) && (
        <section
          className={`gal-stage card flex flex-col items-center gap-5 p-6 sm:flex-row sm:p-8${
            itemFreezes <= 1 ? " item-shelf-cold" : ""
          }`}
          style={{ ["--tier-color" as string]: ITEM_COLORS.streak_freeze }}
          aria-labelledby="inventory-items"
        >
          {itemFreezes <= 1 && (
            <span className="item-snow-field" aria-hidden="true">
              {SNOW_DOTS.map((dot) => (
                <span
                  key={dot.left}
                  className="item-snow"
                  style={{
                    left: dot.left,
                    width: dot.size,
                    height: dot.size,
                    animationDelay: dot.delay,
                    animationDuration: dot.duration,
                  }}
                />
              ))}
            </span>
          )}
          <figure className="gal-pedestal shrink-0">
            <span className="gal-halo" aria-hidden="true" />
            <div className="hero-emblem">
              <span className="hero-emblem-halo" aria-hidden="true" />
              <ItemIcon id="streak_freeze" />
            </div>
            <div className="gal-plinth" aria-hidden="true" />
            <span className="gal-plinth-shadow" aria-hidden="true" />
          </figure>
          <figcaption className="sr-only">{tp("itemShelf")}</figcaption>
          <div
            className="gal-placard card min-w-0 flex-1 p-5 text-center sm:text-start"
            id="inventory-items"
          >
            <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <span className="chip pointer-events-none font-bold text-accent">
                ×{itemFreezes}
              </span>
              <span
                className="chip pointer-events-none"
                title={tp("freezeExplain")}
                aria-label={tp("freezeExplain")}
                tabIndex={0}
              >
                {tp("freezeName")}
              </span>
              {/* Ice Guardian progress — the 5 mirrors the s_ice_guardian
                  threshold in achievements.ts; shown once rescue history exists. */}
              {guardianRescues > 0 && (
                <span className="chip pointer-events-none font-bold">
                  {tp("guardianProgress", { n: guardianRescues })}
                </span>
              )}
            </div>
            <h2 className="mt-3 text-lg font-extrabold tracking-tight">
              {tp("itemShelf")}
            </h2>
            <p className="mt-1 text-sm text-muted">{tp("freezeExplain")}</p>
            {rescueDates.length > 0 && (
              <p className="mt-1 text-xs text-muted">
                {tp("freezeHistory", {
                  dates: rescueDates
                    .map((d) =>
                      new Date(d).toLocaleDateString(locale, { dateStyle: "medium" }),
                    )
                    .join(" · "),
                })}
              </p>
            )}
            {itemFreezes >= FREEZE_MAX ? (
              <p className="mt-2 text-xs text-muted">
                {tp("buyCapped", { max: FREEZE_MAX })}
              </p>
            ) : (
              <div className="mt-2">
                <BuyFreezeButton
                  price={economy.freezePrice}
                  canAfford={(progressRow?.coins ?? 0) >= economy.freezePrice}
                  max={FREEZE_MAX}
                />
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
