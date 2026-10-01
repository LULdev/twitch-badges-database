import { createAdminClient } from "./supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RarityTier } from "./rarity";

export interface AutoPostBadgeInfo {
  slug: string;
  title: string;
  setId: string;
  imageUrl2x: string | null;
  category: string;
  isPaid: boolean;
  howToEarn: string | null;
  startDate: string | null;
  endDate: string | null;
  rarityTier: RarityTier;
  rarityScore: number;
  /** Helix occasionally ships one; badgebase-discovered rows always have it. */
  description?: string | null;
}

/**
 * Free context the global sync already holds in memory when a drop is
 * detected — feeds the category-context and co-drop sections of the article.
 */
export interface DropPostContext {
  detectedAt?: string;
  source?: string;
  catalogTotal?: number;
  categoryCount?: number;
  categoryActive?: number;
  coDropTitles?: string[];
}

/** House floor for auto articles — the owner's explicit requirement. */
const MIN_CONTENT_CHARS = 600;

const GENERIC_CONTEXT_BLOCK = [
  "## About this tracker",
  "",
  "This database catalogs every global Twitch badge with live owner statistics, a six-signal rarity index (TBRI), claim windows and drop history. Catalog scans run daily, owner statistics refresh throughout the day, and every catalog change is recorded with a timestamp in the [changelog](/en/changelog). Browse all current drops on the [active list](/en/active) or explore the numbers on the [statistics dashboard](/en/stats).",
].join("\n");

function formatDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString().slice(0, 10);
}

/**
 * Pure article builder so the length floor is testable without a DB.
 * Every section has an unconditional fallback: at drop-detection time the
 * badgebase/potat passes have not enriched the row yet, so howToEarn/dates
 * are usually null and rarity still sits at its DB default — the template
 * must stand on its own in exactly that case.
 */
