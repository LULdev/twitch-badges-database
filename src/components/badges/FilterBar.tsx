"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { RARITY_TIERS } from "@/lib/rarity";

interface FilterBarProps {
  categories: string[];
  statusLocked?: string;
  showStatus?: boolean;
  /** The sort the page's query falls back to when no ?sort= is set. */
  defaultSort?: string;
  /** The sort the page's query is actually applying (resolveSortKey). */
  sort?: string;
}

/** Keys whose "all" value is the clear sentinel (their <option value="all">).
 *  Free-text keys such as `q` are literal: searching "all" is a search. */
const ALL_SENTINEL_KEYS = new Set(["status", "price", "category", "rarity"]);

function buildHref(
  pathname: string,
  params: URLSearchParams,
  updates: Record<string, string | null>,
): string {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(updates)) {
    const clears =
      value === null ||
      value === "" ||
      (value === "all" && ALL_SENTINEL_KEYS.has(key));
    if (clears) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
  }
  next.delete("page");
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export default function FilterBar({
  categories,
  statusLocked,
  showStatus = true,
  defaultSort = "newest",
  sort,
}: FilterBarProps) {
  const t = useTranslations("common");
  const tr = useTranslations("rarity");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const priceOptions = [
    { value: "all", label: t("all") },
    { value: "free", label: t("free") },
    { value: "paid", label: t("paid") },
  ];
  const statusOptions = [
    { value: "all", label: t("all") },
    { value: "active", label: t("active") },
    { value: "upcoming", label: t("upcoming") },
    { value: "expired", label: t("expired") },
  ];
  const sortOptions = [
    { value: "newest", label: t("newest") },
    { value: "oldest", label: t("oldest") },
    { value: "rarity", label: t("rarest") },
    { value: "owners", label: t("mostOwned") },
    { value: "ending", label: t("endingSoon") },
    { value: "releasing", label: t("releasingSoon") },
    { value: "name", label: t("name") },
  ];

  // Every controlled value is validated against the option list it is rendered
  // from, and defaults to the page's own default.
  //  * An unknown `?sort=`/`?category=`/`?rarity=` used to be handed straight to
  //    `value=`, leaving the <select> with no matching <option> — React ends with
  //    selectedIndex -1 and the control renders blank — while the query silently
  //    fell back to "newest".
  //  * The sort control hardcoded "newest" as its fallback even on /active and
  //    /upcoming, whose queries default to "ending"/"releasing", so it labelled
  //    the grid with a sort it was not using.
  // A value that is NOT in the list (a stale ?category=bits, or a category the
  // catalog no longer has) is rendered as its own option instead of being folded
  // to "all": the query still filters on it, so showing "All" made the control
  // contradict the grid while leaving no way to switch away from it.
  const rawCategory = params.get("category") ?? "";
  const rawRarity = params.get("rarity") ?? "";
  const rawStatus = statusLocked ?? params.get("status") ?? "";
  const foreignCategories =
    rawCategory && rawCategory !== "all" && !categories.includes(rawCategory)
      ? [rawCategory]
      : [];
  const foreignRarity =
    rawRarity && !(RARITY_TIERS as readonly string[]).includes(rawRarity) && rawRarity !== "all"
      ? [rawRarity]
      : [];
  const foreignStatus =
    !statusLocked &&
    rawStatus &&
    rawStatus !== "all" &&
    !statusOptions.some((option) => option.value === rawStatus)
      ? [rawStatus]
      : [];

  const current = {
    q: params.get("q") ?? "",
    status:
      statusLocked ??
      statusOptions.find((option) => option.value === rawStatus)?.value ??
      // `||`, not `??`: an absent ?status= normalises to "" above, and "" is not
      // nullish — `?? "all"` would return "", leaving NO chip pressed on the
      // default view. The category/rarity lines below use the same `||` form.
      (rawStatus || "all"),
    price:
      priceOptions.find((option) => option.value === params.get("price"))
        ?.value ?? "all",
    category: categories.includes(rawCategory) ? rawCategory : rawCategory || "all",
    rarity: (RARITY_TIERS as readonly string[]).includes(rawRarity)
      ? rawRarity
      : rawRarity || "all",
    // `sort` is resolved by the page through the SAME key list the query uses
    // (resolveSortKey in queries.ts), so the control cannot show a sort the query
    // is not applying. The local fallbacks only cover a caller that passes none.
    sort:
      sortOptions.find((option) => option.value === sort)?.value ??
      sortOptions.find((option) => option.value === defaultSort)?.value ??
      "newest",
  };

  const allCategories = [...categories, ...foreignCategories];
  const allRarity = [...(RARITY_TIERS as readonly string[]), ...foreignRarity];

  function navigate(updates: Record<string, string | null>) {
    startTransition(() => {
      router.push(buildHref(pathname, params, updates), { scroll: false });
    });
  }

  function onSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("q");
    navigate({ q: String(value ?? "") });
  }

  return (
    <div className={`card p-4 transition-opacity ${isPending ? "opacity-60" : ""}`}>
      <form onSubmit={onSearch} className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="pointer-events-none absolute inset-y-0 start-3 my-auto text-muted"
            aria-hidden
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="search"
            name="q"
            // Uncontrolled on purpose (the form submits a plain GET), but keyed
            // on the active query so clearing the filter actually empties the
            // field instead of leaving the old text in place.
            key={current.q}
            defaultValue={current.q}
            placeholder={t("search")}
            className="input ps-9"
            aria-label={t("search")}
          />
        </div>

        {showStatus && !statusLocked && (
          <div className="flex gap-1" role="group" aria-label={t("filterStatus")}>
            {statusOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={current.status === option.value}
                className={`chip ${current.status === option.value ? "chip-active" : ""}`}
                onClick={() => navigate({ status: option.value })}
              >
                {option.label}
              </button>
            ))}
            {foreignStatus.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed
                className="chip chip-active"
                onClick={() => navigate({ status: null })}
                title={t("clear")}
              >
                {value}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-1" role="group" aria-label={t("filterPrice")}>
          {priceOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={current.price === option.value}
              className={`chip ${current.price === option.value ? "chip-active" : ""}`}
              onClick={() => navigate({ price: option.value })}
            >
              {option.label}
            </button>
          ))}
        </div>
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          className="input w-auto py-2 text-xs"
          value={current.category}
          onChange={(e) => navigate({ category: e.target.value })}
          aria-label={t("category")}
        >
          <option value="all">
            {t("category")}: {t("all")}
          </option>
          {allCategories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>

        <select
          className="input w-auto py-2 text-xs"
          value={current.rarity}
          onChange={(e) => navigate({ rarity: e.target.value })}
          aria-label={t("rarity")}
        >
          <option value="all">
            {t("rarity")}: {t("all")}
          </option>
          {allRarity.map((tier) => (
            <option key={tier} value={tier}>
              {(RARITY_TIERS as readonly string[]).includes(tier) ? tr(tier) : tier}
            </option>
          ))}
        </select>

        <select
          className="input w-auto py-2 text-xs"
          value={current.sort}
          onChange={(e) => navigate({ sort: e.target.value })}
          aria-label={t("sort")}
        >
          {sortOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        {(current.q || params.get("price") || params.get("category") || params.get("rarity") || (!statusLocked && params.get("status"))) && (
          <button
            type="button"
            className="btn btn-ghost text-xs"
            onClick={() =>
              navigate({ q: null, price: null, category: null, rarity: null, status: null })
            }
          >
            {t("clear")}
          </button>
        )}
      </div>
    </div>
  );
}
