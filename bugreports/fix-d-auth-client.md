# fix-d — auth / client / i18n-number fixes

Scope: `src/proxy.ts`, `src/components/**`, `src/lib/auth*`, `src/i18n/**`, plus
`src/app/[locale]/stats/page.tsx`, `src/app/[locale]/badges/page.tsx` and (for
`ind-5`, the finding's actual lines) `src/app/[locale]/badges/[slug]/page.tsx`,
granted by the coordinator. `messages/` untouched.

Verification for every change: `npx tsc --noEmit` clean, `npx eslint <changed files>`
0 errors. A dev server was also run for a smoke test (see the per-finding notes).

Counts: **8 fixed** (auth-4+ind-6, auth-7, fp-5, api-2 leftover, ind-1, ind-5,
ind-7, R8-1), **2 refuted** (ui-2 and ui-5 were already fixed — no code change),
**1 deliberately left** (fp-3 — needs the out-of-scope profile page), **1 message
key requested** (fp-9/R8-1).

---

## auth-4 + ind-6 — refreshed cookies are not forwarded to the same request's render

- **File**: `src/proxy.ts` (whole `proxy()`, refresh map L24, `setAll` L35-41,
  response built L57-59, cookies applied L61-63)
- **New behaviour**: the Supabase refresh now runs **before** the response object
  is created; `setAll` writes each refreshed cookie into `request.cookies` **and**
  into a local `refreshed` map, and the map is written onto the response only after
  `NextResponse.next()` / `handleI18nRouting()` have been called.
- **Why the old code was wrong**: confirmed against the installed sources.
  `next-intl`'s middleware does `const l = new Headers(t.headers); … e.next({ request: { headers: l } })`
  — it snapshots the forwarded request headers at call time
  (`node_modules/next-intl/dist/esm/production/middleware/middleware.js`). The old
  code called `handleI18nRouting(request)` (and `NextResponse.next({ request })`)
  *before* the refresh, so `request.cookies.set(...)` afterwards reached the browser
  via `response.cookies.set` but **not** the Server Component render of that same
  request, which then found the stale cookie and refreshed the identical session a
  second time. Both mechanisms agree: Next's `RequestCookies.set` writes to the
  underlying header (`node_modules/next/dist/compiled/@edge-runtime/cookies/index.js:215`
  → `this._headers.set`), so building the response after the refresh makes the new
  cookie set visible downstream.
- **Safety**: still exactly **one** `supabase.auth.getUser()` per request — no second
  refresh-token rotation. Cookies are written from **middleware**, never from a Server
  Component. The only ordering change is that the response is derived from a request
  whose `cookie` header now carries the refreshed token; locale negotiation does not
  read `sb-*` cookies, so the i18n decision is unchanged. Redirect responses (which
  next-intl can return) receive the same `Set-Cookie`.
- **Verification**: typecheck + lint clean. Smoke test: dev server 200 on
  `/en`, `/en/stats`, `/en/feed`, `/de/stats`, `/ar/stats`, and `/api/health`.
  The token-rotation half is **unverified in a browser** (would need to wait for
  access-token expiry); the mechanism is verified from the two library sources above.

## auth-7 — `signOut()` signed the user out of every device

- **File**: `src/components/Header.tsx:73`
- **New behaviour**: `await supabase.auth.signOut({ scope: "local" })`.
- **Why the old code was wrong**: Supabase auth-js documents the default scope as
  `'global'` — it revokes the refresh token on every device, which is not what a
  per-device "Log out" menu item implies.
- **Safety / verification**: `scope: "local"` only removes this browser's session
  (cookies + local storage) and calls no server revoke; login is untouched. Lint +
  typecheck clean. Not exercised in a browser (would need a signed-in session).

## fp-5 — FeedList relative-time hydration mismatch

- **File**: `src/components/FeedList.tsx:42-46, 88-89, 136`
- **New behaviour**: `nowTick` is `number | null`, initialised to `null`; the
  `· Xs/Xm/Xh` span is rendered only when `nowTick !== null`; `timeAgo(iso, now)`
  takes the clock as an argument.
- **Why the old code was wrong**: `useState(() => Date.now())` ran on the server too,
  so SSR formatted `timeAgo` with the server clock and the hydrating client
  recomputed with the client clock — any bucket boundary between the two produced
  `MISSING`-style text mismatch and a React hydration error. The correcting
  `requestAnimationFrame` only runs after hydration, too late.
- **Verification**: typecheck + lint clean. Smoke test: `GET /en/feed` SSR HTML now
  contains **no** `· <n>s/m/h` text (grep returns nothing), i.e. the server and the
  first client render agree; the times appear after mount.

## fp-3 — ProfileCustomizer settings: deliberately left (no code change)

The whole `customization` document is stored and re-read only by the editor
(`src/app/[locale]/account/page.tsx`) and `achievements.ts` (counts keys). The
public profile page (`src/app/[locale]/profile/[username]/page.tsx`) never reads
`customization`, and it is out of my file scope. Applying any setting needs that
page (a feature, not a cheap fix), so nothing was changed. See the full list at the
end of this report.

## api-2 leftover — polling while the tab is hidden

- **FeedList**: the seen-id cap (500) and the `document.hidden` poll guard from the
  earlier `api-2 / fp-4` fix are already present (`FeedList.tsx:53-62, 81`). Nothing
  left to do there.
- **New**: `src/components/stats/LiveStatus.tsx:77-89` (guard at `:81`) polled `/api/health` every
  30 s with no visibility guard (each probe also writes a server-side `web`
  heartbeat). Added the same guard the feed uses: skip the tick when
  `document.visibilityState !== "visible"`, resume on the next tick. `pings` is
  already bounded (`.slice(-24)`), so no growth fix was needed.
- **Scanned, clean**: every growing array in `src/components` is `.slice`-bounded
  (`FeedList` 60, `LiveStatus` 24, `RouletteGame` 12); `LiveRefresher` and
  `Countdown` already behave (visibility check / server paints `—`).
- **Verification**: typecheck + lint clean; `/de/stats` and `/ar/stats` render 200
  in the smoke test.

## ui-2 / ui-5 leftovers — none found

- `ui-2` (`AchievementBadge`): already fixed — the special tier now omits the inline
  `background`/`boxShadow` and lets `.achievement-special` paint
  (`src/components/AchievementBadge.tsx:26-38`).
- `ui-5` (`ShareButtons`): already fixed — the URL is set from an effect into state
  (`src/components/ShareButtons.tsx:12-19`).
- Scanned every `Date.now()`, `Math.random()`, `new Date()`, `typeof window`,
  `window.location` and `toLocale*` in `src/components` for a value derived during
  render: the remaining hits are inside event handlers/effects (`Header`,
  `LanguageSwitcher.select`, `ThemeToggle`, games), are deterministic from props
  (`AvailabilityStrip`, `UptimeCalendar` — server components), or render only after
  data is fetched (`LiveStatus`). No further server/client mismatch found.

## ind-1 — English number grouping in other locales

- `src/components/stats/TrendChart.tsx:12, 27, 45, 85, 101`: `compact()` and the
  tooltip formatter now take the `useLocale()` value instead of hardcoded `"en"`.
- `src/components/stats/DonutChart.tsx:4, 29, 47`: same.
- `src/app/[locale]/stats/page.tsx:258, 715-717, 724-726, 733-739`: the four
  `formatCompact(...)` calls that omitted the `locale` argument now pass it.
- **Verification**: typecheck + lint clean.

## ind-5 — `toFixed` always emitted a "."

- `src/app/[locale]/stats/page.tsx:209-214` adds a `decimal1` one-decimal
  `Intl.NumberFormat(locale)`; `:270` (`winRate`) and `:1049`/`:1052`
  (`rate24h`/`rate7d`) use it instead of `toFixed(1)`.
- `src/components/stats/UptimeGauge.tsx:24, 70`: new required `locale` prop; the value
  is formatted with a locale-aware `Intl.NumberFormat` (same digit count as before)
  instead of `value.toFixed(...)`. The four call sites in `stats/page.tsx` pass
  `locale`.
- `src/app/[locale]/badges/[slug]/page.tsx:72-75, 248, 257`: a two-decimal
  `percent` formatter replaces both `toFixed(2)` calls.
- **Verification**: smoke-tested — `GET /de/stats` renders the gauge as `100,0%`
  (comma), where it previously rendered `100.0%`. Lint + typecheck clean.

## ind-7 — PushToggle stuck on "enabling"

- **File**: `src/components/PushToggle.tsx:26-35` (new `serviceWorkerReady()`),
  used by `enable` (`:84`), `disable` (`:109`) and `sendTest` (`:138`).
- **New behaviour**: `serviceWorkerReady(timeoutMs = 10_000)` races
  `navigator.serviceWorker.ready` against a rejection, so a registration that never
  activates fails into the existing error path instead of leaving the button
  permanently disabled on "enabling". `disable`/`sendTest` gained a `catch` so the
  new rejection cannot become an unhandled rejection (previously `disable`'s
  `finally` set "off" but let the rejection escape).
- **Why the old code was wrong**: `ready` never rejects when the worker cannot
  activate; `enable` then never reached `setState`, so the sole button stayed
  `disabled` forever.
- **Verification**: typecheck + lint clean. Behaviour not exercised in a browser
  (needs a wedged service worker).

## R8-1 — duplicate alt text in AccountSettings

- **File**: `src/components/account/AccountSettings.tsx:182, 215`
- Both `BadgeImage` calls inside the showcase/picker buttons now pass `alt=""`
  (the badge name is rendered as text beside each), matching the `cat-9` fix already
  applied in `BadgeCard`. `BadgeImage` supports `alt` (`BadgeImage.tsx:23, 45`).
- **Verification**: lint (including `react/jsx-no-comment-textnodes`) + typecheck clean.

## Message key requested (I did not add it)

`fp-9` / `R8-1`, `AccountSettings.tsx:178`:
`title={`${badge?.title ?? slug} — remove`}` is English in all 11 locales.

- Wanted key: **`account.removeShowcase`** (namespace `account`, which is what the
  component's `useTranslations("account")` uses; no collision — the namespace has
  only `showcase`/`showcaseHint` for this area).
- English string: **`{name} — remove`**, used as
  `t("removeShowcase", { name: badge?.title ?? slug })`.
- No other new keys are needed by my changes.

---

## Files touched

1. `src/proxy.ts` — auth-4 / ind-6
2. `src/components/Header.tsx` — auth-7
3. `src/components/FeedList.tsx` — fp-5 (+ confirmed api-2 already fixed)
4. `src/components/PushToggle.tsx` — ind-7
5. `src/components/stats/TrendChart.tsx` — ind-1
6. `src/components/stats/DonutChart.tsx` — ind-1
7. `src/components/stats/UptimeGauge.tsx` — ind-5
8. `src/components/stats/LiveStatus.tsx` — api-2 leftover
9. `src/components/account/AccountSettings.tsx` — R8-1
10. `src/app/[locale]/stats/page.tsx` — ind-1, ind-5
11. `src/app/[locale]/badges/[slug]/page.tsx` — ind-5

## ProfileCustomizer settings that still do nothing

None of the 35 `customization` document fields is read by any page other than the
editor. Only the fields that are also mirrored to dedicated `profiles` columns have
an effect, and only via those columns:

- Applied via dedicated columns: `bio` (profile page), `bannerUrl` (profile page),
  `displayName` (OG image only — **not** the profile page itself), plus the separate
  `mood` and steal fields (not part of the document).
- Stored in the document but read nowhere: `color`, `accent2`, `font`, `cardStyle`,
  `radius`, `nameGradient`, `avatarFrame`, `bannerOverlay`, `showcaseLayout`,
  `showStats`, `showInventory`, `showLevel`, `showCoins`, `showVisitors`,
  `socialTwitter`, `socialDiscord`, `title`, `density`, `aura`, `particles`,
  `nameRainbow`, `bannerShine`, `tilt3d`, `pixelAvatar`, `achievementTicker`,
  `greetingBanner`, `levelHalo`, `cursorBadge`, `statusBubble`, `profileTheme`,
  `effectsIntensity`, `coinRainAuto`, `visitorMarquee`.

(`showInventory` does nothing — inventory visibility is controlled by the separate
`inventoryPublic` toggle in `AccountSettings`.)