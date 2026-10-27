/**
 * Shared satori font stack for the OG image routes. @vercel/og ships only
 * the Geist font, which has no Arabic/CJK/Hangul/Hebrew/Thai/Devanagari
 * glyphs — text in one of those scripts rendered as blank boxes. Satori
 * cannot read the woff2 Google serves by default, but the css2 `text=`
 * endpoint returns a tiny `format('truetype')` subset (2–6 KB) containing
 * exactly the requested glyphs, so one extra font is loaded per request,
 * matching the script of the text that will be drawn, and cached per server
 * instance. When the text is pure Latin (Geist covers it) no extra font is
 * fetched.
 *
 * Extracted from /api/og/profile (which carried this inline) when the month
 * card route needed the same dance.
 *
 * Every entry is a Google Fonts family name (the css2 endpoint 400s on an
 * unknown one, which just leaves the name as tofu — the same outcome as no
 * gate, so adding coverage is safe). Order matters: the first match wins, so
 * kana precedes Han and the specific Indic families precede nothing generic.
 * Latin needs no entry (Geist covers it).
 */
const SCRIPT_FAMILIES: Array<[RegExp, string]> = [
  [/[\p{Script=Hiragana}\p{Script=Katakana}]/u, "Noto+Sans+JP"],
  [/\p{Script=Hangul}/u, "Noto+Sans+KR"],
  [/\p{Script=Han}/u, "Noto+Sans+SC"],
  [/\p{Script=Arabic}/u, "Noto+Sans+Arabic"],
  [/\p{Script=Hebrew}/u, "Noto+Sans+Hebrew"],
  [/\p{Script=Thai}/u, "Noto+Sans+Thai"],
  [/\p{Script=Devanagari}/u, "Noto+Sans+Devanagari"],
  [/\p{Script=Bengali}/u, "Noto+Sans+Bengali"],
  [/\p{Script=Tamil}/u, "Noto+Sans+Tamil"],
  [/\p{Script=Telugu}/u, "Noto+Sans+Telugu"],
  [/\p{Script=Kannada}/u, "Noto+Sans+Kannada"],
  [/\p{Script=Malayalam}/u, "Noto+Sans+Malayalam"],
  [/\p{Script=Gujarati}/u, "Noto+Sans+Gujarati"],
  [/\p{Script=Gurmukhi}/u, "Noto+Sans+Gurmukhi"],
  [/\p{Script=Oriya}/u, "Noto+Sans+Oriya"],
  [/\p{Script=Sinhala}/u, "Noto+Sans+Sinhala"],
  [/\p{Script=Tibetan}/u, "Noto+Sans+Tibetan"],
  [/\p{Script=Myanmar}/u, "Noto+Sans+Myanmar"],
  [/\p{Script=Khmer}/u, "Noto+Sans+Khmer"],
  [/\p{Script=Lao}/u, "Noto+Sans+Lao"],
  [/\p{Script=Ethiopic}/u, "Noto+Sans+Ethiopic"],
  [/\p{Script=Georgian}/u, "Noto+Sans+Georgian"],
  [/\p{Script=Armenian}/u, "Noto+Sans+Armenian"],
  [/\p{Script=Thaana}/u, "Noto+Sans+Thaana"],
  [/\p{Script=Greek}/u, "Noto+Sans"],
  [/\p{Script=Cyrillic}/u, "Noto+Sans"],
];

function familyForText(text: string): string | null {
  for (const [pattern, family] of SCRIPT_FAMILIES) {
    if (pattern.test(text)) return family;
  }
  return null;
}

const fontCache = new Map<string, Promise<ArrayBuffer | null>>();
// Keyed by (family, drawn text), and a CJK/Arabic subset is easily 100 KB+.
// The regex gate upstream keeps the key space to non-Latin names, but the map
// still must not grow without bound inside a long-lived function instance.
const FONT_CACHE_MAX = 32;

async function loadSubsetFont(
  family: string,
  text: string,
): Promise<ArrayBuffer | null> {
  const key = `${family}\u0000${text}`;
  const cached = fontCache.get(key);
  if (cached) return cached;
  if (fontCache.size >= FONT_CACHE_MAX) {
    // Map preserves insertion order, so the first key is the oldest entry.
    const oldest = fontCache.keys().next();
    if (!oldest.done) fontCache.delete(oldest.value);
  }
  const promise = (async () => {
    try {
      const cssUrl = `https://fonts.googleapis.com/css2?family=${family}&text=${encodeURIComponent(text)}`;
      const cssRes = await fetch(cssUrl, { signal: AbortSignal.timeout(6000) });
      if (!cssRes.ok) return null;
      const css = await cssRes.text();
      const match = css.match(/src: url\((.+?)\) format\('(?:truetype|opentype)'\)/);
      const fontUrl = match?.[1];
      if (!fontUrl) return null;
      const fontRes = await fetch(fontUrl, { signal: AbortSignal.timeout(6000) });
      if (!fontRes.ok) return null;
      return await fontRes.arrayBuffer();
    } catch {
      return null;
    }
  })();
  fontCache.set(key, promise);
  return promise;
}

export interface OgFontStack {
  /** The satori `fonts` option — undefined when the default Geist suffices. */
  fonts?: Array<{
    name: string;
    data: ArrayBuffer;
    style: "normal";
    weight: 400 | 700;
  }>;
  /** The `fontFamily` the card JSX should declare ("NotoOG" or the default). */
  fontFamily: string;
}

/**
 * The font stack for a card whose ONLY non-deterministic text is covered by
 * `allText`: a Noto subset matching the first non-Latin script found, or the
 * Geist default for pure Latin. The subset must cover EVERY string the card
 * draws, not just the display name — once a non-Latin font is registered it
 * replaces Geist for the whole image, so include labels AND digits in
 * `allText` (see /api/og/month for the pattern).
 */
export async function ogFontStack(allText: string): Promise<OgFontStack> {
  const family = familyForText(allText);
  const fontData = family ? await loadSubsetFont(family, allText) : null;
  if (!fontData) return { fontFamily: "sans-serif" };
  return {
    fonts: [
      { name: "NotoOG", data: fontData, style: "normal", weight: 400 },
      { name: "NotoOG", data: fontData, style: "normal", weight: 700 },
    ],
    fontFamily: "NotoOG",
  };
}
