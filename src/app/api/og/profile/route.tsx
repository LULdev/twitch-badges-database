import { ImageResponse } from "@vercel/og";
import { fetchUserBadges } from "@/lib/twitch/perfil";

export const revalidate = 3600;

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
          fontFamily: "sans-serif",
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
    { width: 1200, height: 630 },
  );
}
