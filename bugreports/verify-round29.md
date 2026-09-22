# Verification round 29 — fp-3 (`cea8e44`), docs (`9ba224c`), v28 fixes (`54a17b6`)

Date: 2026-09-22. Scope: the fp-3 commit (53 `pf-` classes in `globals.css`,
three client components in `src/components/profile/ProfileEffects.tsx`, the
settings block in `src/app/[locale]/profile/[username]/page.tsx`, 3 new message
keys), plus the v28 fixes in `54a17b6`. Everything checked against
`src/components/account/ProfileCustomizer.tsx` DEFAULTS. Live evidence gathered
against the production DB (member `band1to`) and the production deployment;
no project file was edited other than this report.

Method summary: full read of the four files; every regex/enum guard executed
against hostile payloads in Node; a hostile `customization` document written
directly to the live member (bypassing the API on purpose, to exercise the
page-level sanitization) and rendered through a local dev server; defaults
render re-checked with `{}`; the document restored to `{}` and verified.
Both economy scripts re-run; lint/typecheck/build re-run.

---

## Findings

### v29-01 — `levelHalo` is parsed and emitted but can never take effect — Medium
- **Side:** server (page) + client component interplay
- **File:** `src/app/[locale]/profile/[username]/page.tsx:384`,
  `src/components/LevelBadge.tsx:24`, `src/app/globals.css:1925`
- **Evidence (live):** the rendered HTML contains
  `<span style="--level-halo:#34d39966"><span class="level-badge …" style="width:64px;height:64px;--level-glow:#34d399;--level-halo:rgba(52,211,153,.45)" …>`.
  The page sets the member's colour on a **wrapper** span; `LevelBadge` sets
  `--level-halo: theme.halo` in its **own inline style**, and an element's own
  inline custom property always wins over the inherited one. Every consumer of
  the variable (`.level-badge` filter and the `level-breathe` keyframes,
  globals.css:750-757) resolves against the badge element, so the wrapper's
  value is shadowed. Additionally the CSS rule
  `.pf-level-halo .level-badge { --level-halo: var(--pf-level-halo, …) }`
  (globals.css:1925) references a class no markup ever applies — dead code
  confirming the intended-but-unwired mechanism.
- **Why it is a bug:** a stored customizer setting has zero visual effect —
  exactly the fp-3 failure class this feature exists to close. (In the live
  probe the level's own theme happened to be green, masking it; set
  `levelHalo:#ff0000` and nothing changes.)
- **Confidence:** high (proven from the rendered HTML, not just reading).
- **Fix direction:** have `LevelBadge` accept an optional `haloOverride` prop
  (page passes the validated hex) instead of writing the var from outside, or
  move the wrapper var to a value LevelBadge does not itself set; delete the
  dead `.pf-level-halo` rule or actually apply the class with
  `--pf-level-halo` on the profile root.

### v29-02 — `coinRainAuto` renders permanently invisible coins — Medium
- **Side:** client
- **File:** `src/components/profile/ProfileEffects.tsx:107-133`
- **Evidence:** the inline style starts `opacity: 0` and the post-mount rAF
  sets `node.style.opacity = "0"` — 0 → 0, so the 1.6s opacity transition
  animates nothing and the coin is transparent for its whole life. Independent
  second cause: the rain `.bcoin` spans get only `fontSize` — no
  `width`/`height`. `Coin.tsx` always sets both explicitly; the base `.bcoin`
  (globals.css:856) has no intrinsic size and its only child (`.bcoin-face`)
  is `position: absolute`, so each coin is a 0×0 box. Even with the opacity
  fixed the shower is invisible.
- **Why it is a bug:** the `coinRainAuto` toggle is a visual no-op; the member
  enables an effect that never appears.
- **Confidence:** high (two independent, code-proven causes).
- **Fix direction:** initial `opacity: 1` and fade to 0 at the end (or start 0
  → 1); set explicit `width`/`height` (e.g. derived from the same fontSize
  math `Coin` uses). Also use `em`-scaled travel rather than `top: 100vh`
  inside a 7rem-tall clipping banner.

### v29-03 — `profiles.color` set through basic settings never reaches the profile — Medium
- **Side:** server
- **File:** `src/components/account/AccountSettings.tsx:62`,
  `src/app/api/account/route.ts:41-42`,
  `src/app/[locale]/profile/[username]/page.tsx:213`
