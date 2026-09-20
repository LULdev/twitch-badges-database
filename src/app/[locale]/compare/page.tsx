import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getCatalogKeys, type CatalogKeyRow } from "@/lib/queries";
import { fetchUserBadges } from "@/lib/twitch/perfil";
import CompareForm from "@/components/compare/CompareForm";
import { BadgeImage } from "@/components/badges/BadgeImage";
import RarityChip from "@/components/badges/RarityChip";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "compare" });
  return { title: t("title"), description: t("subtitle") };
}

function resolveOwned(
  badges: Array<{ setID: string; version: string }>,
  catalog: CatalogKeyRow[],
): { rows: CatalogKeyRow[]; channelBadges: number } {
  const byKey = new Map(
    catalog.map((row) => [`${row.set_id}:${row.version}`, row]),
  );
  const rows: CatalogKeyRow[] = [];
  let channelBadges = 0;
  for (const badge of badges) {
    const match = byKey.get(`${badge.setID}:${badge.version}`);
    if (match) rows.push(match);
    else channelBadges += 1;
  }
  return { rows, channelBadges };
}

export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ users?: string }>;
}) {
  const { locale } = await params;
  const [sp] = await Promise.all([searchParams]);
  setRequestLocale(locale);
  const t = await getTranslations("compare");

  const raw = (sp.users ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const [a, b] = raw;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("subtitle")}</p>
      </header>

      <CompareForm initialA={a ?? ""} initialB={b ?? ""} />

      {!a || !b ? (
        <div className="card p-10 text-center text-sm text-muted">{t("hint")}</div>
      ) : (
        <CompareResult a={a} b={b} />
      )}
    </div>
  );
}

async function CompareResult({
  a,
  b,
}: {
  a: string;
  b: string;
}) {
  const t = await getTranslations("compare");

  const [perfilA, perfilB, catalog] = await Promise.all([
    fetchUserBadges(a, 120).catch(() => null),
    fetchUserBadges(b, 120).catch(() => null),
    getCatalogKeys().catch(() => [] as CatalogKeyRow[]),
  ]);

  if (!perfilA || !perfilB) {
    const missing = !perfilA ? a : b;
    return (
      <div className="card p-10 text-center text-sm text-muted">
        {t("notFound", { user: missing })}
      </div>
    );
  }

  const resolvedA = resolveOwned(perfilA.badges, catalog);
  const resolvedB = resolveOwned(perfilB.badges, catalog);
  const keysA = new Set(resolvedA.rows.map((row) => row.id));
  const keysB = new Set(resolvedB.rows.map((row) => row.id));
  const both = resolvedA.rows.filter((row) => keysB.has(row.id));
  const onlyA = resolvedA.rows.filter((row) => !keysB.has(row.id));
  const onlyB = resolvedB.rows.filter((row) => !keysA.has(row.id));

  const users = [
    {
      perfil: perfilA,
      total: resolvedA.rows.length,
      channel: resolvedA.channelBadges,
    },
    {
      perfil: perfilB,
      total: resolvedB.rows.length,
      channel: resolvedB.channelBadges,
    },
  ];

  const columns: Array<{
    id: string;
    title: string;
    rows: CatalogKeyRow[];
  }> = [
    { id: "both", title: t("ownedByBoth"), rows: both },
    { id: "onlyA", title: t("onlyLeft", { user: perfilA.displayName }), rows: onlyA },
    { id: "onlyB", title: t("onlyRight", { user: perfilB.displayName }), rows: onlyB },
  ];

  return (
    <div className="space-y-6">
      {/* Head-to-head cards */}
      <div className="grid items-stretch gap-3 sm:grid-cols-[1fr_auto_1fr]">
        {users.map((user, index) => (
          <div key={user.perfil.id} className={`card p-5 ${index === 1 ? "sm:order-3" : ""}`}>
            <div className="flex items-center gap-3">
              {user.perfil.profileImageURL ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.perfil.profileImageURL}
                  alt={user.perfil.displayName}
                  width={48}
                  height={48}
                  className="rounded-full"
                />
              ) : null}
              <div className="min-w-0">
                <p className="truncate font-bold">{user.perfil.displayName}</p>
                <p className="truncate text-xs text-muted">@{user.perfil.login}</p>
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-2 text-center">
              <div className="rounded-[var(--radius-input)] bg-surface-2 p-2">
                <dd className="text-xl font-extrabold tabular-nums">{user.total}</dd>
                <dt className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted">
                  {t("totalOwned")}
                </dt>
              </div>
              <div className="rounded-[var(--radius-input)] bg-surface-2 p-2">
                <dd className="text-xl font-extrabold tabular-nums">{user.channel}</dd>
                <dt className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted">
                  {t("channelBadges")}
                </dt>
              </div>
            </dl>
            <Link
              href={`/profile/${user.perfil.login}`}
              className="btn btn-secondary mt-4 w-full text-xs"
            >
              {user.perfil.displayName}
            </Link>
          </div>
        ))}
        <div
          className="grid place-items-center px-4 text-2xl font-black text-muted sm:order-2"
          aria-hidden
        >
          {t("vs")}
        </div>
      </div>

      {/* Diff columns */}
      {columns.map((column) => (
        <section key={column.id} aria-labelledby={`col-${column.id}`} className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 id={`col-${column.id}`} className="text-sm font-bold">
              {column.title}
            </h2>
            <span className="chip pointer-events-none">{column.rows.length}</span>
          </div>
          {column.rows.length > 0 ? (
            <div className="grid grid-cols-3 gap-2 p-4 sm:grid-cols-6 md:grid-cols-8">
              {column.rows.slice(0, 48).map((row) => (
                <Link
                  key={row.id}
                  href={`/badges/${row.slug}`}
                  className="badge-tile card-interactive rounded-[var(--radius-input)]"
                  title={row.title}
                >
                  <BadgeImage badge={row} size={36} />
                  <p className="line-clamp-2 text-[0.625rem] font-semibold leading-tight">
                    {row.title}
                  </p>
                  <RarityChip tier={row.rarity_tier} compact />
                </Link>
              ))}
            </div>
          ) : (
            <p className="p-6 text-center text-sm text-muted">—</p>
          )}
        </section>
      ))}
    </div>
  );
}
