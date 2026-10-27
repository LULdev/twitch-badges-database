import { ImageResponse } from "@vercel/og";
import { createClient } from "@/lib/supabase/server";
import { getProfileByUsername } from "@/lib/queries";
import { ogFontStack } from "@/lib/og";

// The month card changes with every settled round; @vercel/og's production
// default (immutable, 1 year) would freeze a stale month into crawlers.
// The RSS convention fits: short shared-cache lifetime + SWR.
export const revalidate = 300;

/**
 * The member's trailing-30-day arcade month as a 1200×630 share card —
 * previewed inside the profile's month card and unfurled when the profile
 * URL is shared with ?month=1 (the page swaps its og:image to this route).
 *
 * Everything is anon-readable: profiles public columns, game_rounds
 * public-read (0003), stats_arcade_month_top anon-granted (0078/0079) — no
 * service role. A member with no rounds this month gets the quiet variant
 * card (never a 404: the image is fetched by crawlers at share time, when
 * the month may have gone quiet again). Labels are hardcoded English — the
 * OG-image precedent (og/profile ignores its locale param too).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const username = (url.searchParams.get("u") ?? "").toLowerCase();
  if (!/^[a-z0-9_]{3,25}$/.test(username)) {
    return new Response("invalid username", { status: 400 });
  }

  const supabase = await createClient();

  const roundsBy = async (userId: string) => {
    const cutoff = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const { data } = await supabase
      .from("game_rounds")
      .select("bet,payout,created_at")
      .eq("user_id", userId)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(1000);
    return (data ?? []) as Array<{ bet: number | string; payout: number | string; created_at: string }>;
  };

  const [profile, topUsernames] = await Promise.all([
    getProfileByUsername(username).catch(() => null),
    // PostgREST builders are thenable, not full promises (no .catch) — the
    // two-arg .then covers a failed read with an empty ranking.
    supabase
      .from("stats_arcade_month_top")
      .select("username")
      .then(
        (res) => ((res.data ?? []) as Array<{ username: string }>).map((r) => r.username),
        () => [] as string[],
      ),
  ]);
  const displayName = profile?.display_name || profile?.username || username;
  const avatar = profile?.avatar_url ?? null;

  const rounds = profile ? await roundsBy(profile.id).catch(() => []) : [];
  const monthStart = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const month = rounds.filter((r) => r.created_at >= monthStart);
  const monthRounds = month.length;
  const monthWagered = month.reduce((sum, r) => sum + Number(r.bet ?? 0), 0);
  const monthNet = month.reduce(
    (sum, r) => sum + (Number(r.payout ?? 0) - Number(r.bet ?? 0)),
    0,
  );
  // Best day by round count (ties keep the latest — the most recent memory).
  const perDay = new Map<string, number>();
  for (const r of month) {
    const key = r.created_at.slice(0, 10);
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }
  let bestDay: { day: string; rounds: number } | null = null;
  for (const [day, count] of perDay) {
    if (!bestDay || count > bestDay.rounds || (count === bestDay.rounds && day > bestDay.day)) {
      bestDay = { day, rounds: count };
    }
  }
  const rank = topUsernames.indexOf(profile?.username ?? username) + 1;

  const fmt = (n: number) => n.toLocaleString("en-US");
  const bestDayLabel = bestDay
    ? new Date(`${bestDay.day}T00:00:00Z`).toLocaleDateString("en-US", {
        timeZone: "UTC",
        month: "short",
        day: "numeric",
      })
    : null;

  // The subset must cover EVERY string the card draws (once a non-Latin font
  // registers it replaces Geist for the whole image) — labels, both variants'
  // sentences and the full digit/punctuation set included.
  const { fonts, fontFamily } = await ogFontStack(
    `${displayName} @${username} Badge Arcade the last 30 days ROUNDS WAGERED NET ` +
      `Best day rounds of the month No in the boards are open Twitch Badges Database ` +
      `0123456789.,+−−#·`,
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
            "radial-gradient(ellipse 60% 40% at 50% 0%, rgba(169,112,255,0.25), transparent)",
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
            color: "#a970ff",
            textTransform: "uppercase",
          }}
        >
          Badge Arcade — the last 30 days
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 24,
            marginTop: 28,
          }}
        >
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatar}
              width={96}
              height={96}
              style={{ borderRadius: 9999, border: "4px solid #a970ff" }}
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

        {monthRounds > 0 ? (
          <div
            style={{
              display: "flex",
              alignItems: "stretch",
              justifyContent: "center",
              gap: 18,
              marginTop: 36,
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                padding: "16px 34px",
                borderRadius: 18,
                backgroundColor: "rgba(169,112,255,0.12)",
                border: "1px solid rgba(169,112,255,0.4)",
              }}
            >
              <span style={{ display: "flex", fontSize: 44, fontWeight: 800 }}>
                {fmt(monthRounds)}
              </span>
              <span style={{ display: "flex", fontSize: 18, color: "#c9c9dd" }}>
                rounds
              </span>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                padding: "16px 34px",
                borderRadius: 18,
                backgroundColor: "rgba(169,112,255,0.12)",
                border: "1px solid rgba(169,112,255,0.4)",
              }}
            >
              <span style={{ display: "flex", fontSize: 44, fontWeight: 800 }}>
                {fmt(monthWagered)}
              </span>
              <span style={{ display: "flex", fontSize: 18, color: "#c9c9dd" }}>
                BadgesCoins wagered
              </span>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                padding: "16px 34px",
                borderRadius: 18,
                backgroundColor: "rgba(169,112,255,0.12)",
                border: "1px solid rgba(169,112,255,0.4)",
              }}
            >
              <span
                style={{
                  display: "flex",
                  fontSize: 44,
                  fontWeight: 800,
                  color: monthNet >= 0 ? "#4ade80" : "#f87171",
                }}
              >
                {monthNet >= 0 ? "+" : "−"}
                {fmt(Math.abs(monthNet))}
              </span>
              <span style={{ display: "flex", fontSize: 18, color: "#c9c9dd" }}>
                net
              </span>
            </div>
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              marginTop: 36,
              padding: "16px 34px",
              borderRadius: 18,
              backgroundColor: "rgba(169,112,255,0.12)",
              border: "1px solid rgba(169,112,255,0.4)",
              fontSize: 26,
              color: "#c9c9dd",
            }}
          >
            No rounds in the last 30 days — the boards are open.
          </div>
        )}

        {monthRounds > 0 && bestDay && bestDayLabel && (
          <div style={{ display: "flex", marginTop: 28, fontSize: 24, color: "#c9c9dd" }}>
            Best day: {bestDayLabel} · {fmt(bestDay.rounds)} rounds
          </div>
        )}

        {rank > 0 && (
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
                fontSize: 28,
                fontWeight: 800,
                color: "#fbbf24",
              }}
            >
              #{rank} of the month
            </span>
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