- **Evidence:** the account page has **two** colour pickers.
  `AccountSettings.save()` posts `color` top-level; the API writes it to the
  `profiles.color` **column** only. The public profile reads only
  `customization.color` (`text("color")`) and never uses `profile.color`,
  although `getProfileByUsername` selects it (`src/lib/queries.ts:418`). Live
  member state confirms the split: `customization: {}`, `color column: null`.
  (The customizer picker stays in sync because its save writes both the column
  and the document.)
- **Why it is a bug:** a member who sets their colour in the topmost settings
  card sees no change on their public profile — the stored-setting-not-applied
  class fp-3 claims to have closed. Not a regression (the pre-fp-3 page ignored
  the column too), but it is live and member-visible.
- **Confidence:** high.
- **Fix direction:** in the page, fall back to `profile.color` when
  `customization.color` is absent (`hex(text("color") || profile.color ?? "", …)`),
  or make `/api/account` mirror a top-level `color` into `customization.color`.

### v29-04 — showcase "carousel" animates each tile by half its own width — Low
- **Side:** CSS
- **File:** `src/app/globals.css:1931`, page `:692-699`
- **Evidence:** `.pf-showcase-carousel > * { animation: pf-scroll 26s linear infinite }`
  and `@keyframes pf-scroll { to { transform: translateX(-50%) } }`. A
  percentage translate is relative to the **animated element's own** box, and
  the direct children here are the individual badge tiles (no duplicated
  wrapper track like the ticker has). Each tile therefore slides left by ~50%
  of its own width and snaps back, every 26s — an oscillation, not a scroll.
- **Why it is a bug:** the layout option does not do what the commit message
  describes ("carousel with a paused-on-hover scroll").
