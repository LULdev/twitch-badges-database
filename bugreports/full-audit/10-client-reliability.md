# Cross-cutting client reliability, caching and the shell

Audited (read in full unless noted):
- `src/app/[locale]/layout.tsx`, `src/app/[locale]/page.tsx`, `src/app/[locale]/error.tsx`,
  `src/app/[locale]/not-found.tsx`, `src/app/[locale]/[...rest]/page.tsx`,
  `src/app/[locale]/login/page.tsx`, `src/app/[locale]/auth/callback/page.tsx`,
  `src/app/[locale]/account/page.tsx`, `src/app/[locale]/notifications/page.tsx`,
  `src/app/[locale]/profile/[username]/page.tsx` (head), `src/app/[locale]/badges/[slug]/page.tsx`,
  `src/app/[locale]/stats/page.tsx` (relevant regions)
- `src/components/LiveRefresher.tsx`, `ThemeToggle.tsx`, `ThemeScript.tsx`, `Header.tsx`,
  `Footer.tsx`, `LanguageSwitcher.tsx`, `PushToggle.tsx`, `ShareButtons.tsx`,
  `ServiceWorkerRegister.tsx`, `AnalyticsBeacon.tsx`, `FeedList.tsx`, `TwitchLoginButton.tsx`,
  `CoinRainButton.tsx`, `DailyClaim.tsx`, `EmojiReactions.tsx`, `StealPanel.tsx`,
  `WheelOfFortune.tsx`, `badges/BadgeCard.tsx`, `badges/BadgeImage.tsx`, `badges/Countdown.tsx`,
  `badges/FilterBar.tsx`, `stats/CountUp.tsx`, `stats/LiveStatus.tsx`, `stats/Reveal.tsx`,
  `stats/AvailabilityStrip.tsx`, `stats/UptimeCalendar.tsx`, `profile/ProfileEffects.tsx`,
  `account/AccountSettings.tsx`, `account/ProfileCustomizer.tsx`, `games/useGame.tsx`,
  `inventory/SyncButton.tsx`
- `src/proxy.ts`, `src/app/api/track/route.ts`, `src/app/api/og/profile/route.tsx`,
  `src/app/api/account/route.ts`, `src/lib/supabase/server.ts`, `src/lib/settings.ts`,
  `src/lib/seo.ts`, `src/app/globals.css` (theme/tokens), `public/sw.js`, `next.config.ts`

Method:
- Read every file above; `grep` for `Math.random` / `Date.now()` / `toLocale*` / `useEffect` /
  `setInterval` / `useSearchParams` / `typeof window` / `dark:` across `src/`.
- Route smoke from the last build's artifacts: `.next/prerender-manifest.json`,
  `.next/routes-manifest.json`, `.next/app-path-routes-manifest.json`, and a `find` for
  prerender artifacts (`.html` / `.meta` / `.rsc`) under `.next/server/app`.
- Ran the project's own `node bugreports/audit-i18n.mjs` and an independent key-set diff across
  all eleven `messages/*.json`.
- Could not run: `npm run build` (a dev server / RAM budget), `npx tsc --noEmit` (not needed for
  the findings below — each is a behaviour claim, not a type claim). No database access was used.

---

## B1 — Every `export const revalidate` on a `[locale]` page is inert: the locale layout makes the whole segment dynamic

- **Severity**: medium
- **Confidence**: high (verified against the build artifacts on disk)
- **Where**: `src/app/[locale]/layout.tsx:66-92` (the `cookies()` read); declared on 14 pages —
  `[locale]/page.tsx:9`, `active/page.tsx:8`, `badges/page.tsx:8`, `badges/[slug]/page.tsx:22`,
  `blog/page.tsx:7`, `blog/[slug]/page.tsx:15`, `changelog/page.tsx:7`, `expired/page.tsx:8`,
  `faq/page.tsx:7`, `leaderboards/page.tsx:18`, `notifications/page.tsx:8`,
  `profile/[username]/page.tsx:35`, `stats/page.tsx:31`, `upcoming/page.tsx:8`
- **Code**:
  ```tsx
  // src/app/[locale]/layout.tsx
  let user: HeaderUser | null = null;
  try {
    const supabase = await createClient();          // -> cookies() inside
    const { data: { user: authUser } } = await supabase.auth.getUser();
    ...
  }
  const features = await getFeatures();             // -> createClient() -> cookies()
  ```
  ```ts
  // src/lib/supabase/server.ts:5-8
  export async function createClient() {
    const cookieStore = await cookies();            // dynamic API
  ```
