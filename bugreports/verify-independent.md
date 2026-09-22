# Independent verification audit — NEW findings

Date: 2026-09-22. Fresh read-only pass aimed at the seams between the scopes
already covered (auth, games, wheel, feed, profile, catalog, stats, i18n, SEO,
/api, cron/health, syncs, gamification core, DB/RLS, security, UI shell, pages).
Nothing from the **open** list in `bugreports/AGENT-AUDIT.md` is repeated here.

Convention per finding: ID · severity · side · file:line · evidence ·
consequence · confidence · fix direction. IDs are prefixed `ind-`.

---

## ind-1 — i18n-2 was only half-applied: several compact/decimal formatters still hardcode the locale

- **Severity**: medium
- **Side**: client
- **File**:line:
  - `src/app/[locale]/stats/page.tsx:252` (`formatCompact(...)` with no locale)
  - `src/app/[locale]/stats/page.tsx:709,717,725` (same, the wagered / paid-out / biggest-win chips)
  - `src/components/stats/TrendChart.tsx:26` and `:97` (`new Intl.NumberFormat("en", …)`)
  - `src/components/stats/DonutChart.tsx:45` (`new Intl.NumberFormat("en")`)
- **Evidence**: `formatCompact` was changed to `formatCompact(value, locale = "en")`
  (BadgeCard.tsx:13-23) and the home/leaderboards call sites pass the locale, but
  four `/stats` call sites still omit it and silently fall back to `"en"`.
  The two chart components were listed in the original `i18n-2` finding but were
  never touched — they still construct `Intl.NumberFormat("en")` inline:
  `TrendChart.tsx:26` `return new Intl.NumberFormat("en", { notation: "compact" }).format(value);`
  and `:97` / `DonutChart.tsx:45` `new Intl.NumberFormat("en").format(Number(value ?? 0))`.
- **Consequence**: on `/de/stats`, `/fr/stats`, `/ru/stats`, `/ar/stats`, … the
  "wagered / paid out / biggest win" chips, the XP-per-level-bucket tooltip, and
  every trend/donut chart Y-axis tick and tooltip value render English-grouped
  numbers (`1.2M`, `1,234`) instead of the locale form (`1,2 Mio.`, `1.234`,
  `١٬٢٣٤`). The previous round's "smoke-tested" claim does not cover these five
  spots.
- **Confidence**: confirmed (code + the default-parameter fallback is explicit).
- **Fix direction**: pass `locale` to the four stats call sites (all already have
  the URL `locale` in scope) and change `TrendChart`/`DonutChart` to accept the
  active locale (or reuse `formatCompact(value, locale)`).

## ind-2 — Coin rain's "once per day" gate is a read-then-write and there is no self-rain check

- **Severity**: medium
- **Side**: server
- **File**:line: `src/lib/gamification/daily.ts:209-221` (gate) and `:186-241`
  (whole function); route `src/app/api/coinrain/route.ts:12`
- **Evidence**: the daily guard reads `activity_events` and only then writes:
  ```ts
  const { count } = await supabase.from("activity_events")
    .select("id", { count: "exact", head: true })
    .eq("kind","coin_rain").eq("user_id", profileOwnerId)
    .gte("created_at", since)
    .contains("payload", { giver: giverId ?? anonymousKey ?? "anonymous" });
  if ((count ?? 0) > 0) return { ok: false, already: true };
  await bumpCoins(profileOwnerId, 1);   // + the two logActivity inserts
  ```
  There is no unique constraint / atomic RPC behind this, and no check that
  `giverId !== profileOwnerId`.
- **Consequence**: N concurrent `POST /api/coinrain` requests for the same
  `profileId` all observe `count = 0`, so all pass the gate and each credits
  +1 coin plus a feed row. A visitor (logged in or not) can inflate any profile's
  balance — including their own, since self-rain is allowed — by firing parallel
  requests. The documented "one coin rain per day per target" promise is not
  enforced under concurrency. (Compared with `claimDaily`/`spinWheel`, which do
  use an atomic SQL gate, this one path was left read-then-write.)
- **Confidence**: confirmed for the race; the exploit requires concurrent
  requests (the UI button serialises them).
- **Fix direction**: move the gate into a `coin_rain_gate(giver, owner, day)`
  RPC that does the check-and-insert under a row lock (or add a unique index on
  `(kind,user_id,day,giver)` and treat the conflict as "already"), and reject
  `giverId === profileOwnerId`.