- **Confidence:** high (CSS semantics; the selector's targets are unambiguous).
- **Fix direction:** duplicate the tile strip inside a `pf-*-track` (like the
  ticker) and animate the track, or key the carousel on a translate distance
  computed for the strip.

### v29-05 — `pf-scroll` marquee/ticker breaks under RTL (Arabic) — Low
- **Side:** CSS / i18n
- **File:** `src/app/globals.css:1912-1919`, `src/app/[locale]/layout.tsx:90`,
  `src/i18n/routing.ts:39`
- **Evidence:** the seamless loop works because in LTR the over-wide
  `width: max-content` track overflows to the **right** (inline-end), and
  `translateX(-50%)` pulls the hidden copy in. `ar` renders with
  `dir="rtl"`, where an over-wide block overflows to the **left**: the track's
  start (right) edge is at the container's right, so sliding left moves the
  content **away** from the visible window — a growing blank region enters
  from the right until the animation snaps back to the start. Affects
  `.pf-ticker-track`, `.pf-marquee-track` and the carousel. The crown frame
  (`inset … 50%; translate: -50% 0`) and the bubble tail (`left: 1.1rem`) use
  physical offsets and are fine.
- **Why it is a bug:** Arabic profiles get a broken ticker/marquee/visitor
  strip (cosmetic, one locale, decorative elements).
- **Confidence:** medium-high (CSS direction semantics; not visually
  confirmed in a browser).
- **Fix direction:** `[dir="rtl"] .pf-ticker-track, … { animation-direction: reverse }`
  plus a matching keyframe, or force `direction: ltr` on the track while
  keeping item content RTL-safe.

### v29-06 — `effectsIntensity: "off"` does not disable every decoration — Low
- **Side:** CSS (+ one JS gap)
- **File:** `src/app/globals.css:1935-1944`
- **Evidence:** the `.pf-fx-off` block omits `.pf-showcase-carousel > *` and
  `.pf-avatar-glow` — both keep animating when effects are "off", while the
  `prefers-reduced-motion` block at :1950-1953 **does** list them (so the
  intent is documented in the same file). `.pf-auto-rain` is also not
  `display: none`d the way `.pf-particles` is. `ProfileTilt` is JS-driven and
  unaffected by any CSS kill switch, so tilt also continues under "off". The
  commit message claims "off disables every decoration".
- **Why it is a bug:** a member who turns effects off still sees three moving
  decorations.
- **Confidence:** high.
- **Fix direction:** add the two selectors (and `.pf-auto-rain`) to the
  `.pf-fx-off` block; gate `ProfileTilt`'s listener on
  `effectsIntensity !== "off"` (pass it as a prop) or check the class on the
  root.

### v29-07 — particles/auto-rain lose their containing block when `bannerShine` is off — Low
- **Side:** CSS / page markup
- **File:** page `:339,357-358`, `src/app/globals.css:1840,1856,1947`
- **Evidence:** the banner div only receives `position: relative` from the
  `.pf-banner-shine` class. `.pf-particles` / `.pf-auto-rain` are
  `position: absolute; inset: 0`; neither `.card` (globals.css:172, no
  position) nor any layout wrapper (`body > div.flex > main`) is positioned,
  and `ProfileTilt`'s `will-change` box is a **sibling**, not an ancestor. With
  `bannerShine: false` + `particles: true` the particles resolve against the
  initial containing block and float over the top of the page, unclipped (the
  section's `overflow: hidden` cannot clip an abs-positioned descendant whose
  containing block is outside it). Live render with shine on confirmed the
  intended placement; the off-combination is code-proven.
- **Why it is a bug:** a legal settings combination (default shine on, but
  toggleable) misplaces another effect.
- **Confidence:** medium-high.
- **Fix direction:** give the banner div `relative` unconditionally (e.g. add
  a `relative` utility to the className at page :339).

### v29-08 — density is half-applied; `--pf-gap` is defined but never consumed — Info
- **File:** `src/app/globals.css:1778-1780`, page `:322` (`space-y-8` hardcoded)
- Compact tightens `.card` padding and zeroes `section` top margins, but the
  page's vertical rhythm stays `space-y-8`; `--pf-gap` has zero readers.
  Fix: use `space-y-[var(--pf-gap,2rem)]` on the root (or drop the variable).

### v29-09 — dead ternary in `themeClass`; light mode gets the dark-mode violet forced — Info
- **File:** page `:242-251`
- `profileTheme === "auto" ? (customColor !== "#a970ff" ? "" : "") : …` — both
  branches are `""` (leftover of an unfinished distinction). Meanwhile
  `rootAccentVars` is **always** set in auto mode, so `--pf-accent` is forced
  to `#a970ff` even in light mode where `--accent` is `#7c3aed`; every
  `var(--pf-accent, var(--accent))` fallback is unreachable and the member
  title/decorations lose the light-mode contrast violet. Fix: skip
  `rootAccentVars` when the colour is the default and rely on the var
  fallbacks; delete the dead ternary.

### v29-10 — `title` length mismatch between editor and page — Info
- **File:** `ProfileCustomizer.tsx:179` (maxLength 120 for all text fields) vs
  page `:236` (`.slice(0, 64)`). A member can save a 100-char title and see it
  cut at 64. (`displayName` is consistent: API slices the column to 64 too.)

### v29-11 — minor: ticker loop seam and the always-present tilt wrapper — Info
- The two ticker passes are separated by `gap: 1.25rem` while items inside a
  pass use `gap-4` (1rem) — a 0.25rem position jump at each loop boundary
  (globals.css:1914 vs page `:525`). And `ProfileTilt` renders its
  `.pf-tilt` wrapper div (with `will-change: transform`, i.e. its own
  compositing layer) even when tilt is disabled — harmless for layout (plain
  block wrapper; the avatar's `-mt-10` still escapes it, verified in the live
  HTML), but paid on every profile.

---

## 1. Defaults fidelity — full diff, page fallback vs `DEFAULTS`

All 35 keys. "Page fallback" = `src/app/[locale]/profile/[username]/page.tsx:199-238`.

| key | DEFAULTS | page fallback | match |
|---|---|---|---|
| displayName | `""` | dedicated column `display_name` (`:167`) | ✓ |
| bio | `""` | dedicated column `bio` (`:473`) | ✓ |
| bannerUrl | `""` | dedicated column `banner_url` (`:341`) | ✓ |
| color | `#a970ff` | `hex(text("color"), "#a970ff")` | ✓ |
| accent2 | `#60a5fa` | `hex(…, "#60a5fa")` | ✓ |
| font | sans | `one(…, "sans")` | ✓ |
| cardStyle | glass | `"glass"` | ✓ |
| radius | soft | `"soft"` | ✓ |
| nameGradient | `""` | regex requires ≥2 hex stops → `""` | ✓ |
| avatarFrame | none | `"none"` | ✓ |
| bannerOverlay | 0 | `num(…, 0)` clamped 0–90 | ✓ |
| showcaseLayout | grid | `"grid"` | ✓ |
| showStats | true | `flag(…, true)` | ✓ |
| showInventory | true | `flag(…, true)` | ✓ |
| showLevel | true | `flag(…, true)` | ✓ |
| showCoins | true | `flag(…, true)` | ✓ |
| showVisitors | true | `flag(…, true)` | ✓ |
| socialTwitter | `""` | `text(…)` → `""` | ✓ |
| socialDiscord | `""` | `""` | ✓ |
| title | `""` | `""` (sliced 64, see v29-10) | ✓ |
| density | cozy | `"cozy"` | ✓ |
| aura | false | `flag(…, false)` | ✓ |
| particles | false | false | ✓ |
| nameRainbow | false | false | ✓ |
| **bannerShine** | **true** | **`flag(…, true)`** | ✓ |
| tilt3d | false | false | ✓ |
| pixelAvatar | false | false | ✓ |
| **achievementTicker** | **true** | **`flag(…, true)`** | ✓ |
| **greetingBanner** | **true** | **`flag(…, true)`** | ✓ |
| levelHalo | `#a970ff` | `hex(…, "#a970ff")` | ✓ (but see v29-01) |
| cursorBadge | false | false | ✓ |
| statusBubble | `""` | `""` (sliced 120) | ✓ |
| profileTheme | auto | `"auto"` | ✓ |
| effectsIntensity | subtle | `"subtle"` (class always emitted) | ✓ |
| coinRainAuto | false | false | ✓ |
| visitorMarquee | true | `flag(…, true)` | ✓ |

**No mismatch.** The three default-TRUE effects — `bannerShine`,
`achievementTicker`, `greetingBanner` — now appear on every member profile
because that is literally what `DEFAULTS` says (ProfileCustomizer.tsx:63-67),
and the live default render (customization `{}`) confirmed all three classes
present. Stated plainly: this is the specified behaviour, not a defect — but
it does mean every profile gained a shine sweep, a greeting strip and (with ≥2
achievements) a ticker that it did not show before fp-3. Note there is a
**fourth** default-true setting, `visitorMarquee`, so the owner's visitor row
now also scrolls by default.

## 2. Injection and safety — all claims verified

Executed against Node with hostile payloads:

- `nameGradient` regex `/^#[0-9a-fA-F]{3,8}(,\s*#…)+$/`: rejects `#a970ff}`,
  `#a970ff}`, `#fff, url(x)`, `red,blue`, `#{inject}`, `javascript:alert(1)`;
  accepts only hex-stop lists (8-digit hex is valid CSS). `}`, `url(`, `;`
  cannot pass → the `linear-gradient(90deg, ${…})` inline style (page :394) is
  safe. Only nit: 5/7-char stops are invalid CSS and silently drop the
  gradient.
- `hex()`: rejects `javascript:`, `#a970f`, bare `a970ff`, `#a970ff;}`,
  `rgba(…)`. `levelHalo`/`color`/`accent2` all pass through it; `${levelHalo}66`
  is a valid 8-digit hex.
- usernames: `socialTwitter` strip `[^A-Za-z0-9_]` turned
  `javascript:alert(1)//` into `javascriptalert1` — **live-confirmed** in the
  rendered href (`https://x.com/javascriptalert1`); `socialDiscord` strip
  turned `x" onmouseover=alert(1)` into a dot-free path segment. No
  `javascript:` URI can survive either.
- `statusBubble`: React-escaped text node, sliced to 120 (10,000-char input →
  120, tested). Live render shows `&lt;script&gt;alert(1)&lt;/script&gt; } url(x)`
  as literal text; no raw `<script>` in the body.
- jsonb shapes: `customization` as `null` (→ `{}`), array, string, number —
  every keyed read returns `undefined` and falls back; nothing throws.
- Enum `one()` lists match the customizer's select options exactly (all 8
  selects). No value from `customization` reaches `style`/`href`/`className`
  unvalidated (full audit of every interpolation; `banner_url` in a background
  style is the pre-existing dedicated-column path, API-validated to
  `^https?://`, unchanged by fp-3).
