"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/**
 * Route-level error boundary. `getBadgeBySlug` now lets a real query failure
 * throw instead of reporting it as a missing badge, and there was no boundary
 * anywhere below `[locale]` — so a transient database hiccup produced the
 * framework's bare error screen. This keeps the user inside the site's own
 * design and gives them a retry.
 */
export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("common");

  useEffect(() => {
    // Surfaces in Vercel's runtime logs next to the digest the user can quote.
    console.error("[route error]", error.digest ?? "", error.message);
  }, [error]);

  return (
    <div className="mx-auto max-w-xl py-24 text-center">
      <div className="mx-auto grid size-12 place-items-center rounded-full border border-line bg-surface-2 text-danger">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
          <path d="M12 8.5v5" />
          <circle cx="12" cy="16.6" r="0.9" fill="currentColor" stroke="none" />
          <path d="M10.3 3.9 2.6 17.4a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
        </svg>
      </div>
      <h1 className="mt-5 text-2xl font-bold tracking-tight">{t("errorTitle")}</h1>
      <p className="mt-3 text-sm text-muted">{t("errorBody")}</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button type="button" onClick={reset} className="btn btn-primary">
          {t("errorRetry")}
        </button>
        <Link href="/" className="btn btn-secondary">
          {t("backHome")}
        </Link>
      </div>
    </div>
  );
}