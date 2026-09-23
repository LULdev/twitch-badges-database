import { getTranslations } from "next-intl/server";
import { listBadges, getCategories, resolveSortKey, type ListFilters } from "@/lib/queries";
import BadgeGrid from "./BadgeGrid";
import FilterBar from "./FilterBar";
import Pagination from "./Pagination";

export interface ExplorerSearchParams {
  q?: string;
  status?: string;
  price?: string;
  category?: string;
  rarity?: string;
  sort?: string;
  page?: string;
}

/**
 * Shared catalog explorer used by /badges, /active, /upcoming and /expired.
 */
export default async function BadgeExplorer({
  title,
  subtitle,
  statusLocked,
  defaultSort,
  searchParams,
}: {
  title: string;
  subtitle: string;
  statusLocked?: string;
  defaultSort?: string;
  searchParams: ExplorerSearchParams;
}) {
  const t = await getTranslations("badges");
  const tc = await getTranslations("common");

  // One resolution point for the sort: the same key list feeds the query and the
  // FilterBar control, so the displayed sort can never differ from the applied one.
  const sort = resolveSortKey(searchParams.sort, defaultSort);

  const filters: ListFilters = {
    q: searchParams.q,
    status: statusLocked ?? searchParams.status,
    price: searchParams.price,
    category: searchParams.category,
    rarity: searchParams.rarity,
    sort,
    // Floored at the entry point: a fractional ?page= reached range() as a
    // non-integer offset (a 400, or a silently shifted window).
    page: Math.max(1, Math.floor(Number(searchParams.page ?? "1") || 1)),
  };

  // Both queries run concurrently, but each carries its own failure handling: the
  // category list only fills a dropdown, and it used to share one Promise.all with
  // the badge query, so a failure on the categories alone discarded a perfectly
  // good result set and showed the load-error card over it.
  const [badgeOutcome, categories] = await Promise.all([
    listBadges(filters).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
    getCategories().catch(() => [] as string[]),
  ]);

  let result = null;
  let loadFailed = false;
  if (badgeOutcome.ok) {
    result = badgeOutcome.value;
  } else {
    // This used to be swallowed: a real database error rendered the "catalog is
    // empty" setup hint, which reads as "there are no badges".
    loadFailed = true;
    console.warn("[badges] catalog load failed:", badgeOutcome.error);
  }

  // Distinguishes "the catalog is empty" (point at the sync) from "these filters
  // match nothing" (the ordinary empty state).
  const hasFilters = Boolean(
    searchParams.q ||
      (searchParams.category && searchParams.category !== "all") ||
      (searchParams.rarity && searchParams.rarity !== "all") ||
      (searchParams.price && searchParams.price !== "all") ||
      (!statusLocked && searchParams.status && searchParams.status !== "all"),
  );

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted">{subtitle}</p>
      </header>

      <FilterBar
        categories={categories}
        statusLocked={statusLocked}
        showStatus={!statusLocked}
        defaultSort={defaultSort}
        sort={sort}
      />

      {result ? (
        <>
          <p className="text-xs font-semibold text-muted">
            {t("results", { count: result.total })}
          </p>
          {result.items.length > 0 ? (
            <BadgeGrid badges={result.items} />
          ) : result.total === 0 && !hasFilters ? (
            // A reachable empty state: the catalog itself has no rows matching
            // nothing-filtered, so point at the sync. (The old `setupHint` branch
            // was dead — the ok flag was exhaustive — so an empty catalog said
            // "no badges match these filters" instead.)
            <div className="card p-10 text-center text-sm text-muted">
              {tc("setupHint")}
            </div>
          ) : (
            <div className="card p-10 text-center text-sm text-muted">
              {t("empty")}
            </div>
          )}
          <Pagination
            page={result.page}
            pages={result.pages}
            params={searchParams as Record<string, string | string[] | undefined>}
          />
        </>
      ) : loadFailed ? (
        <div className="card border-danger/40 bg-danger/10 p-10 text-center text-sm text-danger">
          {t("loadFailed")}
        </div>
      ) : null}
    </div>
  );
}