- `customization` blobs are bounded at the API (object, ≤64 keys, ≤4096 chars,
  arrays rejected — route.ts:51-88) and by migration 0012 in the DB.

## 3. CSS checks

- **Radius specificity:** `--radius-*` are set on the profile root as custom
  properties — they inherit, so the `:root` tokens (globals.css:39-41) are
  cleanly shadowed inside the profile only; `.card`'s
  `border-radius: var(--radius-card)` picks them up. No specificity conflict
  possible (the declaration lives on an ancestor).
- **`.pf-cards-outline .card` vs `.card`:** (0,2,0) beats (0,1,0) and the pf
  block is last in the file; both the Tailwind-v4 layer order (unlayered
  globals beat layered utilities) and source order agree. Works.
- **`.pf-fx-off`:** does **not** disable everything — see v29-06 (carousel
  tiles and avatar-glow keep animating; auto-rain not hidden; JS tilt
  unaffected).
- **`prefers-reduced-motion`:** the fp-3 block (:1950-1953) covers aura,
  banner-shine, particle, name-rainbow, status-bubble, ticker/marquee tracks,
  carousel children and avatar-glow; the coin system (`.bcoin*`) has its own
  pre-existing block (:973-976). Gaps: `ProfileTilt`'s pointer transform (JS)
  and `ProfileAutoRain`'s `top` **transition** (transitions are not covered by
  `animation: none`) — moot today because the coins are invisible (v29-02),
  but worth one line if that is fixed.
