import { ImageResponse } from "@vercel/og";
import { fetchUserBadges } from "@/lib/twitch/perfil";

export const revalidate = 3600;

// ind-3: @vercel/og ships only the Geist font, which has no Arabic/CJK/Hangul/
// Hebrew/Thai/Devanagari glyphs — a display name using one of those scripts
// rendered as blank boxes on the shared profile card. Satori cannot read the
// woff2 Google serves by default, but the css2 `text=` endpoint returns a tiny
// `format('truetype')` subset (2–6 KB) containing exactly the requested glyphs,
// so one extra font is loaded per request, matching the script of the text that
// will be drawn, and cached per server instance. When the name is pure Latin
// (Geist covers it) no extra font is fetched.
//
// Order matters: kana is tested before Han, so a name mixing kanji and kana uses
// the Japanese family rather than Simplified Chinese.
const SCRIPT_FAMILIES: Array<[RegExp, string]> = [
  [/[\p{Script=Hiragana}\p{Script=Katakana}]/u, "Noto+Sans+JP"],
  [/\p{Script=Hangul}/u, "Noto+Sans+KR"],
  [/\p{Script=Han}/u, "Noto+Sans+SC"],
  [/\p{Script=Arabic}/u, "Noto+Sans+Arabic"],
  [/\p{Script=Hebrew}/u, "Noto+Sans+Hebrew"],
  [/\p{Script=Thai}/u, "Noto+Sans+Thai"],
  [/\p{Script=Devanagari}/u, "Noto+Sans+Devanagari"],
  [/\p{Script=Cyrillic}/u, "Noto+Sans"],
];

function familyForText(text: string): string | null {
  for (const [pattern, family] of SCRIPT_FAMILIES) {
    if (pattern.test(text)) return family;
  }
  return null;
}

const fontCache = new Map<string, Promise<ArrayBuffer | null>>();
// Keyed by (family, display name), and a CJK/Arabic subset is easily 100 KB+.
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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const username = (url.searchParams.get("u") ?? "").toLowerCase();
  if (!/^[a-z0-9_]{3,25}$/.test(username)) {
    return new Response("invalid username", { status: 400 });
  }

  const perfil = await fetchUserBadges(username, 3600).catch(() => null);

  const displayName = perfil?.displayName ?? username;
  const avatar = perfil?.profileImageURL ?? null;
  const owned = perfil?.badges.length ?? 0;
  const badgeImages = (perfil?.badges ?? [])
    .map((badge) => badge.image2x ?? badge.image1x)
    .filter((src): src is string => Boolean(src))
    .slice(0, 8);

  // The subset must cover every string the card draws, not just the display
  // name: once a non-Latin font is registered it replaces Geist for the whole
  // image, so the username, the count and the footer labels need their glyphs
  // in the subset too.
  const fontText = `${displayName} @${username} ${owned} badges owned Twitch Badges Database`;
  const family = familyForText(displayName);
  const fontData = family ? await loadSubsetFont(family, fontText) : null;
  const fonts = fontData
    ? [
        { name: "NotoOG", data: fontData, style: "normal" as const, weight: 400 as const },
        { name: "NotoOG", data: fontData, style: "normal" as const, weight: 700 as const },
      ]
    : undefined;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0b0b11",
          backgroundImage:
            "radial-gradient(ellipse 60% 40% at 50% 0%, rgba(169,112,255,0.25), transparent)",
          color: "#f4f4f8",
          fontFamily: fontData ? "NotoOG" : "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 28,
          }}
        >
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatar}
              width={120}
              height={120}
              style={{ borderRadius: 9999, border: "4px solid #a970ff" }}
              alt=""
            />
          ) : null}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 56, fontWeight: 800 }}>
              {displayName}
            </div>
            <div style={{ display: "flex", fontSize: 26, color: "#9a9ab0" }}>
              @{username}
            </div>
          </div>
        </div>

        {badgeImages.length > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 14,
              marginTop: 36,
            }}
          >
            {badgeImages.map((src) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={src} src={src} width={64} height={64} alt="" />
            ))}
          </div>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            marginTop: 40,
            padding: "10px 28px",
            borderRadius: 9999,
            backgroundColor: "rgba(169,112,255,0.15)",
            border: "1px solid rgba(169,112,255,0.4)",
          }}
        >
          <span style={{ display: "flex", fontSize: 26, fontWeight: 700, color: "#a970ff" }}>
            {owned}
          </span>
          <span style={{ display: "flex", fontSize: 22, color: "#c9c9dd" }}>
            badges owned
          </span>
        </div>

        <div
          style={{
            display: "flex",
            position: "absolute",
            bottom: 36,
            fontSize: 20,
            color: "#6d6d80",
          }}
        >
          Twitch Badges Database
        </div>
      </div>
    ),
    { width: 1200, height: 630, fonts },
  );
}