- **Why it is wrong**: `cookies()` is a dynamic API; because the **root layout for every
  `[locale]` route** (`[locale]/layout.tsx` is the root layout — there is no `src/app/layout.tsx`)
  reads the request cookies twice (session + `getFeatures()`), Next opts the entire segment out of
  static generation. The build proves it: the only prerendered routes are
  `/_global-error`, `/_not-found`, `/icon.svg`, `/manifest.webmanifest`, `/robots.txt`,
  `/sitemap.xml`; there is **no** `.html`/`.meta`/`.rsc` under `.next/server/app/[locale]`, and
  `prerender-manifest.dynamicRoutes` is empty. So the declared ISR windows never exist and every
  page render re-runs its Postgres queries. This directly contradicts the code's own comments —
  `BadgeCard.tsx:56-57` ("catalog pages revalidate on a short ISR window"), `stats/page.tsx:205`
  ("the page revalidates every 5 minutes") — and turns `LiveRefresher`'s 60 s `router.refresh()`
  (mounted on `/`, every badge detail page and `/feed`) into a fresh DB round-trip per open tab per
  minute. The declarations are not just unused; they assert a caching contract the app does not
  have.
- **How to reproduce**: `node -e "const m=require('./.next/prerender-manifest.json');console.log(Object.keys(m.routes))"`
  → the six non-locale routes; `find ".next/server/app/[locale]" -name "*.meta" -o -name "*.html"`
  → nothing. Then compare with the 14 `export const revalidate` declarations.
- **Suspected cause**: the auth/feature read was put in the shared layout, and `revalidate` was
  added per page as if the layout were static. (Direction: either move the session/feature read
  out of the layout behind a client-side fetch, or delete the dead `revalidate` exports and state
  the app is fully dynamic.)

## B2 — Saving `ProfileCustomizer` silently clears `display_name`, `bio`, `banner_url` and resets `color`

- **Severity**: high
- **Confidence**: high (verified by reading the two components and the API)
- **Where**: `src/components/account/ProfileCustomizer.tsx:130` + `:139-156`;
  `src/app/[locale]/account/page.tsx:80-92`; `src/app/api/account/route.ts:36-41`
- **Code**:
  ```tsx
  // ProfileCustomizer.tsx
  const [values, setValues] = useState<Customization>({ ...DEFAULTS, ...initial });
  //   DEFAULTS.displayName = "", DEFAULTS.bio = "", DEFAULTS.bannerUrl = "", DEFAULTS.color = "#a970ff"
  ...
  body: JSON.stringify({
    displayName: values.displayName, bio: values.bio,
    bannerUrl: values.bannerUrl, color: values.color,
    ...
  ```
  ```ts
  // api/account/route.ts
  if (typeof body.displayName === "string") patch.display_name = body.displayName.slice(0, 64) || null;
  if (typeof body.bio === "string") patch.bio = body.bio.slice(0, 280) || null;
  if (typeof body.bannerUrl === "string")
    patch.banner_url = /^https?:\/\//.test(body.bannerUrl) ? body.bannerUrl.slice(0, 500) : null;
  if (typeof body.color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.color)) patch.color = body.color;
  ```
- **Why it is wrong**: the account page mounts **two independent editors of the same four profile
  columns** — `AccountSettings` (which seeds from `profiles.display_name/bio/banner_url/color`) and
  `ProfileCustomizer` (which seeds the same four from `profile.customization`, defaulting to
  `""`/`""`/`""`/`"#a970ff"`, because the customizer's `initial` is the `customization` document,
  not the columns). A member who sets a display name / bio / banner URL / colour in the top
  `AccountSettings` form and then toggles any creative setting below and presses Save sends the
  customizer's empty defaults: `display_name`, `bio`, `banner_url` are written as `null` and `color`
  is overwritten with `#a970ff`. The API accepts all four unconditionally (`typeof … === "string"`
  is always true for the customizer payload), so the columns are wiped even though the member never
  touched those fields there. Sequence: set bio in AccountSettings → toggle "particles" in
  ProfileCustomizer → Save → profile bio and banner are gone, colour reverts.
- **How to reproduce**: by inspection; UI-wise: `/en/account`, enter a bio in the "Profile" card,
  toggle any switch in the "Creative" card, click Save, reload — the bio is empty.
- **Suspected cause**: the same columns are exposed by two components that hold separate copies of
  their values, and the save path writes every field unconditionally instead of only fields the
  user actually edited.

