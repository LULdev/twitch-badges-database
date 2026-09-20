import { routing, localeHtmlLang } from "@/i18n/routing";
import { envOrNull } from "./env";

export function siteUrl(): string {
  return (envOrNull("NEXT_PUBLIC_SITE_URL") ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
}

/** hreflang alternates for a locale-independent path like "/badges/foo". */
export function localeAlternates(path = "/"): Record<string, string> {
  const base = siteUrl();
  const clean = path === "/" ? "" : path;
  const map: Record<string, string> = {};
  for (const locale of routing.locales) {
    map[localeHtmlLang[locale]] = `${base}/${locale}${clean}`;
  }
  map["x-default"] = `${base}/en${clean}`;
  return map;
}

export function absoluteUrl(locale: string, path = "/"): string {
  const clean = path === "/" ? "" : path;
  return `${siteUrl()}/${locale}${clean}`;
}
