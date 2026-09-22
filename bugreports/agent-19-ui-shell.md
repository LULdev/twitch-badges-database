# agent-19 "ui-shell" — audit of header/footer/theme/gamification primitives

Scope: src/components/{Header,Footer,ThemeScript,ThemeToggle,ShareButtons,ServiceWorkerRegister,LiveRefresher,Coin,LevelBadge,AchievementBadge}.tsx,
src/app/[locale]/layout.tsx, public/sw.js, and the `.lang-*`, `.kpi`, `.bcoin`, `.rarity-*`, `.level-*`,
`.achievement-*`, `.status-pill`, `.uptime-*` blocks of src/app/globals.css.

Checked and found clean (no bug): ThemeScript's storage key `tbd_theme` and its `light`/`dark` class agree
with ThemeToggle's `STORAGE_KEY` and toggle logic (no theme flip on navigation); the theme script is inline
in `<body>` ahead of content and `<html>` carries `suppressHydrationWarning`; Header/Footer link through the
named `@/i18n/navigation` export and use logical `ms-auto` / `ps-*` / `pe-*` / `text-start` / `end-0`;
public/sw.js has no `fetch` listener, so a stale registration cannot intercept navigation (scope is `/`);
heading/landmark structure (Header `nav`, Footer `h3`+`ul`) is non-duplicated.

## ui-1: LevelBadge renders a duplicate SVG gradient id and never uses its per-level gradient
- **Severity**: medium
- **Side**: client
- **File**: src/components/LevelBadge.tsx:29-53
- **Evidence**: the `<defs>` gradient is `id={`lg-${level}`}` (line 29) but both consumers reference a
  literal, unrelated id: `<path … fill="url(#lg-shield)" …/>` (line 36) and
  `stroke="url(#lg-shield)"` (line 45), and a second `<linearGradient id="lg-shield">` is declared at
  line 50 — inside the same `<svg>` as the shield path, for every instance of the component.
- **Why it is a bug**: two defects in one. (1) The `lg-${level}` gradient is dead code — the intent was
  clearly a per-level gradient, so every level renders the same two-stop overlay. (2) `id="lg-shield"` is
  emitted once per badge, so on any page with more than one LevelBadge (leaderboards, profile showcase)
  the document contains N elements sharing one id; `getElementById`/`url(#…)` resolves to the FIRST one in
  document order, so all shields take the first badge's `--level-glow` stops, and duplicate ids are invalid
  HTML. A level-5 badge can therefore display a level-90 colour.
- **Confidence**: confirmed
- **Fix direction**: use a unique id per level (`const gid = \`lg-${level}\``), reference it from both the
  fill and the rotate stroke, and drop the literal `id="lg-shield"` gradient.

## ui-2: AchievementBadge inline styles defeat the `.achievement-*` CSS (special tier animation is dead)
- **Severity**: medium
- **Side**: client
- **File**: src/components/AchievementBadge.tsx:26-32 vs src/app/globals.css:786-800
- **Evidence**: the component sets `style={{ …, boxShadow: \`0 0 10px ${style.ring}55, inset 0 0 8px ${style.ring}22\`, background: \`radial-gradient(circle at 30% 25%, ${style.ring}33, transparent 70%)\` }}`, while
  `.achievement-badge { animation: achievement-pulse … }` animates `box-shadow`
  (globals.css:797-800) and `.achievement-special { background: radial-gradient(…), conic-gradient(from var(--rarity-angle, 0deg), #f8717155, …); animation: achievement-pulse …, rarity-spin 4s linear infinite }`
  (globals.css:790-795).
- **Why it is a bug**: declarations in an inline `style` attribute outrank author rules, so the
  `.achievement-special` `background` (the rainbow conic ring plus its `rarity-spin` hue rotation) is never
  painted — `role="img"` special/crown achievements render as the plain per-category radial gradient. In the
  other direction the running `achievement-pulse` keyframe owns `box-shadow` for its 2.6s life, so the
  inline `style.ring` glow is also not what the user sees; the category colour only survives on
  `borderColor`. `special` and `common`/`creative` therefore end up visually identical apart from the ring.
- **Confidence**: confirmed
- **Fix direction**: move the per-category colour to a CSS custom property (`--ach-color`) set inline and
  build both `background` and `box-shadow` from it inside the classes, so no inline declaration competes with
  the animation.