export function buildDropArticle(
  badge: AutoPostBadgeInfo,
  context: DropPostContext = {},
): { content: string; excerpt: string } {
  const detected = context.detectedAt
    ? formatDate(context.detectedAt)
    : new Date().toISOString().slice(0, 10);
  const catalogTotal = context.catalogTotal;

  const sections: string[] = [];

  sections.push(
    `A new global Twitch badge just went live: **${badge.title}** (\`${badge.setId}\`). Our catalog scan picked it up on ${detected}${context.source ? ` from the ${context.source} feed` : ""} and it is now tracked in the ${badge.category} category${catalogTotal ? ` alongside ${Math.max(0, catalogTotal - 1)} other badges` : ""}. This automatic drop alert sums up what is confirmed so far, what is still unknown, and where to follow the live numbers as they come in.`,
  );

  sections.push("## What this badge is");
  if (badge.description) {
    sections.push(badge.description);
  } else {
    sections.push(
      `Twitch has not published an official description for this set yet. The badge is registered in the global catalog under the set ID \`${badge.setId}\`, which means it is not limited to a single channel: once a viewer earns it, it can appear next to their name in any chat on the platform. Global badges like this are the ones collectors track, because they keep working everywhere on Twitch.`,
    );
  }

  sections.push("## How to earn it");
  if (badge.howToEarn) {
    sections.push(`**Requirements:** ${badge.howToEarn}`);
  } else {
    sections.push(
      `The exact unlock steps are not documented yet. Our drop-window tracker refreshes daily from the badge listing feed, and this article does not change after publication — the [badge page](/en/badges/${badge.slug}) always shows the current claim status and requirements the moment we have them.`,
    );
  }

  sections.push("## Rarity assessment");
  if (badge.rarityScore > 0 && badge.rarityTier !== "common") {
    sections.push(
      `The Twitch Badge Rarity Index (TBRI) currently rates **${badge.title}** at **${badge.rarityScore}/100 — ${badge.rarityTier}**. The score blends six signals — scarcity of ownership, wear (how many owners still wear it), obtainability, age, 24-hour momentum, and the brevity of the claim window — so it moves as owner statistics are polled.`,
    );
  } else {
    sections.push(
      `This drop is brand new and has not been rated yet — fresh badges start at the bottom of the scale until owner statistics are polled. The [badge page](/en/badges/${badge.slug}) shows the live score as soon as the first poll lands; expect it to settle within a day.`,
    );
  }

  sections.push("## Claim window");
  if (badge.startDate && badge.endDate) {
    sections.push(
      `Redeemable from **${formatDate(badge.startDate)}** until **${formatDate(badge.endDate)}** (UTC). Once the window closes, the badge moves to the expired archive — earned copies stay visible, but no new ones can be claimed.`,
    );
  } else if (badge.endDate) {
    sections.push(
      `Redeemable until **${formatDate(badge.endDate)}** (UTC). Once the window closes, the badge moves to the expired archive — earned copies stay visible, but no new ones can be claimed.`,
    );
  } else if (badge.startDate) {
    sections.push(
      `Redeemable from **${formatDate(badge.startDate)}** (UTC); no end date has been announced, so the drop may be open-ended.`,
    );
  } else {
    sections.push(
      `No start or end date has been published for this badge yet. Some drops are permanent once earned, others are only redeemable during a short event window — until an official claim window is confirmed, treat availability as unverified and watch the [active drops list](/en/active).`,
    );
  }

  sections.push("## Category context");
  const catCount = context.categoryCount;
  const catActive = context.categoryActive;
  if (catCount && catCount > 1) {
    sections.push(
      `The ${badge.category} category currently tracks **${catCount} badges** in our database${catActive != null ? `, ${catActive} of them redeemable right now` : ""}. **${badge.title}** sits alongside the rest of the group — the [category listing](/en/badges?category=${encodeURIComponent(badge.category)}) is the fastest way to compare artwork and rarity at a glance.`,
    );
  } else {
    sections.push(
      `**${badge.title}** is the first badge we track in the ${badge.category} category. The [category listing](/en/badges?category=${encodeURIComponent(badge.category)}) shows everything that joins it from here on.`,
    );
  }

  const coDrops = (context.coDropTitles ?? []).filter((t) => t !== badge.title);
  sections.push("## Where to go next");
  sections.push(
    [
      `Full details, live owner counts and the claim countdown (once a window is confirmed) live on the [badge page](/en/badges/${badge.slug}). The [blog](/en/blog) covers every drop we detect, and the [changelog](/en/changelog) records every catalog change with a timestamp.`,
      coDrops.length > 0 ? `This wave also detected: ${coDrops.slice(0, 5).join(", ")}${coDrops.length > 5 ? " and others" : ""}.` : "",
    ]
      .filter(Boolean)
      .join(" "),
  );

  sections.push(
    `**Availability:** unverified · **Cost:** ${badge.isPaid ? "Paid" : "Free"} · **Set:** \`${badge.setId}\``,
  );

  let content = sections.join("\n\n");
  if (content.length < MIN_CONTENT_CHARS) {
    content += `\n\n${GENERIC_CONTEXT_BLOCK}`;
  }

  const excerpt = `A new global Twitch badge went live: ${badge.title} (${badge.setId}). What is confirmed, what is still unknown, and where to follow the live rarity and claim-window numbers.`;

  return { content, excerpt };
}

/** Inputs for the daily arcade recap, gathered by the sync engine. Every
 *  field except the day itself can be missing on a quiet day — the builder
 *  must stand on fallbacks exactly like buildDropArticle. */
export interface ArcadeHighlightsInput {
  /** UTC calendar day the recap covers (YYYY-MM-DD). */
  day: string;
  /** Human-readable game name -> settled round count that day. */
  roundsByGame: Array<{ id: string; game: string; rounds: number }>;
  biggestWin: {
    id: string;
    game: string;
    bet: number;
    payout: number;
    username: string | null;
  } | null;
  /** Streak Freeze saves in the covered day (kind='streak_freeze' rows). */
  streakSaves: number;
}