## B3 — The visitor beacon writes two rows per page view, and every analytics aggregate counts rows as "hits" (≈2× pageviews)

- **Severity**: medium
- **Confidence**: high (mechanics verified by reading the beacon, the endpoint and the view SQL)
- **Where**: `src/components/AnalyticsBeacon.tsx:40-71`; `src/app/api/track/route.ts:72-85`;
  `supabase/migrations/0025_acp_foundation.sql:128-168`
- **Code**:
  ```tsx
  // AnalyticsBeacon.tsx
  startedAt.current = Date.now();
  send();                                   // row 1 — page shown, no duration
  const onHide = () => {
    const seconds = Math.round((Date.now() - enteredAt.current) / 1000);
    send(seconds > 0 ? seconds : undefined); // row 2 — page left (duration present or absent)
  };
  window.addEventListener("pagehide", onHide);
  return () => { window.removeEventListener("pagehide", onHide); onHide(); };
  ```
  ```sql
  -- 0025: stats_analytics_summary / _daily / _top_paths / _clients / _locales
  (select count(*) from public.analytics_events) as total_hits,
  (select count(*) from public.analytics_events where ts > now() - interval '1 day') as hits_24h,
  ... count(*) ... group by path / browser,os,device / locale
  ```
- **Why it is wrong**: `/api/track` inserts a row for *any* payload with a non-empty `path`, and the
  beacon posts on mount **and** on hide/unmount, so every page view produces exactly two rows (the
  leave send is a row whether or not `duration_s` is set). No view filters the duration rows out of
  the hit counts (`avg_duration_s` is the only one that does), so `total_hits`, `hits_24h/7d/30d/90d`,
  `stats_analytics_daily.hits`, `top_paths.hits`, `clients.hits` and `locales.hits` are all ~2× the
  real pageview count — the admin Statistics tab and the public `/stats` visitor card report double
  the traffic. (The telemetry round reported the anon-INSERT hole, the DNT `visitors` collapse and
  the probe rules; this double-count is not among them.)
- **How to reproduce**: by inspection; empirically, open any page, wait, then
  `SELECT path, count(*) FROM analytics_events GROUP BY path ORDER BY 2 DESC` shows ~2 rows per view
  for the same `visitor_hash`/path within seconds.
- **Suspected cause**: the beacon was designed as "two events per page view" while the aggregates
  were written as if one row = one hit.

## B4 — No `global-error.tsx` (and no root `not-found.tsx`): an error thrown by the locale layout escapes `[locale]/error.tsx`

- **Severity**: low
- **Confidence**: low — unverified (the escape is structural; I found no throw currently reachable
  in the layout, so I could not reproduce a member-visible instance)
- **Where**: `src/app/[locale]/error.tsx` (boundary), `src/app/[locale]/layout.tsx:53-119`
  (the root layout), `src/app/` (no `global-error.tsx`, no `layout.tsx`, no `not-found.tsx`)
- **Code**:
  ```tsx
  // src/app/[locale]/layout.tsx  (this is the ROOT layout — there is no src/app/layout.tsx)
  const features = await getFeatures();
  return (<html …><body>
    <ThemeScript />
    <NextIntlClientProvider>
      <div …><Header user={user} features={features} /><main>{children}</main><Footer /></div>
  ```
- **Why it is wrong**: `[locale]/error.tsx` is rendered *inside* the layout, so it only catches
  errors thrown by the segment's children (pages). Anything thrown while rendering the layout itself
  — `Footer`/`Header` `getTranslations` raising `MISSING_MESSAGE` for a key missing in one locale,
  a future throw added around the `getFeatures()`/`Header` calls, or a render error in the
  layout-level components — has no boundary above it, and because no `app/global-error.tsx` exists
  the framework's unstyled "Application error" screen is shown instead of the friendly retry UI the
  project wrote for this purpose. The layout is defensive today only because `getFeatures()` and the
  whole auth block swallow their own errors, so this is a latent hole rather than a live bug.
- **How to reproduce**: by inspection (add a `throw` to `[locale]/layout.tsx` and load any locale
  page — the bare framework error appears, not `error.tsx`). I could not trigger it without editing.
- **Suspected cause**: an error boundary was added one level too deep, and the root layout lives in
  the dynamic segment so the usual `app/global-error.tsx` safety net was never created.

## B5 — `revalidate = 3600` on the profile OG route handler is inert

- **Severity**: low
- **Confidence**: medium (build artifact + route-handler default; the upstream font/perfil fetches
  are separately cached, so the cost is small)