## ind-3 — Profile OG image has no font covering Arabic/CJK display names

- **Severity**: medium
- **Side**: server
- **File**:line: `src/app/api/og/profile/route.tsx:37` (`fontFamily: "sans-serif"`)
  and the whole route (`:23-119`, no `fonts` option passed to `ImageResponse`)
- **Evidence**: `@vercel/og` ships exactly one default font — `Geist-Regular.ttf`
  (`node_modules/@vercel/og/dist/index.node.js:23541-23550`, and
  `index.node.js:23516` `fonts: options.fonts || defaultFonts`). The route passes
  no `fonts`, so satori has only Geist. The card renders the user-controlled
  `displayName` at 56px (`route.tsx:59-61`). Twitch display names are arbitrary
  Unicode.
- **Consequence**: when a profile whose `displayName` is Arabic, Chinese,
  Japanese or Korean is shared to X/Discord/etc., the OpenGraph image (set in
  `src/app/[locale]/profile/[username]/page.tsx:56`) renders the display name as
  blank/notdef boxes while the ASCII `@handle` below it is fine — a visibly
  broken share card for every non-Latin collector.
- **Confidence**: medium (bundled-font fact is confirmed; the exact satori
  blank-vs-tofu rendering isn't exercised here). Not previously reported — the
  SEO agent only checked the OG endpoint's status/param guard.
- **Fix direction**: pass a font with the required coverage (a Noto Sans subset,
  or fetch `sans-serif` via the `fonts` option), or fall back to the ASCII
  `@handle` when `displayName` contains non-Latin script. The unused
  `&locale=` query param (`page.tsx:56`) can be dropped or honoured at the same time.

## ind-4 — `/api/feed` without `limit` returns 5 events, not the documented default 30

- **Severity**: low
- **Side**: server
- **File**:line: `src/app/api/feed/route.ts:12-15`
- **Evidence**:
  ```ts
  const limitRaw = Number(url.searchParams.get("limit"));   // null → 0
  const limit = Number.isFinite(limitRaw)
    ? Math.min(50, Math.max(5, Math.floor(limitRaw)))
    : 30;
  ```
  A missing `limit` becomes `Number(null) === 0`, which **is** finite, so the
  `: 30` branch is unreachable for the no-parameter case and `limit` becomes
  `Math.min(50, Math.max(5, 0)) === 5`. The default only fires for genuinely
  non-numeric input (`?limit=abc` → `NaN`).
- **Consequence**: latent today — the only caller, `FeedList.tsx:46`, always
  sends `?limit=30` — but any caller that omits `limit` (an external consumer,
  the pagination `nextCursor` flow, a future server-side read) silently receives
  five events while the code advertises thirty, and `?limit=1` is likewise
  silently raised to 5.
- **Confidence**: confirmed for the code defect; user-visible consequence is
  latent (no current caller relies on the default).
- **Fix direction**: distinguish "absent" from `0` — e.g.
  `const rawLimit = url.searchParams.get("limit"); const limit = rawLimit === null ? 30 : clamp(...)`,
  or use `Math.max(1, …)` with an explicit default.

## ind-5 — Percentages are formatted with `toFixed`, so the decimal separator is always `.`

- **Severity**: low
- **Side**: client
- **File**:line:
  - `src/app/[locale]/stats/page.tsx:264` (`${winRate.toFixed(1)}%`)
  - `src/app/[locale]/stats/page.tsx:1036,1039` (`${source.rate24h.toFixed(1)}%`, `rate7d`)
  - `src/app/[locale]/badges/[slug]/page.tsx:242` (`(${Number(live.percentage).toFixed(2)}%)`)
  - `src/app/[locale]/badges/[slug]/page.tsx:251` (`percentageOfUsers` value `toFixed(2)`)
  - `src/components/stats/UptimeGauge.tsx:65` (`value.toFixed(…)`)
- **Evidence**: these are hand-built percent strings from `Number.prototype.toFixed`,
  which always emits a `"."` decimal point. The surrounding page already has the
  active `locale` (used for `Intl.NumberFormat(locale)` in the same files).
- **Consequence**: German/French/Spanish/Russian users read `99.5%` / `1.50%`
  where their locale convention is `99,5 %` / `1,50 %`. Cosmetic but consistent
  across the stats dashboard and every badge detail page.
- **Confidence**: confirmed.
- **Fix direction**: route these through `Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: n })`
  (or a shared helper) instead of `toFixed`.

## ind-6 — Middleware refresh cookie is set on the response but not forwarded to the request

- **Severity**: low
- **Side**: server
- **File**:line: `src/proxy.ts:17-19` (response created) vs `:36-43` (`setAll`)
- **Evidence**: `response` is created **before** the Supabase client runs:
  ```ts
  const response = isApi ? NextResponse.next({ request }) : handleI18nRouting(request);
  …
  setAll(cookiesToSet) {
    cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
    cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
  }
  ```
  In Next 16.3.5, `NextResponse.next({ request })` snapshots the forwarded
  request headers eagerly in `handleMiddlewareField`
  (`node_modules/next/dist/server/web/spec-extension/response.js:24-45`, called
  at construction from `:119/:128`); mutating `request.cookies` afterwards does
  update `request.headers`, but the `x-middleware-request-cookie` override has
  already been written, so the route handler / server components in the same
  request see the **pre-refresh** Cookie header. The official Supabase SSR
  pattern avoids this by re-creating the response inside `setAll`; this code
  does not.
- **Consequence**: on the single request that crosses access-token expiry, the
  middleware rotates the refresh token and returns the new cookies to the
  browser, while the downstream `getUser()` (layout `layout.tsx:66-69`, or an
  `/api/*` handler) still reads the old refresh token and may try to refresh
  again. Supabase's default ~10-second refresh-token reuse interval normally
  lets the second refresh succeed, so no user-visible logout was reproduced —
  this is reported as an unconfirmed structural deviation, not a confirmed
  regression of `auth-1`.
- **Confidence**: low — structural deviation confirmed against the Next source;
  user-visible effect **unconfirmed** (mitigated by the reuse interval).
- **Fix direction**: follow the documented pattern — inside `setAll`, rebuild
  `NextResponse.next({ request })` (or copy the mutated request headers onto the
  existing response) after mutating `request.cookies`, then return that response.

## ind-7 — `PushToggle` can hang permanently in "enabling" when the service worker never becomes ready

- **Severity**: low
- **Side**: client
- **File**:line: `src/components/PushToggle.tsx:69-76` (and the `ready` probe at `:32`)
- **Evidence**: `enable()` awaits `await navigator.serviceWorker.ready` with no
  timeout. If the browser supports Service Worker/PushManager but registration
  failed (e.g. `/sw.js` blocked, private mode), `ready` is a promise that never
  settles. The initial effect's `.catch(() => undefined)` leaves the state at
  `"off"`, so the Enable button is shown; clicking it sets `"enabling"` and then
  parks forever on `ready`, leaving the button disabled (`:144`) with no error
  message in the locale panel beyond the generic one.
- **Consequence**: affected users see a permanently disabled "Enabling…" button
  and can never learn that push is unavailable; refresh is the only escape.
- **Confidence**: medium (depends on the SW failing to register).
- **Fix direction**: race `navigator.serviceWorker.ready` against a timeout and
  fall through to the `unsupported`/error state, or register and await
  `registration` directly instead of `ready`.

## ind-8 — RTL: the growth-bar shine still sweeps against the fill direction in Arabic

- **Severity**: low
- **Side**: client
- **File**:line: `src/app/globals.css:1202-1218` (`grow-bar-fill::after` +
  `grow-bar-shine`) vs the RTL override at `:1354` (`[dir="rtl"] .grow-bar-fill { transform-origin: right center; }`)
- **Evidence**: `ui-7` mirrored the bar's fill origin for RTL but the overlay
  shine is still physical:
  ```css
  .grow-bar-fill::after { … transform: translateX(-100%); animation: grow-bar-shine …; }
  @keyframes grow-bar-shine { 0%,60% { transform: translateX(-100%);} 100% { transform: translateX(220%);} }
  ```
  There is no `[dir="rtl"]` rule for `.grow-bar-fill::after` (only `.grow-bar-fill`
  and `.rank-row` are overridden).
- **Consequence**: on `/ar/...` the bars now grow from the inline-end (correct)
  but the highlight sweep still travels left→right, so it visibly runs against
  the fill — a small but noticeable RTL polish defect in the Arabic stats/profile
  bars.
- **Confidence**: confirmed (static CSS); impact cosmetic.
- **Fix direction**: add `[dir="rtl"] .grow-bar-fill::after { animation-name: grow-bar-shine-rtl; }`
  with a mirrored keyframe (translateX `120%` → `-200%`).

---

## Areas checked and found clean

- **Proxy / `/api` matcher** (`src/proxy.ts`): matcher correctly excludes
  `_next/static`, `_next/image`, `sw.js` and extension-bearing paths while
  including `/api`; the `sb-`-cookie short-circuit is correct; the i18n redirect
  vs `NextResponse.next` split is correct. Only ind-6 (unconfirmed) found.
- **Service worker** (`public/sw.js`): install/activate/`push`/`notificationclick`
  handlers, JSON-vs-text payload fallback, default tag/url, `clients.matchAll`
  focus-or-open logic — no defect found.
- **Push delivery** (`src/lib/push.ts`, `api/push/subscribe`, `api/push/vapid`):
  404/410 pruning, endpoint validation (HTTPS/public/no-IP-literal), anonymous
  vs owned-endpoint ownership check, upsert on `endpoint`, `webpush` VAPID
  config — clean. (The known `api-3` unsubscribe ordering was not re-reported.)
- **Supabase client lifecycle** (`lib/supabase/server.ts`, `browser.ts`,
  `admin.ts`): anon server client, service-role client confined to server
  contexts, static `process.env.NEXT_PUBLIC_*` reads in the browser client —
  clean apart from ind-6.
- **i18n routing edge cases**: unknown locale segment (`/xx/...`) is redirected to
  the default locale by the intl middleware and then hits the localized 404 via
  `[locale]/[...rest]/page.tsx`; unknown `locale` reaching the layout is caught by
  `hasLocale` → `notFound()`; `localePrefix: "always"` with a missing locale
  redirects correctly; `localeHtmlLang` / `dir` wiring in `layout.tsx` is correct;
  ICU plurals for `en`/`ru`/`ar` (zero/one/two/few/many/other) are complete and
  consistent across all 11 message files.
- **Number/date formatting**: `page.tsx`, `badges/[slug]`, `blog`, `changelog`,
  `leaderboards`, `notifications`, `inventory`, `FeedList`, `CountUp`,
  `DistributionBars`, `AvailabilityStrip`, `UptimeCalendar`, `OwnersChart` all
  pass the active locale — only ind-1 and ind-5 remain.
- **RTL physical CSS**: `Header` uses logical `ms-auto`/`pe`/`ps`/`text-start`;
  `LanguageSwitcher` uses `inset-inline-end`; only ind-8 remains.
- **Scripts re-run safety**: `db-apply.ts` (ledger inside one transaction),
  `seed-gamification-blog.ts` / `seed-xp-research.ts` (`ignoreDuplicates` upsert
  by slug), `log-change.ts` (append-only), `send-push.ts`, the three `sync-*.ts`
  wrappers (thin, delegate to the sync engines) — no re-run corruption path found.
- **Concurrency beyond ind-2**: `claimDaily`/`spinWheel` (`claim_*_gate` RPCs),
  `award()` (`consume_game_xp` / `apply_xp_coins`), `bumpCoins` (`add_coins`),
  `attemptSteal`/`inventory.sync` (insert-then-reward ordering makes a duplicate
  insert fail before any second reward) — clean. The `recordProfileVisit` /
  `recordBlogView` 5-minute dedup is also read-then-write, but it only
  double-counts a cosmetic view (no resource is created), so it is noted rather
  than raised as a finding.

## Notes on confidence / refutation

- ind-2 and ind-5 are arithmetic/ordering facts, confirmed by reading only.
- ind-3 rests on the bundled-font fact (confirmed) plus satori's missing-glyph
  rendering (not exercised here) — flagged medium.
- ind-6 is the one finding I would call **unconfirmed**: the deviation from the
  documented Supabase pattern is real and sourced, but the default Supabase
  refresh-token reuse interval very plausibly prevents any user-visible effect.
  If a reviewer can reproduce a logout on the token-expiry request, it graduates
  to a real `auth-1` follow-up; otherwise it should be treated as a
  robustness/consistency fix only.