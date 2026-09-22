# Agent 09 — i18n audit (Twitch Badges Database)

Scope: `messages/*.json` (11 locales), `src/i18n/*`, `LanguageSwitcher`, and every
component/page that builds a translation key dynamically or formats a number/date.
Read-only audit; no project files were modified.

Baseline checks that PASSED (no bug): all 11 message files are key-identical
(flat-key diff vs `en` = 0 missing / 0 extra in every locale); ICU placeholder
names are identical across locales; all dynamic-key value spaces resolve —
FAQ `${key}Q/A` (20 keys), games `${id}Title/Desc` (13 ids), `rarity` tiers,
`achievements` categories, `common` statuses, `customizer` labels/hints,
`games` RPS/coinflip keys; no literal `t("…")` in the codebase is missing from
its namespace; `dir={isRtl(locale)?"rtl":"ltr"}` is set in layout and the
language panel anchors with the logical `inset-inline-end: 0`; all 11 flag
assets exist.

## i18n-1: Language switcher drops the query string (and hash) when changing locale
- **Severity**: medium
- **Side**: client
- **File**: src/components/LanguageSwitcher.tsx:119 (and `:85` `usePathname()`)
- **Evidence**: `const pathname = usePathname();` … `router.replace(pathname, { locale: next });`
  next-intl's `usePathname` returns the pathname *without* search params, and
  `router.replace(href)` navigates to exactly that href, so `?…` and `#…` are
  not carried over (docs: "Search params can be added via `query`" — i.e. not
  preserved by default).
- **Why it is a bug**: the switcher lives in the global footer, so switching
  language on `/en/compare?users=a,b`, `/en/leaderboards?tab=…` or a filtered
  `/en/badges?status=active&rarity=mythic` reloads the bare path — the user's
  selection (compared users, tab, filters) is silently lost for every locale.
- **Confidence**: likely
- **Fix direction**: read `useSearchParams()`/`window.location.hash` and pass
  `router.replace({ pathname, query: Object.fromEntries(searchParams), hash })`
  (or append the current `location.search + location.hash`).

## i18n-2: Compact-number formatter is hardcoded to `en` and used site-wide
- **Severity**: medium
- **Side**: shared
- **File**: src/components/badges/BadgeCard.tsx:11 (exported `formatCompact`), consumed in
  src/app/[locale]/page.tsx:64, src/app/[locale]/leaderboards/page.tsx:134,
  src/app/[locale]/stats/page.tsx:13 (imported; ~15 call sites incl. `:660`, `:663`, `:762`);
  same pattern in src/components/stats/TrendChart.tsx:26,97, src/components/charts/OwnersChart.tsx:43,57, src/components/stats/DonutChart.tsx:45
- **Evidence**: `new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value)`.
  Runtime evidence: `1234567` → en `1.2M` / de `1,2 Mio.` / ru `1,2 млн` / ja `123.5万` / ar `1.2 مليون`.
- **Why it is a bug**: the active locale is never passed, so home stats,
  leaderboards and the whole /stats dashboard show English-formatted compact
  numbers and English separators in all 10 non-English locales (German users see
  `1.2M` instead of `1,2 Mio.`).
- **Confidence**: confirmed
- **Fix direction**: give `formatCompact(value, locale)` (call sites already have
  the URL `locale`), or use the existing per-page `Intl.NumberFormat(locale)`.

## i18n-3: `toLocaleString("en")` hardcoded in game / economy / feed components
- **Severity**: low
- **Side**: client + server
- **File**: src/components/StealPanel.tsx:40,43,66; src/components/WheelOfFortune.tsx:136;
  src/components/games/CoinflipGame.tsx:32; src/components/games/SlotsGame.tsx:100,105;
  src/components/games/TowerGame.tsx:74; src/components/games/useGame.tsx:117;
  src/components/FeedList.tsx:135; src/lib/gamification/daily.ts:173; src/lib/gamification/games.ts:143-144
- **Evidence**: `data.stolen.toLocaleString("en")`, `cost.toLocaleString("en")`,
  `balance.toLocaleString("en")`, `stolen.toLocaleString("en")` in feed titles.
  `(1234567).toLocaleString("en")` = `1,234,567` vs de `1.234.567`, ru `1 234 567`, fr `1 234 567`.
- **Why it is a bug**: coin/XP amounts are formatted with English grouping
  separators in every locale, so German/Russian/French players read the wrong
  digit grouping; the server-side strings in `daily.ts`/`games.ts` also land in
  the public activity feed (`activity_events.title`) un-i18n'd.
- **Confidence**: confirmed
- **Fix direction**: thread the active locale into these components (they already
  call `useTranslations`) and format numbers with `Intl.NumberFormat(locale)`.

## i18n-4: Feed/stat kind labels can hit a missing `feed.*` key
- **Severity**: low
- **Side**: client
- **File**: src/components/FeedList.tsx:130 `t(event.kind)` (useTranslations("feed"));
  src/app/[locale]/stats/page.tsx:228,543 `tf(row.kind)` (getTranslations("feed"))
- **Evidence**: `satisfies`-union `FeedKind` (src/lib/gamification/xp.ts:27) covers
  all keys present in `messages/en.json:feed`, BUT
  src/lib/gamification/achievements.ts:329 queries
  `.from("activity_events")…in("kind", ["profile_visit", "steal_visit"])` — neither
  `feed.profile_visit` nor `feed.steal_visit` exists in any locale, and neither is
  in `KIND_COLORS` (FeedList.tsx:20). If any such row is ever present,
  `t(event.kind)` throws `MISSING_MESSAGE`.
- **Why it is a bug**: a single unexpected `activity_events.kind` value makes the
  live feed / stats donut throw for that locale (page error), instead of showing a
  label. (No insertion path for those two kinds was found, hence unconfirmed.)
- **Confidence**: unconfirmed
- **Fix direction**: add `profile_visit`/`steal_visit` (or a generic fallback
  `feed.other`) and a `t.has(event.kind)` guard before calling `t()`.

## i18n-5: `LiveStatus` renders a time with no locale
- **Severity**: low
- **Side**: client
- **File**: src/components/stats/LiveStatus.tsx:167
- **Evidence**: `new Date(health.checkedAt).toLocaleTimeString()` — no locale and no
  explicit time zone.
- **Why it is a bug**: the "last check" time is formatted from the runtime default
  (browser/Node locale), not the active locale, so an `en`-browser user browsing
  `/ja/stats` sees an English time format; being client-rendered it can also differ
  from the server-rendered pass (hydration warning).
- **Confidence**: likely
- **Fix direction**: pass the active `locale` (used elsewhere on this page) and a
  fixed time zone, e.g. `toLocaleTimeString(locale, { timeZone: "UTC" })`.

## i18n-6: Changelog kind filter omits `blog` and `push` entries
- **Severity**: low
- **Side**: server
- **File**: src/app/[locale]/changelog/page.tsx:44-52 (`kinds` array) vs src/lib/changelog.ts:4 (`ChangelogKind` includes `blog`, `push`)
- **Evidence**: filter chips list only `["all","badge_added","badge_updated","badge_removed","data_sync","feature","bugfix"]`; `changelog.blog` / `changelog.push` translations exist and rows of those kinds are written (auto blog posts, push notifications).
- **Why it is a bug**: blog/push changelog entries are unreachable through any
  filter chip in every locale (they only appear under "all").
- **Confidence**: confirmed
- **Fix direction**: add `"blog"` and `"push"` to the `kinds` array.