# Twitch Badges Database — Full Site Build

Fresh, English-first build in `C:\Users\LUL\Twitch-Badges-Database`, reusing the existing Supabase project + Twitch OAuth app from the old `twitchbadges` project. All data sources below were verified live during research.

## Stack
- **Next.js 16 App Router + TypeScript + Tailwind CSS v4** (dark/light via class strategy, no-flash theme script, dark default)
- **next-intl** — 10 locales: `en` (default), `pt`, `es`, `fr`, `ru`, `zh`, `ar` (RTL), `ja`, `it`, `ko` — `/{locale}/...` prefix routing with hreflang alternates
- **Supabase** (existing project) — Postgres + Auth (Twitch provider) + RLS on every table
- **Vercel** + Vercel Cron; **Recharts** for stats; **web-push** (VAPID) for desktop notifications; **@vercel/og** for share images; **fast-xml-parser** for RSS

## Verified data pipeline
| Data | Source | Sync |
|---|---|---|
| Badge catalog (images, titles, click URLs) | Twitch Helix `GET /helix/chat/badges/global` + `?broadcaster_id=` (client-credentials app token); IVR mirror as fallback | 2×/day diff |
| Drop dates, expiry windows, upcoming badges | badgebase.de RSS feed + detail-page scrape (start/end dates) | daily |
| Per-badge owner counts, active counts, % | `api.potat.app/twitch/badges` + `?owners=true` (first≤200, cursor pagination, respect `Retry-After: 60`) | every 15 min → time series |
| **Badges a user owns** | `https://www.badges.blog/api/perfil?username=` (as you directed — returns full global + own-channel badge list, live, no auth) with direct Twitch GQL user-badges query as automatic fallback | on login + on demand; powers compare |
| Worldwide collector leaderboards | potat `?owned=true` user leaderboard + badges.blog `/api/ranking` (top-100) + site-internal leaderboards | daily / on demand |

Note: badges.blog's ToS prohibits heavy automated collection without permission — we use `/api/perfil` politely (cached, rate-limited) exactly as you asked, and the GQL fallback keeps the feature alive regardless.

## Database (new migrations; old tables dropped — zero users, nothing lost)
`badges` (set_id, version, slug, images, category, is_paid, how_to_earn, release/start/end dates, status: active|upcoming|expired|removed, first_seen) · `badge_stats` (time series: owner_count, active_count, percentage) · `badge_events` (history log) · `profiles` (username unique, twitch_id, avatar, bio, banner, theme, showcase_slots, settings; `is_admin`; email kept private) · `user_inventory` (synced owned badges + acquired_at) · `user_sync_state` · `changelog` (kind: badge_added|badge_updated|badge_removed|data_sync|feature|bugfix, title, body, payload jsonb, created_at — **auto-written by every sync mutation**, plus manual entries) · `blog_posts` · `push_subscriptions` · `notifications`. RLS hardened per the old project's conventions (insert+update policies, restrictive grants).

## Routes (SEO slugs, locale-prefixed)
- `/[locale]` — live badges with countdowns, upcoming drops, stats teasers, latest blog + changelog
- `/[locale]/badges` — all badges; filters: search, Free/Paid, category, status, rarity tier, sort; paginated SSR
- `/[locale]/badges/[slug]` — detail: image, how to earn, live countdown, rarity tier + formula, owner-count chart, user counter, comments (stretch)
- `/[locale]/active` · `/upcoming` · `/expired`
- `/[locale]/leaderboards` — worldwide collectors (potat), per-badge owners, rarest collections, site collectors
- `/[locale]/compare?users=a,b` — any two Twitch usernames (perfil sync both sides, owned/missing diff)
- `/[locale]/profile/[username]` — public profile: Twitch avatar/username, badge showcase slots, stats, shareable URL, OG share card, customizable settings (banner, theme, bio, privacy) when own
- `/[locale]/inventory` — after Twitch login: owned vs. missing badges
- `/[locale]/blog` + `/[locale]/blog/[slug]` — new-drop auto-drafts from sync + editorial posts (admin-gated)
- `/[locale]/changelog` — every change auto-logged with timestamp, filterable, RSS feed
- `/[locale]/stats` — totals, time-series charts, category/rarity breakdowns
- `/[locale]/notifications`, `/account`, `/login`; `/auth/callback`
- `sitemap.ts`, `robots.ts`, JSON-LD, per-page OG/twitter meta, PWA manifest

## Key features
- **Real-time**: 15-min potat cron + 2×/day catalog diff + client-side SWR polling + ticking countdowns; new-badge flow: diff → changelog entry → web-push notification → blog draft
- **Rarity (proprietary formula)**: score 0–100 from owner-count percentile, active/owner retention ratio, claim-window scarcity (limited vs permanent), and badge age → tiers (Common → Mythic), formula documented on-site
- **Desktop notifications**: VAPID web-push + service worker, opt-in with per-event filters
- **i18n**: 10 languages, RTL for Arabic, persisted locale preference

## Build order
1. Scaffold: Next.js + Tailwind + next-intl + Supabase clients + env + theme/layout/nav
2. Migrations + RLS + seed
3. Data services (helix / badgebase / potat / perfil+GQL) + sync scripts + Vercel Cron + changelog auto-logging + rarity
4. Catalog pages, filters, search, detail + countdowns
5. Twitch OAuth login + profiles + inventory sync + share cards
6. Leaderboards + stats + compare
7. Blog + changelog UI
8. Push notifications + service worker
9. Full 10-locale translations + RTL + localized SEO
10. SEO extras + PWA + polish (a11y, responsive, perf)
11. Verify: `lint && typecheck && build`, run syncs against live APIs, dev-server smoke test of all routes

## Setup carried over from old project
- `.env.local` populated from `C:\Users\LUL\twitchbadges\.env.local` (Supabase URL/keys, Twitch client ID/secret, CRON_SECRET, VAPID keys) + new `NEXT_PUBLIC_SITE_URL`
- Twitch app redirect URI updated for the new dev origin; old Supabase tables replaced

## Known gotchas (from the prior build — already accounted for)
potat `first` max 200 / Retry-After 60 · Next 16 async `params`/`searchParams`, `proxy.ts` not middleware · Helix channel-badges URL is `/helix/chat/badges?broadcaster_id=` · `profiles.email` never exposed via RLS · `.maybeSingle()` null checks · no `#` in project path (satisfied)