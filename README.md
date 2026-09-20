# Twitch Badges Database

A real-time database of every global Twitch badge: live drops with countdown
timers, upcoming releases, a proprietary rarity index, worldwide collector
leaderboards, Twitch login with owned/missing tracking, profiles, blog,
auto-logged changelog, desktop notifications, dark/light themes — in 11
languages.

## Stack

- **Next.js 16** (App Router, Turbopack) + TypeScript + Tailwind CSS v4
- **next-intl** — `en`, `pt`, `es`, `fr`, `de`, `ru`, `zh`, `ar` (RTL), `ja`, `it`, `ko`
- **Supabase** — Postgres, Auth (Twitch OAuth), RLS
- **Vercel** + Vercel Cron
- Recharts (stats), web-push (desktop notifications), @vercel/og (share cards)

## Data sources

| Data | Source | Sync |
|---|---|---|
| Badge catalog | Twitch Helix `chat/badges/global` (with own app credentials) or the public IVR mirror `api.ivr.fi` | 2×/day |
| Drop windows (start/end, free/paid, how-to-earn) | badgebase.de RSS + detail pages | daily |
| Owner/active counts, rarity inputs, worldwide leaderboards | `api.potat.app` (`/twitch/badges`, `?owners=true`, `?owned=true`) | every 15 min |
| Badges a user owns (live) | `badges.blog /api/perfil?username=` with Twitch GQL as automatic fallback | on login / on demand |

Rarity (TBRI) = 45% owner scarcity (log-scaled) + 15% wear (share of owners
still displaying it) + 25% claim-window obtainability + 10% age → 0–100 score
across six tiers.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in the values (see below)
npm run db:apply             # create/replace the schema (needs SUPABASE_DB_URL)
npm run sync:global          # populate the catalog from the Twitch API
npm run sync:badgebase       # enrich with drop windows + insert upcoming badges
npm run sync:potat           # owner counts, rarity, status sweeps
npm run dev
```

### Environment variables

Everything lives in `.env.local` (see `.env.example` for documentation):

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` — Supabase project (Dashboard → Settings → API)
- `SUPABASE_DB_URL` — Postgres connection string (Dashboard → Settings →
  Database). **Only needed for `npm run db:apply`.**
- `NEXT_PUBLIC_SITE_URL` — `http://localhost:3000` in dev, your domain in prod
- `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` — optional; a dev.twitch.tv app
  for Helix app-access tokens. Without them the catalog sync uses the IVR
  mirror automatically.
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` /
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY` — web push keys. Generate with
  `node -e "console.log(require('web-push').generateVAPIDKeys())"`
- `CRON_SECRET` — Bearer token required by `/api/cron/*`
- `ADMIN_LOGINS` — comma-separated Twitch logins allowed to manage content

### Supabase Auth (Twitch login)

1. Dashboard → Authentication → Providers → Twitch (client id + secret from
   dev.twitch.tv; redirect URI `https://<project>.supabase.co/auth/v1/callback`)
2. Authentication → URL Configuration → add `http://localhost:3000/auth/callback`
   (and your production URL) to the allowed redirect URLs.

The `handle_new_user` trigger creates the profile row on first login.

## Gamification

Logged-in collectors earn XP and coins: daily login (+10 XP, +50 coins, streak
bonus), unlocking Twitch badges (+1,000 XP / +500 coins each), 125 achievements,
13 arcade games and a daily Wheel of Fortune (XP 25–2,500; Twitch Turbo jackpot
at probability 1 : 100,000,000). Levels 1–100 (curve: 100 + (L-1)·50 XP →
254,900 total) render unique sparkle-animated level badges that are always
visible on profiles. Every XP event streams to the public live feed (`/feed`).
Extras: coin heists with victim-configured prices and flood checks, coin rain,
35 profile customization settings, visitor tracking with 5-minute IP dedup,
and a blog with view counters + emoji reactions (23 seeded posts, all 300+
words) plus a 20-question FAQ in all languages. DB tables in
`supabase/migrations/0003_gamification.sql`; blog seeds in `scripts/`.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | develop / build / serve |
| `npm run lint` / `typecheck` | ESLint / TypeScript |
| `npm run db:apply` | apply `supabase/migrations/0001_init.sql` |
| `npm run sync:global` | catalog diff → new badges → changelog → blog → push |
| `npm run sync:badgebase` | drop windows + upcoming badges |
| `npm run sync:potat` | owner stats time series + rarity + status sweeps |
| `npm run send:push -- "Title" "Body" "/en/badges/slug"` | manual push broadcast |

## Deployment (Vercel)

- Import the repo, set the same environment variables.
- `vercel.json` registers the crons: catalog 2×/day, badgebase daily,
  potat every 15 minutes (Vercel sends `Authorization: Bearer $CRON_SECRET`).

## Architecture notes

- `src/proxy.ts` — combines next-intl locale routing with Supabase session
  refresh (Next 16's middleware replacement).
- Every mutation from the sync engines writes a timestamped `changelog` row —
  the changelog page is fully automatic.
- New badges trigger: changelog entry → in-app notification → web push →
  auto-published blog post (marked "Auto-generated", editable later).
- RLS everywhere; catalog/content tables are read-only for API roles;
  `profiles` never exposes email.
- Live countdowns tick client-side; catalog pages refresh server data once a
  minute via `LiveRefresher`.

## ToS note

badges.blog's terms prohibit *heavy* automated collection; this project queries
their `/api/perfil` endpoint politely (cached, low volume) exactly as its data
is displayed publicly, with Twitch's own GQL as an automatic fallback so the
feature never hard-depends on it.
