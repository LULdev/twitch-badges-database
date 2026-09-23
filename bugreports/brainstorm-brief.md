# Brainstorming brief — 45 new feature ideas

You are brainstorming NEW feature ideas for **Twitch Badges Database**, a live
website that tracks every global Twitch badge. Reading task only: do not modify
any project file except your single output file. Do not touch the database.

## Step 1 — read what already exists (MANDATORY, the whole file)

Read `C:\Users\LUL\Twitch-Badges-Database\bugreports\existing-ideas-inventory.md`
in full. It lists **229 ideas already on the site's idea board**, each with a
gist. Your output is machine-checked against that list **and** against the live
database.

**The test is meaning, not wording.** "Badge Time Machine" and "a slider to see
the catalog in the past" are the same idea and the second one will be rejected.
If you catch yourself producing a synonym of an existing idea, delete it and
invent something genuinely different. This is the single most important
requirement: an idea that merely rewrites an existing one is worse than no idea,
because it has to be manually removed.

## Step 2 — what is already BUILT (never propose an existing feature)

- Catalog of ~476 badges: status pages (active / upcoming / expired), search,
  filters, drop countdowns, status sweeps, detail pages with HowTo structured
  data, an Open Graph image route.
- Rarity index (TBRI) with tiers, rarity momentum, rarity leaders.
- Owner-count statistics per badge, leaderboards, a two-member compare view.
- Member profiles resolved from Twitch login, badge inventory synced from the
  account, a 6-slot showcase, ~35 customization settings, mood status, view
  counters, public/private inventory, steal settings, level badge, role badges.
- XP/level system, levels 1–100 with per-level badges, an XP curve and an XP
  source breakdown. BadgesCoins with lifetime won/lost totals.
- 125 self-evaluating achievements. 13 server-authoritative games (RPS, slots,
  shooter, memory, quiz, coin-flip ladder, higher-or-lower, roulette, blackjack,
  vault, scratch, tower, drops catcher) with per-game bet limits, a 1/second
  rate limit, XP for win (10) and loss (2).
- A daily wheel with a Turbo jackpot (1 in 100m). Daily login bonus and streaks.
  Coin stealing (heists) with per-member price/max and flood control. Coin rain.
- Live activity feed, in-app notifications, web push (VAPID).
- Blog with automatic drop posts, automatic changelog with RSS, FAQ, 11 locales
  including Arabic RTL, an animated public `/stats` dashboard, heartbeat-based
  uptime monitoring, ranked leaderboards.
- Admin control panel with ten tabs: users, content, badges, sync, settings,
  statistics, status, newsletter, ideas, audit log. Economy values, feature
  flags, maintenance mode and per-game switches are configurable from it.

### Data the site already has (build on this)

- the official Twitch Helix badge catalog; badgebase.de drop windows
  (start/end dates); potat.app per-badge owner counts and per-user ownership;
  badges.blog per-user ownership resolution;
- an internal `badge_stats` owner-count time series per badge;
- `badge_events` history; `changelog`; inventory snapshots; `game_rounds`;
  `steal_attempts`; `activity_events`; `user_progress` (XP, coins, streaks, game
  counters); `user_achievements`; `system_heartbeats`; an anonymous page-view
  analytics table (path, locale, referrer host, client class, screen width,
  timezone offset, duration, salted visitor hash).

### Engineering constraints

Next.js 16 App Router on **Vercel Hobby** (only 2 daily cron jobs, plus a GitHub
Actions job hitting one cron endpoint every 15 minutes; serverless functions
have a 60 s limit, 120 s for some admin routes), TypeScript, Tailwind v4,
Supabase (Postgres + RLS) read through PostgREST with an anon key and written
through a service-role client. Syncs write in chunked bulk upserts because
per-row loops exceed the serverless limit. Ideas that need a long-running server,
a websocket daemon or a paid tier should say how they would work within these
constraints (or be honest that they need one).

## Step 3 — the rules for every idea

1. **Specific to this site.** Not generic product advice that would fit any SaaS.
2. **Name the mechanism.** What the visitor sees and does, what data it reads,
   how it computes or behaves. A wish without a mechanism is not an idea.
3. **Genuinely different in meaning from all 229 existing ideas.**
4. **Different from each other.** No two of your own ideas may be the same
   idea twice.
5. **Effort estimate** in the body: `Effort: S` (about a day), `M` (a few days),
   or `L` (a week or more).
6. **Risk note** in the body: `Risk if built badly: …` — the concrete way this
   goes wrong (economy exploit, privacy leak, stale data, grind, worse
   performance).
7. Include a one-sentence `why` field: why it earns a place on a badge site.

**Forbidden:** renaming an existing idea; filler ("add dark mode", "improve
performance"); restyling an existing feature and calling it new; blockchain and
NFT ideas; anything that exposes another member's private data.

## Step 4 — write the output file

Write your assigned JSON file with EXACTLY this shape and nothing else in it:

```json
{
  "agent": "<your scope id>",
  "scope": "<your scope, one line>",
  "ideas": [
    {
      "category": "<your assigned category>",
      "title": "Short concrete title, 3-8 words",
      "body": "2-5 sentences: what it is, how it works here, which data it uses. Then: Effort: M. Risk if built badly: ...",
      "why": "One sentence on why this earns a place on a Twitch badge site."
    }
  ]
}
```

Valid JSON only: no trailing commas, no comments, no markdown fences, no text
outside the object. Exactly 45 entries in `ideas` (unless your prompt says
otherwise), every one using the category you were assigned.

## Step 5 — self-check before finishing

1. Re-read your list against the inventory and ask of each idea: "is this
   already on the board under another name?" Replace the ones that are.
2. Check your own list for internal duplicates.
3. Verify the JSON parses:
   `node -e "const d=JSON.parse(require('fs').readFileSync('<path>','utf8'));console.log(d.ideas.length)"`
   and that it prints 45.

Report back: how many ideas you wrote, and which ideas you dropped during the
self-check because they restated an existing one (name them).
