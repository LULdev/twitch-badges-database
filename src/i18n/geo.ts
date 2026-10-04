import { routing, type Locale } from "./routing";

/**
 * Country → locale, used by the proxy as the THIRD negotiation layer, after
 * the visitor's explicit choice (NEXT_LOCALE cookie) and the browser's own
 * language preference (Accept-Language). It only fires when neither of those
 * yields a supported locale: a browser sent no Accept-Language header at all,
 * or one whose languages the catalog does not cover.
 *
 * Vercel populates `x-vercel-ip-country` on every request from the edge
 * location that served it, so this costs no lookup of our own. The map is
 * deliberately country-of-origin (where the visitor physically is), not
 * locale-of-majority-for-an-entire-continent — a Brazilian in Portugal gets
 * pt from either signal, but the map only needs the unambiguous cases.
 * Multilingual countries (CH, BE, CA) rely on Accept-Language to disambiguate;
 * when that header is missing, CH falls to its plurality (de), BE/CA are left
 * out on purpose.
 */
export const COUNTRY_TO_LOCALE: Partial<Record<string, Locale>> = {
  // German
  DE: "de",
  AT: "de",
  LI: "de",
  CH: "de",
  // Portuguese
  PT: "pt",
  BR: "pt",
  AO: "pt",
  MZ: "pt",
  // Spanish
  ES: "es",
  MX: "es",
  AR: "es",
  CL: "es",
  CO: "es",
  PE: "es",
  VE: "es",
  UY: "es",
  PY: "es",
  BO: "es",
  EC: "es",
  GT: "es",
  CR: "es",
  PA: "es",
  DO: "es",
  HN: "es",
  SV: "es",
  NI: "es",
  CU: "es",
  PR: "es",
  // French
  FR: "fr",
  LU: "fr",
  MC: "fr",
  SN: "fr",
  CI: "fr",
  ML: "fr",
  // Italian
  IT: "it",
  SM: "it",
  VA: "it",
  // Russian
  RU: "ru",
  BY: "ru",
  KZ: "ru",
  KG: "ru",
  // Chinese
  CN: "zh",
  TW: "zh",
  HK: "zh",
  MO: "zh",
  SG: "zh",
  // Japanese
  JP: "ja",
  // Korean
  KR: "ko",
  KP: "ko",
  // Arabic
  SA: "ar",
  AE: "ar",
  EG: "ar",
  MA: "ar",
  DZ: "ar",
  TN: "ar",
  LY: "ar",
  SD: "ar",
  IQ: "ar",
  SY: "ar",
  JO: "ar",
  LB: "ar",
  KW: "ar",
  QA: "ar",
  BH: "ar",
  OM: "ar",
  YE: "ar",
  PS: "ar",
  MR: "ar",
};

/**
 * Best supported locale from an Accept-Language header, or null when the
 * header is absent, malformed or matches nothing in the catalog. Base-language
 * matching only (de-DE → de): the catalog has no regional variants.
 */
export function acceptLanguageLocale(header: string | null): Locale | null {
  if (!header) return null;
  const candidates = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      let q = 1;
      for (const param of params) {
        const match = param.trim().match(/^q=([\d.]+)$/);
        if (match) q = Number.parseFloat(match[1]);
      }
      return { tag: tag.trim().toLowerCase(), q };
    })
    .filter((c) => c.tag.length > 0 && c.tag !== "*")
    .sort((a, b) => b.q - a.q);
  for (const { tag } of candidates) {
    const base = tag.split("-")[0];
    if (routing.locales.includes(base as Locale)) return base as Locale;
  }
  return null;
}
