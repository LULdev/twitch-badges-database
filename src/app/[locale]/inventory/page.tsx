import { getTranslations, setRequestLocale } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getInventory, listBadges } from "@/lib/queries";
import BadgeGrid from "@/components/badges/BadgeGrid";
import SyncButton from "@/components/inventory/SyncButton";
import TwitchLoginButton from "@/components/TwitchLoginButton";

export const dynamic = "force-dynamic";

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
    listBadges({ perPage: 96, sort: "rarity" }).catch(() => null),
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
                +{totalCatalog - ownedIds.size - missingBadges.length} more —
                sorted by rarity
              </p>
            )}
          </>
        ) : (
          <div className="card p-10 text-center text-sm text-muted">
            {t("emptyMissing")}
          </div>
        )}
      </section>
    </div>
  );
}
