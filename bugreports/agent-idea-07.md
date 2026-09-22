# Agent idea 07 — accessibility/inclusive design + performance/technical quality

Twelve ideas, six per lens. Each names the page, component or data path it
touches and the measurable outcome it moves.

## Arabic/RTL mirroring via CSS logical properties
- **Category**: accessibility
- **What**: `ar` is RTL but the layout ships Tailwind physical utilities
  (`left-*`/`right-*`, `ml-*`/`mr-*`, `text-left`), so mirrored content drifts:
  the header cluster, countdown badges and grid gutters sit on the wrong side
  while text is right-aligned. Convert the shell and the shared component
  classes in `src/app/globals.css` (`.card`, `.chip`, `.badge-tile`,
  `.data-table`) to logical properties (`ms-`/`me-`, `inset-inline-start`,
  `text-start`) so one rule set serves all 11 locales.
- **Where**: `src/app/globals.css`, `[locale]/layout.tsx` header, `.badge-tile`
  grid, countdown/stat chips.
- **Expected outcome**: zero axe/`dir`-mismatch violations and no horizontal
  overflow under `ar` at 360 px width; RTL regression caught per locale instead
  of shipping mirrored-looking-only pages.
- **Effort**: M

## Announce countdowns and the activity feed to screen readers
- **Category**: accessibility
- **What**: the Countdown timers tick every second and `/feed` prepends XP
  events with no user action, so a screen-reader user perceives a frozen page.
  Wrap the countdown's minute-boundary output (not each second) and the feed's
  new rows in `aria-live="polite"` regions with `aria-atomic` and a throttled
  update (e.g. max one announcement per 30 s), and mark the decorative ticking
  digits `aria-hidden`.
- **Where**: countdown component on badge detail pages, `/feed` live list.
- **Expected outcome**: feed/countdown changes are announced; DOM live-region
  mutations per minute drop from ~60 to ≤2, so assistive tech is not flooded.
- **Effort**: S

## Focus management and focus traps in game modals and the wheel
- **Category**: accessibility
- **What**: the 13 server-authoritative games and the daily wheel open result
  panels that keyboard users cannot reach without re-tabbing the whole page.
  Add a focus trap per modal, move focus to the result heading when a round
  resolves, restore focus to the trigger on close, and support `Esc`.
- **Where**: `src/lib/gamification/games.ts` consumers (game pages), the wheel
  page, shared modal component.
- **Expected outcome**: a keyboard-only user completes a round and dismisses the
  modal with no mouse; axe `focus-order-semantics` and tab-trap checks pass,
  and the tab-stop count to reach the result falls from dozens to 1.
- **Effort**: M

## Contrast and colour-independence for rarity tiers and charts
- **Category**: accessibility
- **What**: rarity is signalled by colour plus text, but the distribution bars,
  heatmap cells and the six-tier chips encode tier by hue alone, and light-theme
  `.light` tokens were never contrast-checked against every tier. Add a
  low-variant pattern/texture fill and a text/symbol label per tier, and raise
  any tier/token pair below AA 4.5:1 (3:1 for large/graphic) to pass.
- **Where**: `src/components/stats/` (`DistributionBars`, `TrendChart`,
  `DonutChart`, `useChartTheme`), rarity chips/badges, theme tokens in
  `globals.css`.
- **Expected outcome**: every rarity tier is distinguishable with colour
  removed; all tier/token pairs pass WCAG AA in both themes (measured with a
  contrast checker in CI).
- **Effort**: M

## Landmarks, skip link and one H1 per locale page
- **Category**: accessibility
- **What**: screen-reader navigation relies on a single `<main>` landmark, a
  skip-to-content link and a consistent heading outline, but locale layouts
  wrap content in nested divs without landmark roles and some pages open with
  an `h2`. Introduce a skip link targeting `#main`, mark header/nav/main/footer
  landmarks once in `[locale]/layout.tsx`, and enforce one `h1` per page.
- **Where**: `src/app/[locale]/layout.tsx`, all `[locale]/**/page.tsx`, header
  nav.
- **Expected outcome**: landmark-navigation audits pass; a keyboard user reaches
  main content in one `Tab`; heading-order violations drop to zero across all
  11 locales.
- **Effort**: S

## Respect `prefers-reduced-motion` in decorative animation
- **Category**: accessibility
- **What**: sparkle-animated level badges, the stats `Reveal`/`CountUp` set and
  the chart intro animations all run unconditionally, which can trigger motion
  sickness and add main-thread work. Gate every animation behind a
  `prefers-reduced-motion: reduce` media query (CSS) and a JS matchMedia check
  so reduced-motion users get static finals.