- **RTL:** marquee/ticker/carousel broken under `dir="rtl"` (v29-05); crown
  frame, bubble tail, showcase-row scrolling and the greeting strip are
  physical-offset or direction-agnostic and fine.
- **Live render:** with a full test document the HTML contained
  `pf-font-serif pf-cards-outline pf-radius-sharp pf-density-compact
  pf-theme-emerald pf-fx-full pf-cursor-badge pf-banner-shine pf-aura
  pf-avatar-crown pf-avatar-pixel pf-tilt pf-greeting pf-ticker`, the inline
  gradient, `--pf-accent:#ff00aa` / `--pf-accent-2:#00ffcc` on the root in
  auto mode, `--level-halo:#34d39966`, and `opacity: 0.9` for a stored
  `bannerOverlay: 120` (clamped to 90).

## 4. Client components

- `ProfileParticles`: seeds only inside a post-mount rAF (setState not in the
  effect body — Compiler-rule compliant), server renders `null`, first client
  render `null` → no hydration mismatch; cleanup cancels the frame; re-seeds
  on `count` change; inline values are numeric/hex only. OK.
- `ProfileTilt`: effect bails when `!enabled` (no listeners), adds
  `pointermove`/`pointerleave` and removes both in cleanup; deps `[enabled]`.
  Wrapping is unconditional — the extra `.pf-tilt` div exists even when off,
  but it is a plain block wrapper: the identity row's flex layout and the
  avatar's `-mt-10` overlap survive (checked in the live HTML), no layout
  break; cost is the always-on `will-change` layer (v29-11). Cannot crash on
  reduced-motion (no media query involved) or missing avatar (initials
  fallback is server-side).
- `ProfileAutoRain`: 4s timer empties the coins and unmounts the subtree;
  frame + timer both cleaned up; the rAF inside the ref callback writes only
  to a detached node if unmounted first (harmless). Functional behaviour is
  v29-02 (invisible). No crash paths on reduced-motion or missing avatar.

## 5. Per-setting application walk

Every key reaches markup (server render unless noted): font→root class `:324`;
cardStyle→`:325`; radius→`:326`; density→`:327`; profileTheme→`:242/:328`;
effectsIntensity→`:329`; cursorBadge→`:330`; color→`--pf-accent` `:250` +
particle/rain accents `:357-358`; accent2→`--pf-accent-2` `:250` (consumed by
`.pf-avatar-double`); bannerShine→`:339`; bannerOverlay→`:350-356`; particles→
`:357` (client); coinRainAuto→`:358` (client); tilt3d→`:360` (client);
avatarFrame→`:365`; aura→`:366`; pixelAvatar→`:367`; showLevel→`:383/:443/:461`;
levelHalo→`:384` (emitted but shadowed — v29-01); nameGradient→`:391-400`;
nameRainbow→`:390` (overrides gradient, live-verified: no inline gradient when
rainbow on); memberTitle→`:406`; socialTwitter/socialDiscord→`:411/:425`;
statusBubble→`:440`; greetingBanner→`:512`; achievementTicker→`:521`;
showStats→`:544`; showVisitors+visitorMarquee→`:641-649`;
showcaseLayout→`:695-696`; showInventory→`:261` (`inventoryVisible`); showCoins
→`:450/:461`; displayName/bio/bannerUrl→columns `:167/:473/:341`. **The one
"parsed but never (effectively) used" key is `levelHalo`** (v29-01); the one
stored-but-ignored sibling setting is the `profiles.color` **column** (v29-03).
`ProfileTilt`'s open tag `:360` / close tag `:509` nest correctly around the
identity row (section closes `:510`; build 227/227). Gates hold after the JSX
edits: `showLevel` hides badge + XP bar with the coins line nested inside,
`showCoins && !showLevel` fallback at `:461`, first three stat tiles behind
`inventoryVisible`, owner-always-sees-inventory unchanged (`:261`).

