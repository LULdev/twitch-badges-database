import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";

/**
 * Server-rendered pagination preserving all current query params.
 * Reads searchParams passed by the page (Next 16: already awaited).
 */
export default function Pagination({
  page,
  pages,
  params,
}: {
  page: number;
  pages: number;
  params: Record<string, string | string[] | undefined>;
}) {
  const t = useTranslations("common");
  if (pages <= 1) return null;

  const href = (target: number) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      // A repeated key (?q=a&q=b) arrives as an array, and the filter control and
      // the query both use the FIRST value — `set(key, array)` stringified it to
      // "a,b", so page 2 filtered on a different term than page 1.
      const first = Array.isArray(value) ? value[0] : value;
      if (first && key !== "page") next.set(key, first);
    }
    if (target > 1) next.set("page", String(target));
    const query = next.toString();
    return query ? `?${query}` : "?";
  };

  const windowed = Array.from({ length: pages }, (_, i) => i + 1).filter(
    (p) => p === 1 || p === pages || Math.abs(p - page) <= 1,
  );

  return (
    <nav
      className="mt-6 flex items-center justify-center gap-1.5"
      aria-label={t("page", { page, pages })}
    >
      {page > 1 ? (
        <Link href={href(page - 1)} className="btn btn-secondary text-xs">
          <span className="dir-arrow" aria-hidden>←</span> {t("prev")}
        </Link>
      ) : null}
      {windowed.map((p, index) => (
        <span key={p} className="flex items-center gap-1.5">
          {index > 0 && p - windowed[index - 1] > 1 && (
            <span className="text-muted">…</span>
          )}
          <Link
            href={href(p)}
            className={`btn text-xs ${p === page ? "btn-primary" : "btn-ghost"}`}
            aria-current={p === page ? "page" : undefined}
          >
            {p}
          </Link>
        </span>
      ))}
      {page < pages ? (
        <Link href={href(page + 1)} className="btn btn-secondary text-xs">
          {t("next")} <span className="dir-arrow" aria-hidden>→</span>
        </Link>
      ) : null}
    </nav>
  );
}