- **Where**: level-badge styling, `src/components/stats/` (`Reveal`, `CountUp`,
  `TrendChart`, `UptimeCalendar`), profile page.
- **Expected outcome**: with reduced motion enabled, zero non-essential
  transitions fire; long-task/main-thread time on `/stats` and profile pages is
  measurably lower for those users.
- **Effort**: S

## Collapse the `/badges` count + page + stats reads into one round trip
- **Category**: performance
- **What**: the catalog list runs several sequential PostgREST calls (exact
  count, page rows, aggregate stats), each a separate network hop inside
  `queries.ts`. Fold them into a single `select` with `{ count: "exact" }` and
  embedded/aggregated columns, or one SQL view; keep the existing
  `.catch(() => …)` empty-state fallback.
- **Where**: `src/lib/queries.ts` catalog read path, `/badges` page.
- **Expected outcome**: PostgREST calls per catalog render drop from 3+ to 1;
  TTFB on `/badges` falls proportionally to the removed round trips.
- **Effort**: M

## Tag-based ISR invalidation driven by the sync engines
- **Category**: performance
- **What**: catalog and detail pages currently wait out a fixed revalidate
  window after a sync. Ship them as ISR with per-route cache tags (catalog list,
  per-badge, rarity) and call `revalidateTag` from the sync engines right after
  they write, so an update is visible immediately without serving stale content
  for the full window.
- **Where**: `src/lib/syncs/` (global + badgebase engines), badge list/detail
  routes, `next.config.ts`.
- **Expected outcome**: cache hit rate on catalog routes rises (fewer
  origin/DB renders per visitor) while fresh-badge latency after a sync drops
  from "up to the revalidate window" to seconds.
- **Effort**: M

## Cache OG image renders instead of re-rendering satori per share
- **Category**: performance
- **What**: `/api/og/*` builds a satori SVG→image on every hit, and a viral
  share of one profile/badge re-pays that cost for each crawler fetch. Key the
  response on the route params, set a long immutable `Cache-Control` with
  `stale-while-revalidate`, and store the rendered bytes in a blob/edge cache
  so repeat requests never re-run the WASM renderer.
- **Where**: `src/app/api/og/profile` and any new badge OG route.
- **Expected outcome**: OG-route cache hit rate → near 100% after first render;
  satori invocations per unique card drop to 1; render CPU on share spikes is
  eliminated.
- **Effort**: M

## Cache the stats views in front of `/stats`
- **Category**: performance
- **What**: the dashboard reads the `stats_*` views directly, but those
  aggregates only change when the daily/15-minute syncs run. Wrap the reads in
  `unstable_cache` with a tag invalidated by the syncs (and a CDN
  `s-maxage`/SWR header), so repeated visits hit a cached aggregate rather than
  recomputing the views.
- **Where**: `src/lib/stats.ts`, `/stats` page and its chart components.
- **Expected outcome**: DB query count per `/stats` view drops to ~0 for cache
  hits; TTFB on `/stats` falls and Postgres load from dashboard traffic is
  removed between syncs.
- **Effort**: S

## Code-split recharts and the game runtime off non-stats routes
- **Category**: performance
- **What**: recharts and the 13-game gamification runtime are heavy and should
  never be in the catalog's initial bundle. Load the stats chart set and game
  modules via `next/dynamic` (client-only, `ssr: false`) at the routes that use
  them, and verify no catalog/blog page imports them transitively.
- **Where**: `src/components/stats/` consumers, gamification pages, badge
  catalog/blog routes.
- **Expected outcome**: first-load JS and Time-to-Interactive on `/badges`,
  blog and profile pages drop by the recharts+games chunk size; a bundle-budget
  check in CI keeps it off those routes.
- **Effort**: M

## Index the hot read paths the feed, progress and momentum queries use
- **Category**: performance
- **What**: the feed filters, leaderboards and momentum read `activity_events`
  by `(kind, created_at)`, `user_progress` by `updated_at`, and the per-badge
  owner series grows unbounded. Add the missing composite/partial indexes and a
  nightly rollup of `badge_stats` into daily rows, then verify with `EXPLAIN`
  that the planned index is actually used.
- **Where**: `supabase/migrations/`, feed/leaderboard queries in `queries.ts`,
  `src/lib/stats.ts`, `badge_momentum` view, potat sync writes.
- **Expected outcome**: feed and leaderboard query times fall from sequential
  scans to index seeks (verified by `EXPLAIN`), and the per-badge trend reads
  scan daily rollup rows rather than a growing raw time series.
- **Effort**: M