## 6. v28 fixes re-verified

- **Script scoping (v28-02):** `scripts/verify-atomic-economy.ts:243-250` —
  the `activity_events` cleanup is `.gt("id", eventHigh).eq("user_id", profile.id)`.
  Confirmed again by the run: `feedRowsRemoved=6`, all scoped by construction.
- **rowExisted (v28-03):** captured at `:33-40` **before** `getProgress`
  (which upserts), deleted in `finally` at `:259-264` when the script created
  it. Reasoned through rather than exercised live (the test profile `band1to`
  has a progress row, xp 3610); the branch ordering is sound — the restore
  update runs first but is immediately followed by the delete, so no zero row
  survives.
- **Migration 0024 (v28-01), live:** anon column SELECT on `blog_reactions`
  → **200** (kept); anon REST INSERT → **401** `permission denied for table
  blog_reactions` (closed); production route `POST /api/blog/react` → 400 on
  invalid payload (validation intact), then a real toggle pair on
  `welcome-to-twitch-badges-database`: add **200** `{"ok":true,"added":true}`,
  remove **200** `{"ok":true,"removed":true}` — the route still writes through
  the service role and net-zero rows were left.

## 7. Gates, scripts, and the live-defect verdict

- `npm run lint`: **0 errors**, 7 warnings (pre-existing, e.g. unused `href`
  in badgebase.ts). Exit 0.
- `npm run typecheck`: 0 errors. Exit 0.
- `npm run build`: **227/227** static pages, 0 `MISSING_MESSAGE` in the log.
  Exit 0.
- `npx tsx scripts/verify-game-economy.ts`: 13 games, all `ok` — rps 0.9659,
  slots 0.1319, shoot 0.8988, memory 0.8845, quiz 0.7988, coinflip 0.9686,
  hilo 0.9865, roulette 0.3658, blackjack 0.5822, vault 0.9032, scratch
  0.9816, tower 0.9022, catcher 0.8596; worst hilo 0.9865 (< 1). **Exit 0.**
- `npx tsx scripts/verify-atomic-economy.ts`: 17/17 PASS (concurrent awards,
  counters, daily/wheel single-winner gates, XP budget cap 100, 123
  achievements resolve); restore **EXACT** xp 3610/3610, coins 1840/1840,
  level 11/11, feedRowsRemoved 6, achievementRowsRemoved 4. **Exit 0.**
- Messages: 678 keys × 11 locales key-identical; `greeting`,
  `socialTwitterLabel`, `socialDiscordLabel` present everywhere.

**Live-defect answer (item 7):** yes, three member-visible live defects remain
in fp-3's own scope — `levelHalo` silently does nothing (v29-01), `coinRainAuto`
silently does nothing (v29-02), and a colour set through the basic-settings
card never shows on the profile (v29-03). Below that: the carousel animation is
visibly wrong whenever selected (v29-04), the ticker/marquee misbehave on the
Arabic locale (v29-05), effects-"off" leaves three decorations moving (v29-06)
and one setting combination misplaces the particles (v29-07). No security
issues: every injection vector was rejected in live rendering, the economy is
provably fair and atomically restored, and the v28 DB fixes hold against live
probes.

**Live-data statement:** a test `customization` document (two passes: a
hostile full-settings doc, then an auto-theme doc) was written to member
`band1to` via the service role to exercise render-time sanitization on a real
dev-server render, and **restored to `{}`** (verified by read-back:
`customization: {}`, `color column: null` — untouched). The only other live
write was the blog-reaction toggle pair, which ended net-zero (added then
removed). No production data was left modified; no secrets are printed in this
report.
