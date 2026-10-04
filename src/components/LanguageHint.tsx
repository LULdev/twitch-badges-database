"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Link } from "@/i18n/navigation";

const DISMISS_KEY = "lang-hint-dismissed";

/**
 * First-visit language hint. The layout computes the visitor's
 * country-of-origin locale from Vercel's geo header and only mounts this chip
 * when that locale differs from the one being served — an English-reading
 * visitor from Germany on /en is offered /de, and nothing is shown to anyone
 * whose origin and page already agree. Dismissal persists in localStorage, so
 * the chip is a one-time offer, not a recurring nag.
 *
 * The texts arrive as props from the server layout (translated there), so
 * this component reads no namespace of its own and stays out of the
 * CLIENT_NAMESPACES shipping list.
 */
export default function LanguageHint({
  target,
  langName,
  hint,
  dismissLabel,
}: {
  target: string;
  langName: string;
  hint: string;
  dismissLabel: string;
}) {
  const [visible, setVisible] = useState(false);

  // Hidden by default, revealed only after hydration: a visitor who dismissed
  // the chip once must never see it flash on every page. The storage read sits
  // in a rAF callback — a synchronous setState inside the effect body is
  // rejected by the React Compiler lint rules. Storage failures show the chip
  // (dismissal just won't survive a reload).
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      try {
        if (localStorage.getItem(DISMISS_KEY) !== "1") setVisible(true);
      } catch {
        setVisible(true);
      }
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (!visible) return null;

  // usePathname includes the locale prefix; the i18n Link re-adds one, so the
  // current prefix is stripped and the locale prop supplies the target.
  const barePath = pathname.replace(/^\/[a-zA-Z-]+(?=\/|$)/, "") || "/";
  const query = searchParams.toString();

  return (
    <div className="fixed bottom-4 end-4 z-40 max-w-xs">
      <div className="card flex items-center gap-2.5 p-3 shadow-lg">
        <p className="min-w-0 text-xs leading-snug text-muted">{hint}</p>
        <Link
          href={query ? `${barePath}?${query}` : barePath}
          locale={target}
          data-lang-hint-link
          className="chip shrink-0 font-semibold text-accent"
        >
          {langName}
        </Link>
        <button
          type="button"
          data-lang-hint-dismiss
          onClick={() => {
            try {
              localStorage.setItem(DISMISS_KEY, "1");
            } catch {
              // private mode — the chip still hides for this page view
            }
            setVisible(false);
          }}
          aria-label={dismissLabel}
          className="shrink-0 text-muted hover:text-foreground"
        >
          <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
    </div>
  );
}