- **Where**: `src/app/api/og/profile/route.tsx:4`
- **Code**: `export const revalidate = 3600;`
- **Why it is wrong**: a `GET` route handler is dynamic by default in Next 15/16, and the build
  confirms `/api/og/profile` is not prerendered (absent from `prerender-manifest.routes`, no
  artifact under `.next/server/app/api/og`). The image is therefore re-rendered on every hit despite
  the declared hour; the declaration only misleads a reader into thinking the card is cached at the
  route. (`fetchUserBadges(username, 3600)` still caches the upstream perfil fetch, so the practical
  impact is the satori render, not a duplicate third-party call.)
- **How to reproduce**: `node -e "const m=require('./.next/prerender-manifest.json');console.log(m.routes['/api/og/profile'])"` → `undefined`.
- **Suspected cause**: `revalidate` was copied from the page routes onto a route handler, where it
  needs `dynamic = "force-static"` (or an explicit `Cache-Control`) to take effect.

---

## Checked and found clean (so "nothing" means something)

- **Hydration mismatches**: no render-body use of `Date.now()`/`Math.random()`/`new Date()`/
  `localStorage`/`window` outside a server component carrying the `react-hooks/purity` disable or a
  `requestAnimationFrame`/`setTimeout` effect. `FeedList` (`nowTick=null`), `Countdown`
  (`now=null` → "—"), `ShareButtons` (`shareUrl=""`), `ThemeToggle` (initial `"dark"` matches the
  SSR icon), `ProfileEffects` (rAF seeds), `ProfileCustomizer`/`AccountSettings` (state from props)
  all start from a server-identical value. `AvailabilityStrip`/`UptimeCalendar` appear to use
  `new Date()` but are **server** components, so no client re-computation. No `toLocaleString()`
  without a locale argument in any server-rendered client component (only in admin panels that
  render from client-fetched data after mount).
- **Effects / cleanup / loops**: `LiveRefresher` (visibility-gated interval, cleaned), `Header` and
  `LanguageSwitcher` (document listeners added only while open, removed; Escape restores focus),
  `AnalyticsBeacon` (pagehide listener removed), `CountUp` (rAF cancelled, observer disconnected),
  `Reveal` (observer disconnected), `LiveStatus` (`mountedRef`, kickoff timeout + interval cleared),
  `ProfileParticles`/`ProfileAutoRain`/`ProfileTilt` (rAF/timeout/listeners cleaned), `useGame`
  (single-shot timeout), `PushToggle`/`SyncButton`/`DailyClaim`/`StealPanel`/`EmojiReactions`
  (re-entry guarded). Every growing array is `.slice`-bounded (`FeedList` 60 / seen-set 500,
  `LiveStatus` 24). No refetch loop: no effect both writes and depends on the value it writes.
- **Error/404 boundaries**: `[locale]/error.tsx` renders localized copy with a retry and a home link
  (no raw error text, only `console.error`), `[locale]/not-found.tsx` renders a localized 404 —
  both inside the `NextIntlClientProvider`; `[...rest]` funnels unknown paths to the localized 404.
- **`useSearchParams`**: `auth/callback` is inside `<Suspense>`; `FilterBar` is not, but the pages
  it renders on are all dynamic (B1), so prerendering never touches it — not a live failure.
- **Service worker**: `public/sw.js` has no `fetch` handler, so it cannot serve stale HTML/RSC; the
  middleware `matcher` correctly excludes `sw.js` and asset paths. `ServiceWorkerRegister` and
  `PushToggle` both tolerate a missing/failed worker.
- **i18n key sets**: `node bugreports/audit-i18n.mjs` reports no literal key that resolves under no
  namespace; an independent flattened diff shows **0 missing / 0 extra keys** in each of the eleven
  `messages/*.json` (1022 keys), so the shell (`nav`, `footer`, `common`, `account` theme labels)
  cannot raise `MISSING_MESSAGE` today.
- **`next.config.ts` / `globals.css`**: only `images.remotePatterns` is configured and no `next/image`
  is used (all images are plain `<img>`), so the config is unused but harmless; `:root` is dark and
  `.light` overrides, and `ThemeScript` always adds exactly one of `.dark`/`.light` before paint, so
  there is no unstyled flash. The `@custom-variant dark (&:where(.dark, .dark *))` is the only
  class-driven variant and no `dark:` utilities exist, so the toggled class only drives
  `color-scheme` and the `.light` token overrides.
