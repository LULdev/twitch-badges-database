import { getTranslations } from "next-intl/server";
import { listBadges, getCategories, type ListFilters } from "@/lib/queries";
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

  const filters: ListFilters = {
    q: searchParams.q,
    status: statusLocked ?? searchParams.status,
    price: searchParams.price,
    category: searchParams.category,
    rarity: searchParams.rarity,
    sort: searchParams.sort ?? defaultSort,
    page: Number(searchParams.page ?? "1") || 1,
  };

  let result = null;
  let categories: string[] = [];
  try {
    [result, categories] = await Promise.all([
      listBadges(filters),
      getCategories(),
    ]);
  } catch {
    // DB not ready
  }

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
      />

      {result ? (
        <>
          <p className="text-xs font-semibold text-muted">
            {t("results", { count: result.total })}
          </p>
          {result.items.length > 0 ? (
            <BadgeGrid badges={result.items} />
          ) : (
            <div className="card p-10 text-center text-sm text-muted">
              {t("empty")}
            </div>
          )}
          <Pagination
            page={result.page}
            pages={result.pages}
            params={searchParams as Record<string, string | undefined>}
          />
        </>
      ) : (
        <div className="card p-10 text-center text-sm text-muted">
          {tc("setupHint")}
        </div>
      )}
    </div>
  );
}
