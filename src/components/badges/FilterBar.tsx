"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { RARITY_TIERS } from "@/lib/rarity";

interface FilterBarProps {
  categories: string[];
  statusLocked?: string;
  showStatus?: boolean;
}

function buildHref(
  pathname: string,
  params: URLSearchParams,
  updates: Record<string, string | null>,
): string {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === "" || value === "all") {
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
}: FilterBarProps) {
  const t = useTranslations("common");
  const tr = useTranslations("rarity");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const current = {
    q: params.get("q") ?? "",
    status: statusLocked ?? params.get("status") ?? "all",
    price: params.get("price") ?? "all",
    category: params.get("category") ?? "all",
    rarity: params.get("rarity") ?? "all",
    sort: params.get("sort") ?? "newest",
  };

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
            defaultValue={current.q}
            placeholder={t("search")}
            className="input ps-9"
            aria-label={t("search")}
          />
        </div>

        {showStatus && !statusLocked && (
          <div className="flex gap-1" role="group" aria-label={t("filters")}>
            {statusOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`chip ${current.status === option.value ? "chip-active" : ""}`}
                onClick={() => navigate({ status: option.value })}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-1" role="group" aria-label={t("filters")}>
          {priceOptions.map((option) => (
            <button
              key={option.value}
              type="button"
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
          {categories.map((category) => (
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
          {RARITY_TIERS.map((tier) => (
            <option key={tier} value={tier}>
              {tr(tier)}
            </option>
          ))}
        </select>

        <select
          className="input w-auto py-2 text-xs"
          value={current.sort}
          onChange={(e) => navigate({ sort: e.target.value })}
          aria-label={t("sort")}
        >
          <option value="newest">{t("newest")}</option>
          <option value="oldest">{t("oldest")}</option>
          <option value="rarity">{t("rarest")}</option>
          <option value="owners">{t("mostOwned")}</option>
          <option value="ending">{t("endingSoon")}</option>
          <option value="releasing">{t("releasingSoon")}</option>
          <option value="name">{t("name")}</option>
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