## ui-3: Desktop nav has no room between `lg` and ~1375 px while the hamburger is already hidden
- **Severity**: high
- **Side**: client
- **File**: src/components/Header.tsx:69-83, 166-180
- **Evidence**: 13 links are rendered in the desktop nav (`hidden items-center gap-0.5 lg:flex`, line 69)
  with `px-2.5 py-1.5 text-[0.8125rem]`, and the single mobile toggle is
  `className="btn btn-ghost px-2.5 py-2 lg:hidden"` (line 168). The row is
  `flex h-14 max-w-7xl items-center gap-4 px-4` with no `flex-wrap` and no `min-w-0`/`overflow` guard.
- **Why it is a bug**: the longest word per link cannot wrap, so the nav's min-content width is roughly
  950 px ("Leaderboards", "Achievements", "Changelog", … plus 20 px padding each). At `lg` (1024 px) only
  ~600 px remain after the logo (~146 px), the ms-auto cluster (flag chip 2.35rem + theme toggle +
  login/account, ~200 px) and the 3×`gap-4`. The flex row therefore overflows the viewport horizontally
  while the hamburger is hidden, pushing the language switcher / theme toggle / account button off-screen
  with no fallback control, on a very common 1280 px laptop. (At 360 px the mobile path is fine: nav is
  `hidden`, the label spans collapse, total ≈230 px.)
- **Confidence**: likely (derived from class widths; not measured in a browser)
- **Fix direction**: either raise the desktop-nav breakpoint to `xl` (keeping the hamburger until it fits),
  or add `min-w-0 overflow-x-auto` + `shrink-0` on the right-hand cluster and let the nav scroll.

## ui-4: Account menu and language panel can both be open, and neither the account menu nor Escape can close it
- **Severity**: medium
- **Side**: client
- **File**: src/components/Header.tsx:89-156, 115-119
- **Evidence**: the account dropdown is `role="menu"` with plain `<a>`/`<button>` children (lines 116-154)
  and `aria-haspopup="menu"` + `aria-expanded={userMenuOpen}` on the trigger (lines 94-95), but the only
  close paths are `setUserMenuOpen(false)` inside the menu's own links and `logout()`; there is no
  `useEffect`, no `pointerdown`/`keydown` listener, i.e. no outside-click and no Escape handling. Compare
  LanguageSwitcher.tsx:95-112, which registers both `pointerdown` (outside root → close) and `Escape`
  (close + `triggerRef.current?.focus()`).
- **Why it is a bug**: (1) opening the language panel while the account menu is open does not dismiss the
  menu — the pointerdown listener only belongs to the language root — so two absolutely positioned popovers
  are live at once (user menu `absolute end-0 top-11 z-50`, lang panel `z-60`) and overlap; Escape then
  closes only the language panel and the account menu stays pinned over the page content. (2) Even alone the
  account menu can only be dismissed by clicking its own trigger; clicking anywhere else on the page or
  tabbing away leaves the menu, its links and the "logout" button rendered over content. (3) `role="menu"`
  with no `role="menuitem"` children is invalid ARIA — assistive tech announces an empty menu, and the
  ArrowUp/ArrowDown/Home/End behaviour both roles imply is absent.
- **Confidence**: confirmed
- **Fix direction**: give the account menu the same outside-pointerdown + Escape (with focus return) effect
  as LanguageSwitcher, close it when the language panel opens (and vice versa), and either add
  `role="menuitem"` to the children with arrow-key handling or drop `role="menu"`/`aria-haspopup="menu"` in
  favour of a plain list.

## ui-5: ShareButtons computes its URL from `window` during render → server/client hydration mismatch
- **Severity**: medium
- **Side**: client
- **File**: src/components/ShareButtons.tsx:29-32, 43-50
- **Evidence**: `const shareUrl = typeof window === "undefined" ? "" : new URL(path, window.location.origin).toString();`
  is evaluated in the render body and interpolated into `href={\`https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(shareUrl)}\`}`.
- **Why it is a bug**: this is a client component that is server-rendered first, so the SSR HTML contains
  `url=` (empty) while the hydration render already has `window` and produces the full absolute URL. React 19
  reports a hydration mismatch on that attribute and re-renders the subtree on the client, discarding the
  server markup (and logging an error) on every page that embeds ShareButtons — badge detail, blog, profile.
  The empty-URL fallback is also shipped to any non-JS consumer.
- **Confidence**: confirmed
- **Fix direction**: move the URL computation into state set from a `useEffect` (or build the href on click /
  use `usePathname` + a `NEXT_PUBLIC_SITE_URL` constant) so SSR and hydration render identical markup.