/** Weekly recap inputs: one ISO week (Mon–Sun UTC) plus the prior week's
 *  total for the trend line. Fallback-safe like the daily builder. */
export interface ArcadeWeeklyInput {
  /** ISO week label for the slug (e.g. "2026-W39"). */
  isoWeek: string;
  /** Inclusive Monday of the covered week (YYYY-MM-DD). */
  weekStart: string;
  /** Inclusive Sunday of the covered week (YYYY-MM-DD). */
  weekEnd: string;
  roundsByGame: Array<{ id: string; game: string; rounds: number }>;
  /** Total settled rounds in the week BEFORE — null when unknowable. */
  priorWeekTotal: number | null;
  biggestWin: {
    id: string;
    game: string;
    bet: number;
    payout: number;
    username: string | null;
  } | null;
  /** Streak Freeze saves in the covered week (kind='streak_freeze' rows). */
  streakSaves: number;
}

/** ISO week label ("2026-W39") from a UTC date inside that week, via the
 *  Thursday rule — the ISO year must come from Thursday, not the calendar
 *  year, or year boundaries mislabel (2026-12-28 belongs to 2027-W01). */
export function isoWeekLabel(date: Date): string {
  const thursday = new Date(date.getTime());
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  const isoYear = thursday.getUTCFullYear();
  const jan4 = Date.UTC(isoYear, 0, 4);
  const week1Mon = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * 86_400_000;
  const week = Math.floor((thursday.getTime() - week1Mon) / 604_800_000) + 1;
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/** Pure builder for the daily arcade recap article (>= MIN_CONTENT_CHARS,
 *  GENERIC_CONTEXT_BLOCK as the backstop). */
export function buildArcadeHighlightsArticle(input: ArcadeHighlightsInput): {
  content: string;
  excerpt: string;
  title: string;
} {
  const totalRounds = input.roundsByGame.reduce((sum, g) => sum + g.rounds, 0);
  const played = input.roundsByGame.filter((g) => g.rounds > 0);
  const sorted = [...played].sort((a, b) => b.rounds - a.rounds);
  const top = sorted[0] ?? null;
  const runnerUp = sorted[1] ?? null;
  const [y, m, d] = input.day.split("-");
  const dateLabel = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
    .toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });

  const lines: string[] = [
    `## The day in the Badge Arcade`,
    "",
    totalRounds > 0
      ? `On ${dateLabel} the community settled **${totalRounds.toLocaleString("en-US")} rounds** across ${played.length === 1 ? "one game" : `${played.length} of 13 games`}. Every round was server-authoritative, capped at the house stake, and graded by the same engine that powers the [statistics dashboard](/en/stats).${input.streakSaves > 0 ? ` The same ledger also recorded **${input.streakSaves} Streak ${input.streakSaves === 1 ? "Freeze" : "Freezes"}** spent — ${input.streakSaves === 1 ? "a game streak" : `${input.streakSaves} game streaks`} bridged through a missed day instead of resetting.` : ""}`
      : `On ${dateLabel} the arcade floors stayed quiet — not a single round was settled. The boards are always open: pick a game on the [arcade overview](/en/games), set a stake between the posted limits, and the next recap could carry your name.`,
    "",
  ];

  if (top) {
    lines.push(
      "## Most played game",
      "",
      `**[${top.game}](/en/games/${top.id}?ref=recap)** drew the crowd with **${top.rounds.toLocaleString("en-US")} ${top.rounds === 1 ? "round" : "rounds"}**.`,
      runnerUp
        ? `[${runnerUp.game}](/en/games/${runnerUp.id}?ref=recap) followed at ${runnerUp.rounds.toLocaleString("en-US")} rounds — a gap of ${(top.rounds - runnerUp.rounds).toLocaleString("en-US")} between first and second place.`
        : "No other table saw action, making it a clean sweep for the day.",
      "",
      "The full board:",
      "",
      ...sorted.map((g) => `- [${g.game}](/en/games/${g.id}?ref=recap): ${g.rounds.toLocaleString("en-US")} ${g.rounds === 1 ? "round" : "rounds"}`),
      "",
    );
  }

  if (input.biggestWin) {
    const net = input.biggestWin.payout - input.biggestWin.bet;
    lines.push(
      "## Biggest win of the day",
      "",
      input.biggestWin.username
        ? `**${input.biggestWin.username}** took the day's largest payout on **[${input.biggestWin.game}](/en/games/${input.biggestWin.id}?ref=recap)** — a staked ${input.biggestWin.bet.toLocaleString("en-US")} BadgesCoins returning ${input.biggestWin.payout.toLocaleString("en-US")}, for a net of **+${net.toLocaleString("en-US")} BadgesCoins**.`
        : `The day's largest payout landed on **[${input.biggestWin.game}](/en/games/${input.biggestWin.id}?ref=recap)** — a staked ${input.biggestWin.bet.toLocaleString("en-US")} BadgesCoins returning ${input.biggestWin.payout.toLocaleString("en-US")}, for a net of **+${net.toLocaleString("en-US")} BadgesCoins**.`,
      "",
      "Wins like this feed straight into XP, levels and the achievement catalog — the same ledger that the [live activity feed](/en/feed) shows in real time.",
      "",
    );
  }

  let content = lines.join("\n");
  if (content.length < MIN_CONTENT_CHARS) {
    content += (content.endsWith("\n") ? "" : "\n") + "\n" + GENERIC_CONTEXT_BLOCK;
  }

  const title = `Arcade highlights — ${dateLabel}`;
  const excerpt =
    totalRounds > 0
      ? `${dateLabel} in the Badge Arcade: ${totalRounds.toLocaleString("en-US")} settled rounds, ${top ? `${top.game} on top` : "a quiet board"}${input.biggestWin ? `, and the day's biggest win of +${(input.biggestWin.payout - input.biggestWin.bet).toLocaleString("en-US")} BadgesCoins` : ""}${input.streakSaves > 0 ? `, ${input.streakSaves} Streak ${input.streakSaves === 1 ? "Freeze" : "Freezes"} spent` : ""}.`
      : `${dateLabel} in the Badge Arcade: a quiet day with no settled rounds — the boards stay open for the next player.`;

  return { content, excerpt, title };
}

