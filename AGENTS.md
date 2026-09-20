# AGENTS.md — Twitch Badges Database

Real-time database of every global Twitch badge. Next.js 16 (App Router) +
TypeScript + Tailwind v4 + next-intl (11 locales) + Supabase + Vercel Cron.
Read `README.md` for data sources and setup; read this file before editing.

## Layout

- `src/app/[locale]/` — all pages (locale-prefixed, `localePrefix: "always"`)
- `src/app/api/` — cron endpoints, push, inventory sync, OG images, RSS
- `src/lib/twitch/` — external data services (helix, ivr, badgebase, potat, perfil)
- `src/lib/syncs/` — sync engines shared by `scripts/*.ts` AND `/api/cron/*`
- `src/lib/` — queries.ts (DB reads via server client), rarity.ts (TBRI),
  changelog.ts, inventory.ts, push.ts, markdown.ts, seo.ts
- `src/components/`, `messages/` (one JSON per locale), `supabase/migrations/`, `scripts/`

## Commands

```
npm run dev | build | lint | typecheck
npm run db:apply        # apply supabase/migrations/0001_init.sql (needs SUPABASE_DB_URL)
npm run sync:global | sync:badgebase | sync:potat
npm run send:push -- "Title" "Body" "/en/badges/slug"
```

Verification ritual: `lint && typecheck && build` before finishing any change.

## Architecture rules

- **Service-role client** (`src/lib/supabase/admin.ts`) only in scripts, cron
  routes and server push code. Never import it from client components.
- **Sync engines live in `src/lib/syncs/`** — scripts and Vercel cron routes
  call the same functions; don't duplicate sync logic.
- **Every sync mutation must write a changelog row** via `logChange()` — the
  changelog page is fully automatic by design.
- **New badges** (non-seed runs) trigger changelog + notification + web push +
  auto blog post. Initial-seed runs (empty catalog) are detected and skipped.
- Pages read through `src/lib/queries.ts` (anon key + RLS); most catalog
  queries are wrapped in `.catch(() => …)` so an un-migrated DB renders empty
  states, not crashes.
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
  `eslint-disable-next-line react-hooks/purity`).
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
- badgebase.de detail pages expose dates via `data-ts=` / `data-reset=`
  attributes (seconds); match feed items to catalog rows by badge image UUID,
  fallback set_id.

## Deployment

Repo: `github.com/LULdev/twitch-badges-database` (private, `main`). Live on
Vercel as `luul/twitch-badges-database`, production URL
`twitch-badges-database.vercel.app`. Env vars for production AND preview are
configured on the Vercel project.

⚠ **2026-09-20: all NEW Vercel deployments are platform-BLOCKED** (instant
`BLOCKED` readyState, no build machine, no error message — even
`--prebuilt` uploads). The existing production deployment keeps serving
fine. Git integration was disconnected during diagnosis; once deploys work
again, re-run `vercel git connect https://github.com/LULdev/twitch-badges-database.git
--scope luul --yes` to get git-push production deploys. The optimized
potat-sync code (bulk upserts, ~6s) is committed on `main` but NOT yet
deployed for this reason.

**Sync schedule** (Vercel Hobby = max 2 cron jobs, daily only):
- `/api/cron/global` (catalog diff + badgebase enrichment) — daily 06:00 UTC
- `/api/cron/potat` (owner stats, rarity, status sweeps) — daily 06:30 UTC
- **Every 15 minutes**: GitHub Actions `.github/workflows/potat-sync.yml`
  hits `/api/cron/potat` with the `CRON_SECRET` repo secret (verified
  working — run 35483603783). Don't add sub-daily schedules to vercel.json
  (Hobby rejects the deploy).

The potat sync writes in chunked bulk upserts — per-row PATCH loops would
exceed the 60s serverless limit; keep it that way.

After changing the production domain, update `NEXT_PUBLIC_SITE_URL` on
Vercel and add the domain to Supabase → Auth → URL Configuration
(`https://<domain>/auth/callback`) or Twitch login will loop.
