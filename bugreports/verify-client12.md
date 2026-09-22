# Verification — round 12, client side (commits `46c89ab`, `3ee3002`)

Scope: the client-side half of `46c89ab`, per the eight areas named in the brief.
Method: `git show 46c89ab`, full reads of the changed files, `npx tsc --noEmit`
(exit 0), targeted `npx eslint` on every changed component (clean), a real
`use-intl` translator probe against `messages/en.json`, a flat-key parity check
across all 11 locale files, and read-only `curl` against production
(`https://twitch-badges-database.vercel.app`).

Findings below. IDs are `c12-`. Nothing already listed as fixed or open in
`bugreports/AGENT-AUDIT.md` (rounds 1–12) or `FIXES.md` is re-reported.

---

## c12-1 — `streakDay` is resolved in the wrong namespace; the daily-claim tooltip renders the raw key

- **Severity:** medium
- **Side:** client
- **File:** `src/components/DailyClaim.tsx:9` (namespace) and `:46` (use)
- **Evidence:**
  - Line 9: `const t = useTranslations("games");`
  - Line 46: `title={reward ? \`+${reward.xp} XP · ${t("streakDay", { streak: reward.streak })}\` : undefined}`
  - The new key was added to the **`common`** namespace (`messages/en.json:86`, and
    in all 11 locale files), **not** to `games`. A flat-key check over all 11
    files reports `games.streakDay` missing in every one of them; `common.streakDay`
    exists in every one.
  - Reproduced against the real translator:
    ```
    createTranslator({locale:'en', messages, namespace:'games'}).('streakDay',{streak:3})
    → ONERROR: MISSING_MESSAGE  MISSING_MESSAGE: games.streakDay (en)
    → "games.streakDay"
    createTranslator({..., namespace:'common'}).('streakDay',{streak:3}) → "Day 3"
    ```
  - This is a **runtime** miss only: the `title` expression renders solely after a
    successful claim (`reward !== null`) on the compact variant, which is the only
    way `DailyClaim` is mounted (`src/app/[locale]/games/page.tsx:75` →
    `<DailyClaim compact />`). It is therefore invisible to the build-time
    `MISSING_MESSAGE` grep the commit cites, which explains the "0 MISSING_MESSAGE"
    claim.
- **Consequence:** After claiming the daily bonus on `/games`, hovering the button
  shows `+N XP · games.streakDay` in **all 11 locales** (next-intl's default
  `getMessageFallback` returns `joinPath(namespace, key)`), and an
  `IntlError(MISSING_MESSAGE)` is logged in dev. The cli-7 fix — "three new locale
  keys replace hardcoded strings", here replacing the German `Tag {n}` — did not
  actually take effect; the other two keys (`common.levelAria`, `profile.shareTitle`)
  are wired correctly.
- **Confidence:** high (reproduced against the installed `use-intl`, key parity
  verified across all 11 files).
- **Fix direction:** move `streakDay` into the `games` namespace in all 11 message
  files (or call it as `useTranslations("common")`), keeping the files key-identical.
  A flat-key diff alone cannot catch this — a namespace-aware usage check is needed.

---

## c12-2 — the vault double-click guard resets on the phase change, so a real double-click still stops two dials

