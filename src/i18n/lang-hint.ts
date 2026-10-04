/**
 * Shared state for the first-visit language hint (LanguageHint chip).
 *
 * Both paths that mean "the visitor has made their choice" funnel here:
 * the chip's own dismiss button / switch link, and any explicit selection
 * in the LanguageSwitcher. After either, the chip must never come back —
 * re-offering a language to someone who just switched away from it is a nag,
 * not discovery.
 *
 * Client-only (localStorage); the failed-storage path is silent on purpose —
 * in private mode the chip simply re-offers on the next visit, which is the
 * correct degradation.
 */
export const LANG_HINT_DISMISS_KEY = "lang-hint-dismissed";

export function suppressLangHint(): void {
  try {
    localStorage.setItem(LANG_HINT_DISMISS_KEY, "1");
  } catch {
    // storage unavailable — nothing to persist
  }
}
