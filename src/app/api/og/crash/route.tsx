import { ImageResponse } from "@vercel/og";
import { createClient } from "@/lib/supabase/server";
import { getProfileByUsername } from "@/lib/queries";
import { ogFontStack } from "@/lib/og";

// A best flight only improves; @vercel/og's production default (immutable,
// 1 year) would freeze a stale record into crawlers. The month-card
// convention: short shared-cache lifetime + SWR.
export const revalidate = 300;

/**
 * The member's best banked Badge Rocket cash-out as a 1200×630 share card
 * (0081) — previewed inside the profile's crash share row and unfurled when
 * the profile URL is shared with ?crash=1 (the page swaps its og:image to
 * this route, the ?month=1 doctrine).
 *
 * Everything is anon-readable: profiles public columns, the
 * stats_crash_top_cash view (0081, anon-granted). A member with no banked
 * flight gets the quiet variant card (never a 404: crawlers fetch at share
 * time). Labels are hardcoded English — the OG-image precedent.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const username = (url.searchParams.get("u") ?? "").toLowerCase();
  if (!/^[a-z0-9_]{3,25}$/.test(username)) {
    return new Response("invalid username", { status: 400 });
  }

  const supabase = await createClient();
  const [profile, best] = await Promise.all([
    getProfileByUsername(username).catch(() => null),
    supabase
      .from("stats_crash_top_cash")
      .select("best_mult,best_payout,achieved_at")
      .eq("username", username)
      .maybeSingle()
      .then((res) => res.data as Record<string, unknown> | null, () => null),
  ]);
  const displayName = profile?.display_name || profile?.username || username;
  const avatar = profile?.avatar_url ?? null;

  const mult = Number(best?.best_mult ?? 0);
  const payout = Number(best?.best_payout ?? 0);
  const achieved = typeof best?.achieved_at === "string" ? best.achieved_at : null;
  const dateLabel = achieved
    ? new Date(achieved).toLocaleDateString("en-US", {
        timeZone: "UTC",
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;
  const moon = mult >= 10;

  const fmt = (n: number) => n.toLocaleString("en-US");

  // The subset must cover EVERY drawn string (a registered non-Latin font
  // replaces Geist for the whole image) — labels, the quiet sentence, digits.
  const { fonts, fontFamily } = await ogFontStack(
    `${displayName} @${username} Badge Rocket best cash-out MOON landed ` +
      `BadgesCoins won on Twitch Badges Database 0123456789.,×+−#·`,
  );

  const image = new ImageResponse(
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
            "radial-gradient(ellipse 55% 38% at 50% 0%, rgba(249,115,22,0.22), transparent), radial-gradient(ellipse 40% 30% at 85% 90%, rgba(251,191,36,0.18), transparent)",
          color: "#f4f4f8",
          fontFamily,
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 24,
            fontWeight: 700,
            letterSpacing: 3,
            color: "#f97316",
            textTransform: "uppercase",
          }}
        >
          Badge Rocket — best cash-out
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 24,
            marginTop: 26,
          }}
        >
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatar}
              width={96}
              height={96}
              style={{ borderRadius: 9999, border: "4px solid #f97316" }}
              alt=""
            />
          ) : null}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 48, fontWeight: 800 }}>
              {displayName}
            </div>
            <div style={{ display: "flex", fontSize: 24, color: "#9a9ab0" }}>
              @{username}
            </div>
          </div>
        </div>

        {mult >= 2 ? (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 10,
                marginTop: 30,
              }}
            >
              <span
                style={{
                  display: "flex",
                  fontSize: 120,
                  fontWeight: 800,
                  color: "#fbbf24",
                }}
              >
                {mult.toFixed(2)}×
              </span>
            </div>
            <div style={{ display: "flex", marginTop: 8, fontSize: 26, color: "#c9c9dd" }}>
              banked · +{fmt(payout)} BadgesCoins{dateLabel ? ` · ${dateLabel}` : ""}
            </div>
            {moon && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  marginTop: 20,
                  padding: "10px 28px",
                  borderRadius: 9999,
                  backgroundColor: "rgba(251,191,36,0.14)",
                  border: "1px solid rgba(251,191,36,0.5)",
                }}
              >
                <span
                  style={{
                    display: "flex",
                    fontSize: 26,
                    fontWeight: 800,
                    color: "#fbbf24",
                  }}
                >
                  To the moon
                </span>
              </div>
            )}
          </>
        ) : (
          <div
            style={{
              display: "flex",
              marginTop: 36,
              padding: "16px 34px",
              borderRadius: 18,
              backgroundColor: "rgba(249,115,22,0.12)",
              border: "1px solid rgba(249,115,22,0.4)",
              fontSize: 26,
              color: "#c9c9dd",
            }}
          >
            No banked flight yet — the pad is warm.
          </div>
        )}

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

  return new Response(image.body, {
    status: 200,
    headers: {
      "content-type": "image/png",
      "cache-control": "public, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
