# Independent client-side audit — survived defects

Date: 2026-09-22. Read-only pass over the **client** surface (React 19 state /
effects, React-Compiler lint rules, RTL + i18n in the UI, forms and controls,
service worker / PWA). Working tree read as-is; no file was modified by this
audit.

Nothing here repeats an item already carried in `bugreports/AGENT-AUDIT.md`,
`verify-round8.md`, `verify-independent.md` or `verify-round10.md`. Where a
candidate overlapped an existing entry I dropped it (the wheel's missing
`usedToday`, the "Network error"/raw-server strings, `LevelBadge`'s duplicate
gradient id, `ShareButtons`' hydration URL). Live probes below are read-only
`curl` against https://twitch-badges-database.vercel.app.

Convention per finding — ID · severity · side · file:line · evidence ·
consequence · confidence · fix direction. IDs are prefixed `cli-`.

---

## cli-1 — Vault's stop guard is a one-shot latch: dials 2 and 3 can never be stopped, and there is no way out but a reload

- **Severity**: high (a game is unplayable; the player is trapped mid-round)
- **Side**: client
- **File:line**:
  - `src/components/games/VaultGame.tsx:15` — `const stopping = useRef(false);`
  - `src/components/games/VaultGame.tsx:53-54` — the guard and the latch
  - `src/components/games/VaultGame.tsx:64-69` — `start()`, the only place the latch is released
  - `src/components/games/VaultGame.tsx:96-104` — the only buttons (`start` on `idle`/`done`, `stop` while a dial runs)
- **Evidence**:
  ```ts
  const stopping = useRef(false);
  ...
  function stop() {
    if (stopping.current || dialIndex < 0) return;   // :53
    stopping.current = true;                          // :54  — set, never cleared per dial
    ...
    const nextPhase = phase === "dial1" ? "dial2" : phase === "dial2" ? "dial3" : "done";
    setPhase(nextPhase);
  }
  function start() {
    stopping.current = false;                         // :65  — the ONLY reset
  ```
  `stopping.current` is set on the first stop click and is reset **only** by
  `start()`. `start()` is reachable only from `phase === "idle"` and
  `phase === "done"` (`:96-104`); after the first stop the phase is `dial2`, so
  no button calls `start()` again. The bug is an adaptation artefact: the
  approved proposal (`bugreports/fixproposal-games.md`, `games-b-2`) specified a
  **per-dial** guard (`stoppedDial.current === dialIndex`, reset to `-1` in
  `start()`); the shipped code substituted a boolean that is never released.
- **Consequence (concrete, user-visible)**: on `/en/games/vault` the player aims
  dial 1, clicks **Stop** — the dial-2 needle starts spinning, and every later
  **Stop** click returns at `:53` before doing anything. The needle spins
  forever, no third stop is possible, `phase` never reaches `done`, so
  `play({matches})` (`:61`) is never called and the round is never submitted.
  No round button other than Stop is rendered (the `start` button needs `idle`,
  the `again` button needs `done`), so the only recovery is a page reload. The
  player is stuck on a screen with a dead control.
- **Confidence**: high — pure control flow, verified statement by statement; no
  interactive repro was possible (the page needs a Twitch session plus click
  interaction), but the latch has exactly one write site and one reset site.
- **Fix direction**: restore the proposal's per-dial guard
  (`const stoppedDial = useRef(-1); if (dialIndex < 0 || stoppedDial.current ===
  dialIndex) return; stoppedDial.current = dialIndex;` and reset to `-1` in
  `start()`), or reset `stopping.current = false` at the top of the movement
  effect (`useEffect(..., [dialIndex])`) so each new dial re-arms it.

---

## cli-2 — RTL: hardcoded `→` / `←` direction glyphs are never mirrored, so Arabic "next / view all" points backwards

- **Severity**: low–medium (navigation cue inverted for the only RTL locale)
- **Side**: client / i18n
- **File:line** (all occurrences in `src/`):
  - `src/components/badges/Pagination.tsx:41` — `← {t("prev")}`
  - `src/components/badges/Pagination.tsx:60` — `{t("next")} →`
  - `src/app/[locale]/page.tsx:77, 90, 103, 116` — `{tc("viewAll")} →`
  - `src/app/[locale]/page.tsx:131, 154` — a bare `→`
  - `src/app/[locale]/stats/page.tsx:653, 705, 810, 1285` — `{t("…")} →`
  - `src/components/games/TowerGame.tsx:54` — `` `← ${t("cashout")}` ``
- **Evidence**: `dir={isRtl(locale) ? "rtl" : "ltr"}` is applied in
  `src/app/[locale]/layout.tsx:90` and `isRtl` returns true for `ar`
  (`src/i18n/routing.ts:39-41`). `U+2190`/`U+2192` are fixed glyphs — the bidi
  algorithm does not mirror arrow characters — and every one of the sites above
  emits the glyph as literal text inside a translated label. `globals.css` has
  RTL overrides for the animated bars/rows (`:1221, :1361-1362`) but none for
  these glyphs.
- **Consequence (concrete)**: in `ar`, the Pagination `<nav>` is laid out
  right-to-left, so "next" sits on the left of the row with a **right-pointing**
  arrow next to it (`التالي →` renders as an arrow on the left-hand side
  pointing back into the already-read direction) while "prev" points left. The
  forward/back cue is inverted for Arabic readers on every catalog page; the
  same inversion makes the "View all →" / "cashout ←" cues point away from the
  text's reading direction.
- **Confidence**: high for the code fact and the bidi behaviour; the visual
  severity is minor (the labels still name the action).
- **Fix direction**: replace the literal glyphs with a logical element — e.g. a
  CSS-mirrored icon (`rtl:-scale-x-100` on an inline SVG chevron) or a
  `[dir="rtl"]`-swapped span — instead of raw arrow characters; or move the
  arrow into the message string so translators can orient it.

---

## cli-3 — `useChartTheme` never re-reads after mount, so toggling light/dark leaves every chart on the old palette

- **Severity**: low (chart chrome unreadable / wrong contrast after an in-session toggle)
- **Side**: client
- **File:line**: `src/components/stats/useChartTheme.ts:39-57` (the `useEffect` with `[]` deps and the `requestAnimationFrame` read); consumers `TrendChart.tsx:44`, `DonutChart.tsx:28`, `OwnersChart.tsx`
- **Evidence**: the hook documents itself as reading the tokens "once after
  mount … and follows the active theme from then on" (`:31-35`), but the effect
  dependency array is empty (`:57`) and nothing else in the app re-runs it.
  `ThemeToggle.toggle()` (`src/components/ThemeToggle.tsx:21-31`) only mutates
  `document.documentElement.classList` and `localStorage` — it triggers no React
  state change, so the charts do not re-render and the memoised `ChartTheme`
  stays at the values read at mount. Dark `--line-strong` is a light-on-dark
  stroke; light `--line-strong` is `rgba(22,22,44,0.18)` (`globals.css`, `.light`).
- **Consequence (concrete)**: load `/en/stats` in dark mode and press the theme
  toggle. The recharts grid and axis lines keep the dark stroke
  (`rgba(255,255,255,0.12)` at first mount) and become effectively invisible on
  the `#f8f8fb` light background, and the tooltip background stays `#17171f`
  (dark card on a light page). Reloading the page "fixes" it because
  `ThemeScript` applies the stored class before the mount read.
- **Confidence**: high (control flow + the hook's own comment contradicting the
  code).
- **Fix direction**: subscribe to theme changes — read the tokens again on a
  `MutationObserver` over `document.documentElement`'s `class`, or drive the
  theme through React context so a toggle re-renders the charts.

---

## cli-4 — `CountUp` ignores a changed `value` after its first animation (frozen number)

- **Severity**: low — **unconfirmed reachability** (no live trigger on `/stats` today)
- **Side**: client
- **File:line**: `src/components/stats/CountUp.tsx:28` (`startedRef`), `:38` (the `continue` that keeps it set), `:50`, `:61` (effect deps `[value, duration]`)
- **Evidence**:
  ```ts
  const startedRef = useRef(false);
  ...
  if (!entry.isIntersecting || startedRef.current) continue;   // :38
  startedRef.current = true;                                    // :39
  ```
  When `value` changes while the component stays mounted the effect re-runs
  (observer disconnected in cleanup, a new one created), but `startedRef.current`
  is still `true`, so the new observer's callback always `continue`s and
  `setDisplay(target)` for the new value is never reached. There is no reset of
  `startedRef`.
- **Consequence**: the displayed number keeps the target of the first animation
  for the rest of the component's life. On `/stats` the props are server-frozen
  (`revalidate = 300`, no `LiveRefresher`, no client filter), so I could **not**
  demonstrate a user-visible freeze today — hence "unconfirmed". It becomes real
  the moment a parent re-renders `CountUp` with fresh data without unmounting it
  (a live refresh or a client-side filter on the stats page), and it is a latent
  trap for reuse.
- **Confidence**: mechanism confirmed by code; user-visible impact unconfirmed.
- **Fix direction**: reset `startedRef.current = false` (and re-observe) when
  `value` changes, or drop the guard and let the fragment run whenever the node
  is intersecting, or make the target a dependency that re-triggers the climb.

---

## cli-5 — Memory card flip is dead code: the transform ternary has two identical branches, so `rotateY` never leaves 0°

- **Severity**: low (cosmetic — the intended 3D flip never plays)
- **Side**: client
- **File:line**: `src/components/games/MemoryGame.tsx:105`
- **Evidence**:
  ```tsx
  style={{ transform: card.flipped || card.matched ? "rotateY(0deg)" : "rotateY(0deg)" }}
  ```
  Both branches are `"rotateY(0deg)"`, on a button that also carries
  `transition-all duration-300` (`:98`). This is a *different* tautology from the
  one fixed as `games-b-12` (that was the `finalMisses` ternary, now removed at
  `:78-84`); this one was not reported.
- **Consequence**: the card never rotates — the reveal is signalled only by the
  border/background colour swap. The 300 ms transition animates nothing for
  `transform`, so the flip the class list implies does not happen. No functional
  loss (the game is playable), purely the missing animation.
- **Confidence**: confirmed (literal duplicate branches).
- **Fix direction**: use the real pair (`card.flipped || card.matched ?
  "rotateY(0deg)" : "rotateY(180deg)"` with a back face / `transform-style:
  preserve-3d`), or delete the inert `transform` and keep the colour change only.

---

## cli-6 — Untranslated literals baked into the UI (Arabic and the other 10 locales read English/German)

- **Severity**: low
- **Side**: client / i18n
- **File:line**:
  - `src/components/LevelBadge.tsx:25` — `` aria-label={`Level ${level}`} ``
  - `src/components/DailyClaim.tsx:46` — `` title={reward ? `+${reward.xp} XP · Tag ${reward.streak}` : undefined} ``
- **Evidence**: `LevelBadge` renders `role="img"` with a hardcoded English
  accessible name; a localized equivalent already exists in the message files
  (`profile` → `t("level")`, used at
  `src/app/[locale]/profile/[username]/page.tsx:277`). `DailyClaim`'s compact
  tooltip hardcodes the German word **"Tag"** ("day") plus an English "XP" suffix
  (`src/components/DailyClaim.tsx:46`), so a non-German locale gets a German
  word; the non-compact reward line repeats the raw "+{xp} XP"
  (`:76`). These are literal strings in components, not missing message keys —
  the i18n rounds fixed keys and number formatting, and the untranslated-key
  audit only covers `messages/*.json`, so these survived.
- **Consequence (concrete)**: on any non-English profile page a screen reader
  announces "Level 42" in English; the daily-claim button's tooltip shows
  "Tag 3" to a Japanese or Arabic user.
- **Confidence**: confirmed (literal strings).
- **Fix direction**: route both through `useTranslations` (the `profile.level`
  key exists); for the tooltip build the sentence with `t("dailyStreak", { xp,
  streak })` rather than concatenating.

---

## cli-7 — Profile share title reuses the "View all" label: the tweet reads "Alice — View all"

- **Severity**: low (wrong copy on an outbound share)
- **Side**: client / i18n
- **File:line**: `src/app/[locale]/profile/[username]/page.tsx:316-319`
- **Evidence**:
  ```tsx
  <ShareButtons
    path={`/${locale}/profile/${handle}`}
    title={`${displayName} — ${tc("viewAll")}`}
  />
  ```
  `tc` is the `common` namespace; `viewAll` ("View all") is the catalog section
  link label (`src/app/[locale]/page.tsx:77` etc.), used here as the share-title
  suffix.
- **Consequence (concrete)**: the X/Twitter share intent at
  `src/components/ShareButtons.tsx:50` builds
  `https://twitter.com/intent/tweet?text=Alice%20%E2%80%94%20View%20all&url=…`
  — a shared profile is announced as "Alice — View all". Compare the badge page,
  which correctly uses a literal brand suffix
  (`src/app/[locale]/badges/[slug]/page.tsx:166`).
- **Confidence**: confirmed (code reading; the string reaches the intent URL).
- **Fix direction**: use a profile-appropriate suffix (`t("title")` from the
  `meta`/`profile` namespace, or `${displayName} — Twitch Badges Database`).

---

## cli-8 — PWA `start_url` is hardcoded to `/en`, so the installed app always launches in English

- **Severity**: low (PWA/i18n)
- **Side**: client / PWA
- **File:line**: `src/app/manifest.ts:9` — `start_url: "/en"`
- **Evidence**: `routing` uses `localePrefix: "always"` with `defaultLocale:
  "en"` and next-intl's default `localeDetection` enabled
  (`src/i18n/routing.ts:3-7`). Live check: `GET /` → **307 → `/en`**, i.e. the
  root path performs locale negotiation; `GET /de` → 200. The manifest is served
  verbatim (live `manifest.webmanifest` returns `"start_url":"/en"`), and the
  matcher excludes `*.webmanifest` from the proxy
  (`src/proxy.ts:71-74`), so no locale logic touches it.
- **Consequence (concrete)**: a German or Arabic user who installs the PWA and
  launches it from the home screen always lands on the English site, even though
  a normal visit to the origin would have been negotiated to their locale; the
  stored `NEXT_LOCALE` cookie set by the language switcher is not consulted
  because the fixed path bypasses the redirect.
- **Confidence**: high (manifest + the live `/`→`/en` 307 prove the negotiation
  path exists and is skipped).
- **Fix direction**: set `start_url: "/"` (or `"/?source=pwa"`) so the
  middleware negotiates, and keep `id`/`scope` explicit.

---

## cli-9 — Language switcher's listbox never exposes the highlighted option to assistive tech

- **Severity**: low (a11y)
- **Side**: client
- **File:line**: `src/components/LanguageSwitcher.tsx:152-165` (trigger), `:167-212` (panel), `:181-190` (options)
- **Evidence**: the trigger has `aria-haspopup="listbox"` and `aria-expanded`,
  but keyboard handling lives on the trigger's `onKeyDown` (`:127-148`): arrows
  mutate `highlighted`, which only toggles the visual class
  (`index === highlighted ? "is-highlighted"` at `:185-187`). The options are
  `role="option"` with `tabIndex={-1}` (`:182,190`) and focus never leaves the
  trigger, and there is no `aria-activedescendant` on the trigger pointing at the
  active option id (the options have no ids at all).
- **Consequence (concrete)**: a screen-reader user pressing Enter on the flag to
  open the list, then ArrowDown, hears nothing change — no "2 of 11", no language
  name — because neither DOM focus nor `aria-activedescendant` moves; the only
  feedback is a CSS class. They must activate and read the grid to know what is
  selected.
- **Confidence**: confirmed (no `aria-activedescendant`, options `tabIndex=-1`,
  ids absent).
- **Fix direction**: give each option an `id` and set
  `aria-activedescendant={options[highlighted].id}` on the trigger, or move focus
  into the list and handle arrows there (roving tabindex).

---

## Checked and found clean

Examined and no defect found (or the candidate overlapped an existing entry and
was dropped):

- **Effects / cleanup**: `LiveRefresher` (visibility gate + interval clear),
  `Countdown` (rAF first paint + 1 s interval, both cleared; server renders "—"),
  `Reveal` (IntersectionObserver disconnected), `useChartTheme` rAF cleared,
  the game loops in `CatcherGame`/`ShootGame`/`VaultGame` (rAF cancelled on the
  `[running]`/`[dialIndex]` cleanup) and `SlotsGame`'s interval (cleared on
  unmount and after the round), `QuizGame`'s advance timer, `LiveStatus`'s
  kickoff timeout + visibility-gated interval + `mountedRef`, `PushToggle`'s SW
  probe and `serviceWorkerReady` timeout. The remaining uncleaned one-shot
  `setTimeout`s (`WheelOfFortune.tsx:77`, `MemoryGame.tsx:67`,
  `PushToggle.tsx:145`, `ShareButtons.tsx:37`, `AccountSettings.tsx:70/73`,
  `ProfileCustomizer.tsx:157/160`, `SyncButton.tsx:24/28`) call `setState` after
  unmount only — React 19 does not warn and there is no observable consequence,
  so they are **not** reported as defects.