## ui-6: Light mode: hard-coded rank colours have no `.light` override and become unreadable
- **Severity**: low
- **Side**: client
- **File**: src/app/globals.css:1365-1367
- **Evidence**: `.rank-row:nth-child(1) .rank-index { color: #fbbf24; }`, `.rank-row:nth-child(2) … { color: #cbd5e1; }`,
  `.rank-row:nth-child(3) … { color: #d97706; }` — literals, not tokens; the `.light` block
  (globals.css:44-72) defines `--warning`/`--muted`/`--foreground` but nothing here consumes them.
- **Why it is a bug**: on the light surface `--surface: #ffffff` the silver `#cbd5e1` has a contrast ratio of
  roughly 1.35:1 and the gold `#fbbf24` about 1.7:1, so the rank number for places 2 and 1 is effectively
  invisible in light mode (the row is the only place the position is shown).
- **Confidence**: confirmed (colour values); contrast figures derived from the fixed hex values
- **Fix direction**: use theme tokens (`var(--warning)`, `var(--muted)`, `var(--foreground)`) or add
  `.light .rank-row:nth-child(n) .rank-index` overrides with darker gold/silver.

## ui-7: Physical `left`/`right` and `translateX` in chart primitives animate from the wrong edge in RTL
- **Severity**: low
- **Side**: client
- **File**: src/app/globals.css:1178-1186, 1353-1355
- **Evidence**: `.grow-bar-fill { transform-origin: left center; transform: scaleX(0); animation: grow-bar-in … }`
  with `@keyframes grow-bar-in { to { transform: scaleX(1); } }`, and
  `@keyframes rank-in { from { opacity: 0; transform: translateX(-8px); } }`; neither uses a logical
  equivalent (`transform-origin` has no logical form, so the direction must come from a
  `[dir="rtl"]` override).
- **Why it is a bug**: `dir="rtl"` is applied for Arabic (layout.tsx:90), but the distribution bars still
  expand from the physical left and rows slide in from the physical left, i.e. from the inline-end side —
  the intro animation reads mirrored against the text direction.
- **Confidence**: confirmed (no RTL-aware rule exists anywhere in the file)
- **Fix direction**: add `[dir="rtl"] .grow-bar-fill { transform-origin: right center; }` and
  `[dir="rtl"] @keyframes`/a mirrored rank-in (or drop the translate from the keyframe).

## ui-8: Light mode: white sparkles (`background: #fff`) disappear on light surfaces
- **Severity**: low
- **Side**: client
- **File**: src/app/globals.css:546 (.rarity-sparkle), 758 (.level-sparkle), 906 (.bcoin-sparkle)
- **Evidence**: all three shapes are `background: #fff` (or `background: #fff` with
  `filter: drop-shadow(0 0 3px var(--tier-color))` / `drop-shadow(0 0 3px currentColor)`), and no `.light`
  rule re-colours them.
- **Why it is a bug**: the sparkles are drawn as solid white stars over `.card`/`.achievement-hero`, which in
  light mode are `#ffffff`; the twinkle animation then fades between an invisible white-on-white star and a
  faint coloured shadow, so the "premium" sparkle effect on level/achievement/coin badges reads as noise
  rather than a highlight.
- **Confidence**: likely (only the 3 px drop-shadow remains visible; not visually verified in a browser)
- **Fix direction**: give the sparkle a themed fill, e.g. `background: var(--accent)` /
  `color-mix(in srgb, var(--warning) 80%, #000)` and add a `.light` override, keeping the drop-shadow as the
  outer glow.

## ui-9: Header landmark labels bypass i18n
- **Severity**: low
- **Side**: client
- **File**: src/components/Header.tsx:69, 188
- **Evidence**: `<nav className="hidden items-center gap-0.5 lg:flex" aria-label="Main">` and
  `<nav … aria-label="Mobile">` are literal English strings; every neighbouring string goes through
  `t(…)` from `useTranslations("nav")`.
- **Why it is a bug**: AGENTS.md requires all UI strings (including accessible names) to come from
  `messages/<locale>.json`; on the other 10 locales, screen-reader users get an English-only landmark name in
  the middle of translated navigation, and the string cannot be corrected without a code change.
- **Confidence**: confirmed
- **Fix direction**: add `nav.mainLabel` / `nav.mobileLabel` keys to all 11 message files and use `t(...)`.