"use client";

import { useEffect, useState } from "react";

export interface ChartTheme {
  accent: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  line: string;
  muted: string;
  surface2: string;
  foreground: string;
}

/** Dark-theme defaults, used for the first paint before the DOM is read. */
const FALLBACK: ChartTheme = {
  accent: "#a970ff",
  success: "#34d399",
  warning: "#fbbf24",
  danger: "#f87171",
  info: "#60a5fa",
  line: "rgba(255,255,255,0.12)",
  muted: "#9a9ab0",
  surface2: "#17171f",
  foreground: "#f4f4f8",
};

/**
 * Resolves the design tokens to real colour values for recharts. SVG
 * presentation attributes cannot resolve `var()` reliably, so the palette is
 * read from the document once after mount (inside rAF, as the React Compiler
 * lint rules require) and follows the active theme from then on.
 */
export function useChartTheme(): ChartTheme {
  const [theme, setTheme] = useState<ChartTheme>(FALLBACK);

  useEffect(() => {
    const readTheme = () => {
      const styles = getComputedStyle(document.documentElement);
      const read = (name: string, fallback: string) =>
        styles.getPropertyValue(name).trim() || fallback;
      setTheme({
        accent: read("--accent", FALLBACK.accent),
        success: read("--success", FALLBACK.success),
        warning: read("--warning", FALLBACK.warning),
        danger: read("--danger", FALLBACK.danger),
        info: read("--info", FALLBACK.info),
        line: read("--line-strong", FALLBACK.line),
        muted: read("--muted", FALLBACK.muted),
        surface2: read("--surface-2", FALLBACK.surface2),
        foreground: read("--foreground", FALLBACK.foreground),
      });
    };

    // Reading the tokens needs the DOM, so the first pass waits a frame (the
    // React Compiler lint rules forbid a synchronous setState in an effect
    // body). The observer is what makes the hook's promise true: the theme
    // toggle only swaps a class on <html>, which no React state would notice.
    const frame = requestAnimationFrame(readTheme);
    const observer = new MutationObserver((records) => {
      if (records.some((r) => r.attributeName === "class")) readTheme();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return theme;
}

export default useChartTheme;
