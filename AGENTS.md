# AGENTS.md — Twitch Badges Database

Real-time database of every global Twitch badge. Next.js 16 (App Router) +
TypeScript + Tailwind v4 + next-intl (11 locales) + Supabase + Vercel Cron.
Read `README.md` for data sources and setup; read this file before editing.

## Layout

- `src/app/[locale]/` — all pages (locale-prefixed, `localePrefix: "always"`)
- `src/app/api/` — cron endpoints, push, inventory sync, OG images, RSS
- `src/lib/twitch/` — external data services (helix, ivr, badgebase, potat, perfil).
  Status/role badges (moderator, VIP, partner, …) are EXCLUDED from the
  catalog (`isStatusSetId` in types.ts; global sync deletes any that exist).
  badgebase sync is the AUTHORITATIVE activity source: badges on /active get
  `is_confirmed_active` + status 'active'; everything else without a live
  window is demoted to 'expired' (sweep in runBadgebaseSync). Listing cards
  carry only `data-ts` (start) + `data-status`/`data-tags`/`data-count`; the
  **real claim window comes from the detail page's schema.org JSON-LD**
  (`temporalCoverage: "<start>/<end>"`, `datePublished` as fallback).
  **Never parse `data-reset`** — that attribute belongs to the site's channel-
  points/giveaway overlay (`.qlog-reset`) and always points at the next
  midnight; reading it once expired every redeemable badge.
  potat: /users/{login} enriches profiles after login;
  /twitch/badges?badge={id} feeds the live count on badge pages; the
  badge_momentum view feeds rarity momentum.
- `src/lib/syncs/` — sync engines shared by `scripts/*.ts` AND `/api/cron/*`
- `src/lib/` — queries.ts (DB reads via server client), rarity.ts (TBRI),
  changelog.ts, inventory.ts, push.ts, markdown.ts, seo.ts, health.ts
  (heartbeats), stats.ts (reads the `stats_*` views for `/stats`)
- `src/lib/gamification/` — XP/coins/levels (xp.ts, levels.ts), 125 achievements
  (achievements.ts, self-evaluating), games.ts (13 server-authoritative games),
  wheel.ts (daily wheel + Turbo jackpot 1:1e8), daily.ts (login bonus, heists,
  coin rain), visits.ts (5-min-IP-dedup view counters), session.ts
- `src/components/stats/` — animated chart set for the stats dashboard
  (CountUp, Reveal, TrendChart, DonutChart, DistributionBars, LevelHistogram,
  UptimeGauge, UptimeCalendar, AvailabilityStrip, LiveStatus, useChartTheme)
- `src/components/`, `messages/` (one JSON per locale), `supabase/migrations/`, `scripts/`

## Commands

```
npm run dev | build | lint | typecheck
npm run db:apply        # apply pending migrations once (supabase_migrations ledger)
npm run sync:global | sync:badgebase | sync:potat
npm run send:push -- "Title" "Body" "/en/badges/slug"
npm run log:change -- <feature|bugfix|data_sync|…> "Title" "Explanation" '{"json":"payload"}'
```

Verification ritual: `lint && typecheck && build` before finishing any change.

**Every change and every bug fix gets a changelog entry with a timestamp** —
`npm run log:change` (or `logChange()` in code) with a one-paragraph
explanation of what was changed and why. The `/changelog` page and its RSS
feed are generated from that table, so an undocumented change is invisible.

## Architecture rules

- **Service-role client** (`src/lib/supabase/admin.ts`) only in scripts, cron
  routes and server push code. Never import it from client components.
- **Sync engines live in `src/lib/syncs/`** — scripts and Vercel cron routes
  call the same functions; don't duplicate sync logic.
- **Every sync mutation must write a changelog row** via `logChange()` — the
  changelog page is fully automatic by design.
- **Every sync/health unit is wrapped in `withHeartbeat()`** (`src/lib/health.ts`)
  so `system_heartbeats` stays the single source of truth for uptime; the
  global cron prunes rows older than 90 days.
- **New badges** (non-seed runs) trigger changelog + notification + web push +
  auto blog post. Initial-seed runs (empty catalog) are detected and skipped.
- Pages read through `src/lib/queries.ts` (anon key + RLS); most catalog
  queries are wrapped in `.catch(() => …)` so an un-migrated DB renders empty
  states, not crashes.
- **Stats aggregation lives in Postgres** (`stats_*` views in migration 0004).
  They are `security_invoker = off` so aggregates over RLS tables are complete,
  but they expose only aggregates and non-sensitive profile columns
  (`username`, `avatar_url`) — never `profiles.email`.
- RLS: catalog/content tables are public-read, service-role-write only;
  `profiles` never exposes email.

## Conventions

- i18n: **all** UI strings go through `messages/<locale>.json`. Adding a
  locale = `src/i18n/routing.ts` (locales + `localeNames` + `localeHtmlLang`,
  all three are `Record<Locale,…>` — TS enforces completeness) + a new
  messages file + README count update. Keep all 11 files key-identical.