- **React-Compiler rules**: no `Date.now()`/`Math.random()` during a component
  render body except the two server components that carry the inline
  `react-hooks/purity` disable on the call line
  (`BadgeCard.tsx:58-59`, `stats/page.tsx:201-203`); every other hit is inside an
  event handler or a rAF/interval callback. No synchronous `setState` in an
  effect body (all first paints go through `requestAnimationFrame`/`setTimeout`
  with the rule comment). `MemoryGame.finish()` already dropped the
  `games-b-12` tautology.
- **Game state**: `MemoryGame`'s `busyCards` gate (no restart window during the
  700 ms flip-back), `QuizGame`'s `choice !== null` single-answer gate,
  `ScratchGame`'s reveal reducer, `CoinflipGame`'s recorded `playedSide`,
  `RouletteGame`'s history `slice(0,12)`, `HiloGame`'s empty starting score,
  `useGame`'s `busy` + React's synchronous flush of discrete click events (no
  double-submit window on the game buttons), `BetBar`'s clamped numeric input.
- **Forms / controls**: `AccountSettings.save`, `ProfileCustomizer.save`,
  `SyncButton`, `DailyClaim`, `CoinRainButton`, `StealPanel`, `EmojiReactions`
  all guard re-entry and re-enable after success/failure; `TwitchLoginButton`
  guards `pending` and clears it on error. No control I found can be left
  permanently disabled (the `LanguageSwitcher` trigger's `disabled={isPending}`
  is released when the transition settles). No `aria-*` attribute states
  something false (checked `aria-pressed`, `aria-current`, `aria-selected`,
  `aria-expanded`, `aria-busy`, `role="timer"`).