/** Pure builder for the weekly arcade recap article (>= MIN_CONTENT_CHARS,
 *  GENERIC_CONTEXT_BLOCK as the backstop). */
export function buildArcadeWeeklyArticle(
  input: ArcadeWeeklyInput,
): { content: string; excerpt: string; title: string } {
  const totalRounds = input.roundsByGame.reduce((sum, g) => sum + g.rounds, 0);
  const played = input.roundsByGame.filter((g) => g.rounds > 0);
  const sorted = [...played].sort((a, b) => b.rounds - a.rounds);
  const top = sorted[0] ?? null;
  const [y, m, d] = input.weekStart.split("-");
  const startLabel = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
    .toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric" });
  const [ey, em, ed] = input.weekEnd.split("-");
  const endLabel = new Date(Date.UTC(Number(ey), Number(em) - 1, Number(ed)))
    .toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });

  const priorLabel =
    input.priorWeekTotal === null
      ? null
      : `${input.priorWeekTotal.toLocaleString("en-US")} ${input.priorWeekTotal === 1 ? "round" : "rounds"}`;
  const trend =
    input.priorWeekTotal === null
      ? null
      : input.priorWeekTotal === 0
        ? "up from a silent week before"
        : totalRounds >= input.priorWeekTotal
          ? `up ${Math.round(((totalRounds - input.priorWeekTotal) / input.priorWeekTotal) * 100)}% on the week before (${priorLabel})`
          : `down ${Math.round(((input.priorWeekTotal - totalRounds) / input.priorWeekTotal) * 100)}% on the week before (${priorLabel})`;

  const lines: string[] = [
    "## The week in the Badge Arcade",
    "",
    totalRounds > 0
      ? `From Monday ${startLabel} to Sunday ${endLabel} the community settled **${totalRounds.toLocaleString("en-US")} rounds** across ${played.length === 1 ? "one game" : `${played.length} of 13 games`}${trend ? ` — ${trend}` : ""}. One post per week, computed from the same server-authoritative ledger that powers the [statistics dashboard](/en/stats).${input.streakSaves > 0 ? ` Across the week, **${input.streakSaves} Streak ${input.streakSaves === 1 ? "Freeze" : "Freezes"}** bridged missed days and kept ${input.streakSaves === 1 ? "a game streak" : `${input.streakSaves} game streaks`} alive.` : ""}`
      : `From Monday ${startLabel} to Sunday ${endLabel} the arcade floors stayed completely quiet — not a single settled round in seven days. The boards never close: pick a game on the [arcade overview](/en/games), and next week's recap could open with your name.`,
    "",
  ];

  if (top) {
    lines.push(
      "## Game of the week",
      "",
      `**[${top.game}](/en/games/${top.id}?ref=recap)** carried the week with **${top.rounds.toLocaleString("en-US")} ${top.rounds === 1 ? "round" : "rounds"}**.`,
      "",
      "The full weekly board:",
      "",
      ...sorted.map(
        (g) => `- [${g.game}](/en/games/${g.id}?ref=recap): ${g.rounds.toLocaleString("en-US")} ${g.rounds === 1 ? "round" : "rounds"}`,
      ),
      "",
    );
  }

  if (input.biggestWin) {
    const net = input.biggestWin.payout - input.biggestWin.bet;
    lines.push(
      "## Biggest win of the week",
      "",
      input.biggestWin.username
        ? `**${input.biggestWin.username}** landed the week's largest payout on **[${input.biggestWin.game}](/en/games/${input.biggestWin.id}?ref=recap)** — a staked ${input.biggestWin.bet.toLocaleString("en-US")} BadgesCoins returning ${input.biggestWin.payout.toLocaleString("en-US")}, for a net of **+${net.toLocaleString("en-US")} BadgesCoins**.`
        : `The week's largest payout landed on **[${input.biggestWin.game}](/en/games/${input.biggestWin.id}?ref=recap)** — a staked ${input.biggestWin.bet.toLocaleString("en-US")} BadgesCoins returning ${input.biggestWin.payout.toLocaleString("en-US")}, for a net of **+${net.toLocaleString("en-US")} BadgesCoins**.`,
      "",
      "Every payout flows into XP, levels and the achievement catalog — the same ledger behind the [live activity feed](/en/feed).",
      "",
      "Daily recaps with per-day numbers publish every morning; this weekly edition steps back for the record book.",
      "",
    );
  }

  let content = lines.join("\n");
  if (content.length < MIN_CONTENT_CHARS) {
    content += (content.endsWith("\n") ? "" : "\n") + "\n" + GENERIC_CONTEXT_BLOCK;
  }

  const title = `Arcade weekly — ${input.isoWeek}`;
  const excerpt =
    totalRounds > 0
      ? `Week ${input.isoWeek} (${startLabel}–${endLabel}): ${totalRounds.toLocaleString("en-US")} settled rounds${top ? `, ${top.game} as game of the week` : ""}${input.biggestWin ? `, biggest win +${(input.biggestWin.payout - input.biggestWin.bet).toLocaleString("en-US")} BadgesCoins` : ""}${input.streakSaves > 0 ? `, ${input.streakSaves} Streak ${input.streakSaves === 1 ? "Freeze" : "Freezes"} bridged missed days` : ""}.`
      : `Week ${input.isoWeek} (${startLabel}–${endLabel}): a silent week with no settled rounds.`;

  return { content, excerpt, title };
}