- Internal links: `import { Link } from "@/i18n/navigation"` — **named
  import, not default** (createNavigation exports named members).
- Styling: use the component classes in `src/app/globals.css`
  (`.card`, `.btn`, `.chip`, `.input`, `.badge-tile`, `.data-table`,
  `.prose-content`, `.countdown`) and the `--surface/--line/--accent` tokens;
  dark is the `:root` default, light overrides via `.light` on `<html>`.
- No emojis in UI; inline SVG icons.

## Gotchas (all hit and fixed — do not rediscover)

- **Next 16**: `params`/`searchParams` are **Promises** (`await params`);
  middleware file is `src/proxy.ts` (not middleware.ts).
- **ESLint flat config** must import `eslint-config-next/core-web-vitals` and
  `eslint-config-next/typescript` directly — FlatCompat fails with a circular-
  structure TypeError.
- **React Compiler lint rules**: no synchronous `setState` inside effect
  bodies (wrap in `requestAnimationFrame`/`setTimeout`); no `Date.now()`
  during component render (server components need an inline
  `eslint-disable-next-line react-hooks/purity`). Put the disable comment on
  the **line of the call**, not above the enclosing function — the rule
  reports the call site.
- **Build memory**: `next build` spawns 15 static-generation workers. On a
  machine with little free RAM the worker dies with exit code 134 /
  3221226505 and no readable error. Close the dev server, free memory and
  re-run; `NODE_OPTIONS=--max-old-space-size=4096` helps.
- **i18n keys must exist before the page renders**: next-intl throws
  `MISSING_MESSAGE` for unknown keys, and a page that builds keys dynamically
  (see `FAQ_KEYS` in `[locale]/faq/page.tsx`) fails silently per locale. After
  touching messages, check the build log for `MISSING_MESSAGE` — the build
  still succeeds, so nothing else will warn you.
- `useSearchParams()` must sit inside a `<Suspense>` boundary or prerendering
  fails (see `[locale]/auth/callback/page.tsx`).
- **satori OG images** (`/api/og/profile`): every div with >1 child needs an
  explicit `display: "flex"`.
- **potat.app**: `first` max 200 (400 above), honors `Retry-After: 60` on 429
  (handled in `potatFetch`).
- **Per-user badge ownership has NO official Twitch API** — it resolves via
  `badges.blog /api/perfil` (user-directed, keep volume polite) with Twitch
  GQL as fallback in `src/lib/twitch/perfil.ts`.
- **DB connection**: direct `db.<ref>.supabase.co` is IPv6-only and fails on
  this network. `.env.local` uses the session pooler
  `aws-1-eu-west-1.pooler.supabase.com` with user `postgres.<ref>`.
- **Scripts**: tsx runs in CJS mode — scripts use `config({path: ".env.local"})`
  first, then **dynamic** `import()` of `@/lib/…` so env vars load before
  module init. No top-level await.
- **NEXT_PUBLIC_ vars in client code must be STATIC references** — the
  bundler only inlines literal `process.env.NEXT_PUBLIC_X` member
  expressions at build time. Reading them through `envOr(name)` /
  `process.env[name]` (src/lib/env.ts) works on the server (real runtime
  `process.env`) but resolves to `undefined` in the browser bundle. This
  silently killed the Twitch login button (unhandled rejection, no visible
  error). `src/lib/supabase/browser.ts` therefore references its vars
  statically — keep env helpers out of any module a client component
  imports.
- badgebase.de detail pages expose dates via `data-ts=` / `data-reset=`
  attributes (seconds); match feed items to catalog rows by badge image UUID,
  fallback set_id.

## Deployment

Repo: `github.com/LULdev/twitch-badges-database` (private, `main`), connected
to Vercel project `luul/twitch-badges-database` — **every push to `main` is a
production deployment** (other branches get previews). Production URL:
`twitch-badges-database.vercel.app`. Env vars for production AND preview are
configured on the Vercel project.

(2026-09-20 note: Vercel briefly platform-blocked all new deployments for
~1h — instant `BLOCKED` state, no error, even prebuilt. It resolved itself;
if it recurs, check the Vercel dashboard for account notices and retry later.
Blocked deployments can be DELETEd via the v13 API; the cancel API 400s.)

**Sync schedule** (Vercel Hobby = max 2 cron jobs, daily only):
- `/api/cron/global` (catalog diff + badgebase enrichment) — daily 06:00 UTC
- `/api/cron/potat` (owner stats, rarity, status sweeps) — daily 06:30 UTC
- **Every 15 minutes**: GitHub Actions `.github/workflows/potat-sync.yml`
  hits `/api/cron/potat` with the `CRON_SECRET` repo secret (verified
  working). Don't add sub-daily schedules to vercel.json (Hobby rejects
  the deploy).

The potat sync writes in chunked bulk upserts (~6s) — per-row PATCH loops
would exceed the 60s serverless limit; keep it that way.

After changing the production domain, update `NEXT_PUBLIC_SITE_URL` on
Vercel and add the domain to Supabase → Auth → URL Configuration
(`https://<domain>/auth/callback`) or Twitch login will loop.