- **Severity:** low
- **Side:** client
- **File:** `src/components/games/VaultGame.tsx:55-65` (guard at `:56-57`)
- **Evidence:**
  ```ts
  function stop() {
    if (dialIndex < 0 || stoppedDial.current === dialIndex) return;
    stoppedDial.current = dialIndex;
    ...
    setPhase(nextPhase);   // dial1 -> dial2 ...
  }
  ```
  `dialIndex` is derived from `phase` (`:19`) and `stoppedDial` is only compared
  for equality with the current dial. React flushes a discrete `click` at the end
  of each event, so a genuine double-click is two separate event dispatches with a
  committed render in between:
  1. click 1 → `dialIndex === 0`, `stoppedDial` becomes `0`, render commits `phase = "dial2"`.
  2. click 2 (same button, still labelled "Stop") → the new handler sees
     `dialIndex === 1`, `stoppedDial === 0` → the guard does **not** match → dial 2
     is stopped ~150 ms after it started, almost always a miss (zone is 130°,
     needle is near 0°).

  The same-task case (two programmatic `.click()`s in one tick) *is* blocked,
  which is the only window the code comment claims to cover ("before the phase
  transition has been applied"). A physical double-click spans the transition and
  is not blocked.
- **Consequence:** A double-click on the stop button stops dial 1 **and** dial 2;
  the round then completes with dial 3. It does not overpay (only one `play()` runs
  at the end) and cannot be exploited for two payouts, so this is a gameplay/fairness
  regression rather than an economy one. It is nonetheless the exact behaviour the
  brief asks the guard to prevent ("a double-click on the SAME dial still cannot
  advance two dials"). The prior boolean guard could not exhibit this (it over-blocked,
  which was cli-1).
- **Confidence:** medium-high on the mechanism (React discrete-event flushing is
  deterministic); not reproduced in a live browser.
- **Fix direction:** add a short time-based lock on `stop()` (ignore a stop within
  ~250 ms of the previous one), or gate the next dial's stop behind the start of its
  animation frame, so the phase transition and the second click cannot interleave.

---

## c12-3 — `start_url: "/"` with no explicit `id` changes the installed PWA identity

- **Severity:** low
- **Side:** client
- **File:** `src/app/manifest.ts:9`
- **Evidence:**
  - Diff: `start_url` went `"/en"` → `"/"`. The manifest has **no `id` field**
    (full file read; only `start_url`, `name`, `short_name`, `display`, colors,
    `icons`).
  - Per the Web App Manifest spec, an absent `id` defaults to the resolved
    `start_url`. The default id therefore changes from `/en` to `/`.
  - Production confirms the new value is live and that `/` redirects to a localized
    page: `GET /` → `307 → https://twitch-badges-database.vercel.app/en`; the
    manifest body contains `"start_url":"/"`.
- **Consequence:** The functional goal ("installed app lands on a localized page")
  is met — `/` 307-redirects to the detected locale. But because the app identity
  changed, an already-installed PWA (id `/en`) is treated by the browser as a
  *different* app: it will not receive manifest updates and may be installable a
  second time. No existing install is broken at runtime, hence low.
- **Confidence:** medium (spec-derived; not verified in a browser install).
- **Fix direction:** declare an explicit, stable `id` in the manifest and keep
  `start_url: "/"`; the id should not track the start path again.

---

## Areas checked and found clean

1. **`VaultGame` full round / `start()` reset / replay** — A three-dial round is
   playable: `stop()` advances `dial1→dial2→dial3→done` (`:62`), `play()` fires once
   on the final stop, the "again" button calls `start()`, and `start()` resets
   `stoppedDial.current = -1`, `matches`, `angles` and `phase` (`:67-72`). The
   same-render double click is blocked (`:56`). The animation effect (`:21-36`)
   cancels its rAF on every `dialIndex` change and on unmount. Only the cross-render
   double-click is open (c12-2).
2. **`CountUp`** — No infinite loop: both effects depend on `[animateTo, value]`
   with `animateTo` memoized on `[duration]`; a `value`-unchanged re-render does not
   re-run them. The reveal runs exactly once (`revealedRef` gate at `:64-66`). No
   double animation: on a `value` change effect 1 only rebuilds the IntersectionObserver
   (whose callback returns at `:64`) while effect 2 is the sole caller of `animateTo`.
   Cleanup cancels the frame on unmount (`:80`). No synchronous `setState` in an
   effect body — `setDisplay` only runs inside the rAF `step`. ESLint clean.
3. **`useChartTheme`** — The `MutationObserver` is disconnected on unmount (`:71`)
   and the pending rAF is cancelled (`:70`). No loop: `setTheme` re-renders the
   consuming chart only (effect deps `[]`), and does not mutate `<html class>`;
   the only class writer is `ThemeToggle.tsx:23-24`. It does pick up the toggle — the
   observer filters on `class` and `readTheme` re-reads computed style, which
   reflects the swapped `.light`/`.dark` class.
4. **`LevelBadge`** — `useTranslations("common")` with `common.levelAria` present in
   all 11 locales. No `"use client"` directive, and both call sites are Server
   Components (`src/app/[locale]/games/page.tsx:56`,
   `src/app/[locale]/profile/[username]/page.tsx:262`); the "rendered inside client
   components" premise does not hold in the current tree (grep found exactly those
   two importers). RSC `useTranslations` is a first-class next-intl export
   (`next-intl/dist/types/react-server/useTranslations.d.ts`) and is already used by
   this repo's server components (`not-found.tsx`, `badges/RarityChip.tsx`,
   `badges/Pagination.tsx`). `tsc --noEmit` exits 0.
5. **`DailyClaim` / profile page keys** — `profile.shareTitle` is used in the
   `profile` namespace with the matching `{name}` param and `{ name: displayName }`
   (`page.tsx:317`); the old `tc("viewAll")` and the now-unused `const tc` were both
   removed with no other `tc(` usage left. The share title no longer reads "View all".
   `LevelBadge`'s key is correct. Only `streakDay` is mis-namespaced (c12-1).
6. **`/stats` uptime rows** — Every field the table renders is present: `last_at`,
   `last_status`, `last_message`, `avg_ms_24h`, `checks_24h`, `rate24h`, `rate7d`
   as direct `rest` properties or recomputed (`page.tsx:342-357`), consumed at
   `:1037-1080`. `key` is `${index}-${label}` — unique by the array index.
   The raw id is genuinely gone: `const { source: rawId, ...rest } = entry` drops
   it, and production `/en/stats` contains **0** occurrences of `cron/global`,
   `cron/potat`, `cron/badgebase`, `sync/global`, `sync/potat` (the earlier
   `sourceCron*` hits are message-catalog JSON keys in the next-intl client payload,
   not data). `uptime.daily`/`uptime.hourly` are aggregated into `calendarCells`
   server-side; the only client chart components on the page (`TrendChart`,
   `DonutChart`) receive XP/kind data, not source rows.
7. **`manifest.ts` start_url** — `/` redirects (307) to `/en` on production, so the
   installed app still lands on a localized page. The only issue is the implicit-id
   side effect (c12-3).
8. **`MemoryGame`** — The deleted inline style was `transform: rotateY(0deg)` in
   *both* branches (a genuine no-op). The card `<button>` carries only Tailwind
   classes (`grid aspect-square place-items-center rounded-xl border transition-all
   duration-300` + colour), no inline transform, and no ancestor has
   `perspective`/`backface-visibility`. The only `rotateY` keyframes in the tree
   (`globals.css:945-948`, `bcoin-flip`) belong to the `Coin` component. Nothing
   depended on the element's transform.

Also re-verified and unchanged by this commit: `npx tsc --noEmit` → 0; targeted
ESLint on all six changed client components → 0 errors/warnings.