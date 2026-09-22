"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { localeNames, routing, type Locale } from "@/i18n/routing";

/**
 * Circular flag icon per locale (64×64, transparent corners) from
 * /public/flags. `null` renders the dashed placeholder — drop a file in
 * public/flags and add it here when a flag is missing.
 */
const FLAGS: Record<Locale, string | null> = {
  en: "/flags/en.png",
  de: "/flags/de.png",
  fr: "/flags/fr.png",
  es: "/flags/es.png",
  pt: "/flags/pt.png",
  it: "/flags/it.png",
  ru: "/flags/ru.png",
  zh: "/flags/zh.png",
  ja: "/flags/ja.png",
  ko: "/flags/ko.png",
  ar: "/flags/ar.png",
};

function FlagIcon({
  locale,
  size,
  className = "",
}: {
  locale: Locale;
  size: number;
  className?: string;
}) {
  const src = FLAGS[locale];
  if (!src) {
    // Placeholder for locales whose flag has not been uploaded yet.
    return (
      <span
        className={`lang-flag-empty ${className}`}
        style={{ width: size, height: size }}
        aria-hidden
      >
        <svg
          width={Math.round(size * 0.55)}
          height={Math.round(size * 0.55)}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static 64px flag asset
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      draggable={false}
      className={`lang-flag ${className}`}
    />
  );
}

export default function LanguageSwitcher() {
  const t = useTranslations("footer");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState<number>(() =>
    Math.max(0, routing.locales.indexOf(locale as Locale)),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function select(next: Locale) {
    setOpen(false);
    triggerRef.current?.focus();
    if (next === locale) return;
    startTransition(() => {
      // Preserve the current query string: switching the language used to drop
      // active filters, the page number and the compare selection.
      const search =
        typeof window === "undefined" ? "" : window.location.search;
      router.replace(`${pathname}${search}`, { locale: next });
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setHighlighted(
        (current) =>
          (current + delta + routing.locales.length) % routing.locales.length,
      );
    } else if (event.key === "Enter" || event.key === " ") {
      if (open) {
        event.preventDefault();
        select(routing.locales[highlighted]);
      } else {
        event.preventDefault();
        setOpen(true);
      }
    }
  }

  return (
    <div ref={rootRef} className="lang-switcher">
      <button
        ref={triggerRef}
        type="button"
        className={`lang-trigger ${isPending ? "is-pending" : ""} ${open ? "is-open" : ""}`}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="lang-listbox"
        aria-label={`${t("language")}: ${localeNames[locale as Locale] ?? locale}`}
        disabled={isPending}
      >
        <FlagIcon locale={locale as Locale} size={22} />
        <span className="lang-spinner" aria-hidden />
      </button>

      {open ? (
        <div id="lang-listbox" className="lang-panel" role="listbox" aria-label={t("language")}>
          <div className="lang-panel-head">
            <span className="lang-panel-title">{t("language")}</span>
            <span className="lang-panel-count">{routing.locales.length}</span>
          </div>
          <ul className="lang-list" role="presentation">
            {routing.locales.map((code, index) => {
              const active = code === locale;
              return (
                <li
                  key={code}
                  style={{ "--d": `${index * 28}ms` } as CSSProperties}
                >
                  <button
                    id={`lang-opt-${code}`}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`lang-item ${active ? "is-active" : ""} ${
                      index === highlighted ? "is-highlighted" : ""
                    }`}
                    onMouseEnter={() => setHighlighted(index)}
                    onClick={() => select(code)}
                    tabIndex={-1}
                  >
                    <FlagIcon locale={code} size={22} />
                    <span className="lang-name">{localeNames[code]}</span>
                    <span className="lang-code">{code.toUpperCase()}</span>
                    <svg
                      className="lang-check"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
