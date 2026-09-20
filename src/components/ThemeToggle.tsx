"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

const STORAGE_KEY = "tbd_theme";

export default function ThemeToggle() {
  const t = useTranslations("account");
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setTheme(
        document.documentElement.classList.contains("light") ? "light" : "dark",
      );
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.classList.remove("dark", "light");
    document.documentElement.classList.add(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // private mode — theme just won't persist
    }
    setTheme(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? t("light") : t("dark")}
      title={theme === "dark" ? t("light") : t("dark")}
      className="btn btn-ghost px-2.5 py-2"
    >
      {theme === "dark" ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}
