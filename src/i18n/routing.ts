import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "pt", "es", "fr", "de", "ru", "zh", "ar", "ja", "it", "ko"],
  defaultLocale: "en",
  localePrefix: "always",
});

export type Locale = (typeof routing.locales)[number];

export const localeNames: Record<Locale, string> = {
  en: "English",
  pt: "Português",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  ru: "Русский",
  zh: "中文",
  ar: "العربية",
  ja: "日本語",
  it: "Italiano",
  ko: "한국어",
};

export const localeHtmlLang: Record<Locale, string> = {
  en: "en",
  pt: "pt-BR",
  es: "es",
  fr: "fr",
  de: "de",
  ru: "ru",
  zh: "zh-Hans",
  ar: "ar",
  ja: "ja",
  it: "it",
  ko: "ko",
};

export function isRtl(locale: string): boolean {
  return locale === "ar";
}