- **RTL / i18n**: `dir`/`lang` correct; **no physical Tailwind utility**
  (`ml-/mr-/pl-/pr-/left-/right-/text-left/text-right`) anywhere in
  `src/components` or `src/app` — the components use `ms-/me-/ps-/pe-/start/end`;
  `globals.css` uses `inset-inline-end`, `text-align: start`, `padding-inline`
  and `[dir="rtl"]` overrides for `.grow-bar-fill`/`.rank-row`; language-panel
  keyframes are `translateY` only. Number/date formatting in the pages I read
  passes `locale` (profile, inventory, leaderboards, changelog, notifications,
  blog, badge detail, stats) — the `toFixed`/compact exceptions are the known
  `ind-1`/`ind-5` items.
- **Service worker / PWA**: `public/sw.js` is push-only (no `fetch` handler, so
  there is no offline cache to serve a stale or wrong-locale document); the
  `push`/`notificationclick` handlers propagate the payload url and focus/navigate
  an existing client correctly; push `tag`s are set deliberately by callers
  (`global.ts:305/314` "new-badges", `send-push.ts` "manual") so the SW's
  `"tbd-notification"` fallback is only for untagged payloads. `manifest.ts` icons
  resolve (`src/app/icon.svg` exists → live `GET /icon.svg` **200**; `icon-192`/
  `icon-512` present) — the only PWA issue found is `cli-8`. `ServiceWorkerRegister`
  registers once with a swallowed non-fatal error.
- **Misc client**: `Header` account menu (outside-click + Escape, listeners added
  only while open, `aria-expanded` correct), `FeedList` (500-entry seen cap,
  hidden-tab poll pause, mount-only clock), `ShareButtons` (URL resolved after
  mount, retry via `preventDefault` until ready), `ThemeToggle`/`ThemeScript`
  (class read after mount; a fast toggle before hydration is the known,
  acceptable lag), `BadgeImage` alt contract, `Coin`/`GameIcon` fallbacks,
  `compare` RTL column order (the explicit `sm:order-2/3` still yields A-right /
  B-left under `dir=rtl`), `error.tsx` (client boundary inside the intl provider).

## Summary

1 high, 0 medium, 8 low. `cli-1` is the only finding that breaks a shipped
feature (the Vault game cannot be finished); `cli-2`, `cli-3`, `cli-6`, `cli-7`
and `cli-8` are RTL/i18n/PWA polish with visible-but-minor consequences;
`cli-4` is a latent trap marked unconfirmed, and `cli-5`/`cli-9` are cosmetic
and a11y nits.