/**
 * Auto-publish a "new badge drop" blog post when the catalog sync detects a
 * badge for the first time. Marked is_auto so editors can tell machine posts
 * from editorial ones. The article is guaranteed >= 600 characters
 * (MIN_CONTENT_CHARS): the builder appends a fixed context block if a
 * template regression ever drops below the floor (defense in depth — with the
 * current template the worst case is ~2,100 chars).
 *
 * Returns whether a post was published this call (false on failure OR on an
 * idempotent re-run) so the sync can count fan-out failures.
 */
export async function createDropPost(
  badge: AutoPostBadgeInfo,
  client?: SupabaseClient,
  context: DropPostContext = {},
): Promise<boolean> {
  try {
    const supabase = client ?? createAdminClient();
    const { content, excerpt } = buildDropArticle(badge, context);
    if (content.length < MIN_CONTENT_CHARS) {
      // Should be unreachable — the builder appends the fallback itself.
      console.warn(
        "[blog] drop post length guard fired for",
        badge.slug,
        `(${content.length} chars)`,
      );
    }
    // `.select("id")` so the changelog row below only fires on a real insert
    // (ignoreDuplicates makes a re-run write nothing — same contract as
    // createFeaturePost).
    const { data: inserted, error } = await supabase
      .from("blog_posts")
      .upsert(
        {
          slug: `drop-${badge.slug}`,
          title: `New badge drop: ${badge.title}`,
          excerpt,
          content,
          cover_url: badge.imageUrl2x,
          status: "published",
          is_auto: true,
          tags: ["drop", badge.category],
        },
        { onConflict: "slug", ignoreDuplicates: true },
      )
      .select("id");
    if (error) throw error;
    if (!inserted || inserted.length === 0) return false;
    await supabase
      .from("changelog")
      .insert({
        kind: "blog",
        title: `Blog post published: New badge drop: ${badge.title}`,
        body: excerpt,
        payload: { slug: `drop-${badge.slug}`, chars: content.length },
      })
      .then(() => undefined, () => undefined);
    return true;
  } catch (error) {
    console.warn("[blog] auto drop post failed:", error);
    return false;
  }
}

export interface FeaturePostInput {
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  tags?: string[];
  cover?: string | null;
}

/**
 * Auto-publish a blog post for a shipped feature, game or special event
 * (turbo jackpot, …). Idempotent by slug.
 *
 * Returns whether a post was published this call (false on an idempotent
 * re-run) so daily callers can gate push fan-out on it — createDropPost's
 * contract, which the daily arcade-highlights sync relies on.
 */
export async function createFeaturePost(post: FeaturePostInput): Promise<boolean> {
  const supabase = createAdminClient();
  // `.select("id")` makes the upsert report whether it inserted: with
  // `ignoreDuplicates` a re-run writes nothing, but the changelog row below was
  // written unconditionally, so every call claimed a publication that had not
  // happened (the live table held 139 of these rows under 24 distinct titles).
  const { data: inserted, error } = await supabase
    .from("blog_posts")
    .upsert(
      {
        slug: post.slug,
        title: post.title,
        excerpt: post.excerpt,
        content: post.content,
        cover_url: post.cover ?? null,
        status: "published",
        is_auto: true,
        tags: ["feature", ...(post.tags ?? [])],
      },
      { onConflict: "slug", ignoreDuplicates: true },
    )
    .select("id");
  if (error) throw error;
  if (!inserted || inserted.length === 0) return false;
  await supabase.from("changelog").insert({
    kind: "blog",
    title: `Blog post published: ${post.title}`,
    body: post.excerpt,
    payload: { slug: post.slug },
  }).then(() => undefined, () => undefined);
  return true;
}
