# Agent idea #10 — design / UX improvements

Scope: 12 ideas, six on visual design and the design system, six on interaction
and information architecture. Every idea names the concrete page, component or
CSS token it touches, and every one of them is meant to extend the existing
token layer (`--surface`, `--line`, `--accent`, `.card`, `.chip`, `.badge-tile`,
`.data-table`, `.prose-content`, `.countdown`) rather than introduce a second
visual language. Each is checked against both themes and against Arabic RTL.

---

## Elevation and radius scale as tokens

- **Category**: visual-design
- **What**: Shadows and corner radii are currently set per component, so
  `.card`, the header dropdowns, game modals and the profile panels each pick
  their own blur/spread. Introduce three elevation steps (`--elev-1/2/3`) and two
  radii (`--radius-tile`, `--radius-panel`) in `:root`, with darker, flatter
  values under `.light`.
- **Where**: `src/app/globals.css` (`:root`, `.light`, `.card`), then the
  consumers in `src/components/stats/*` and the profile panels.
- **Outcome**: depth becomes a deliberate hierarchy — catalog tiles sit at
  `--elev-1`, an open modal at `--elev-3` — and light mode stops looking like a
  dark shadow model with the colour inverted.
- **Risk**: components that hardcode their own `box-shadow` will visibly detach
  from the scale until each is migrated; must be done in one sweep.
- **Effort**: S

## Rarity tier ramps as first-class tokens

- **Category**: visual-design
- **What**: The six TBRI tiers drive colour today, but the values are repeated
  as literals across tile borders, chips, distribution bars and the heatmap.
  Define one token per tier — `--tier-<tier>-bg`, `--tier-<tier>-line`,
  `--tier-<tier>-text` — and make every rarity surface read from them.
- **Where**: `src/app/globals.css` (new token block, both themes),
  `.badge-tile` and `.chip` variants, `src/components/stats/DonutChart` and
  `DistributionBars`.
- **Outcome**: a tier colour change is a one-line edit, the legend, tile and bar
  always agree, and the `.light` values get a proper contrast pass instead of
  inheriting saturated dark-mode hues.
- **Risk**: the tier names must match `rarity.ts` exactly; a typo yields a
  silently transparent variable, so the tokens need a fallback declaration.
- **Effort**: M

## BadgeTile progressive reveal with a token-shaped skeleton

- **Category**: visual-design
- **What**: 14–28 px badge images on a grid of hundreds flash in as each one
  loads, and the grid reflows while it happens. Give `.badge-tile` a fixed
  intrinsic box plus a low-contrast skeleton driven by `--line`, and fade the
  real image over it once decoded.
- **Where**: the `.badge-tile` class and the catalog grid component under
  `src/app/[locale]/badges/`.
- **Outcome**: the grid holds its shape from first paint, scroll position stays
  stable, and the module reads as one surface instead of a flicker.
- **Risk**: a skeleton that never clears on a failed image leaves a permanent
  grey box; needs an error state that falls back to the existing placeholder.
- **Effort**: S

## Countdown urgency states inside `.countdown`

- **Category**: visual-design
- **What**: `.countdown` renders every timer identically whether a drop closes
  in six days or forty minutes. Add three modifier states (`is-calm`,
  `is-soon`, `is-critical`) that shift the token-derived colour and weight, and
  pair the change with a static label so it never depends on colour alone.
- **Where**: `.countdown` in `src/app/globals.css`, used by the catalog and
  badge detail pages.
- **Outcome**: a page of windows becomes scannable — the closing drops read as
  closing without any new chip or badge being invented.
- **Risk**: too many `is-critical` tiles at once flattens the emphasis; the
  threshold needs to be tuned against real data before shipping.
- **Effort**: S

## Light-mode contrast pass on `--line` and muted text

- **Category**: visual-design
- **What**: `.light` currently inverts surfaces but keeps the dark-mode hairline
  and secondary-text lightness, so `.data-table` row separators and muted
  labels sit near the 3:1 boundary. Re-derive `--line` and the muted text token
  for the light theme from a contrast target rather than from the dark value.
- **Where**: the `.light` block in `src/app/globals.css`, affecting
  `.data-table`, `.card` borders and every `text-muted` consumer.
- **Outcome**: light mode becomes a supported theme rather than a tint, and the
  leaderboard tables and filter labels stop washing out.
- **Risk**: darkening `--line` globally also darkens decorative dividers,
  which may look heavier than intended in the header.
- **Effort**: M

## Locale-aware type scale with logical insets

- **Category**: visual-design
- **What**: Line-height, letter-spacing and inline padding are tuned for Latin
  copy, so Arabic and Japanese headings either clip or breathe unevenly, and a
  few components still use physical `padding-left`/`margin-right`. Introduce
  per-script leading variables and replace physical insets with
  `padding-inline`/`margin-inline` throughout the layout primitives.
- **Where**: `:root` type tokens plus the header, footer and card padding rules
  in `src/app/globals.css`; consumed by `src/app/[locale]/layout.tsx`.
- **Outcome**: all 11 locales render with a deliberate rhythm, RTL spacing
  mirrors correctly, and future locales inherit the behaviour automatically.
- **Risk**: logical-property migration can silently change LTR spacing by a few
  pixels across many components at once — worth a full-page visual diff.
- **Effort**: M

## Comfortable / compact density switch

- **Category**: interaction
- **What**: Let the user choose a density that flips a `data-density` attribute
  on `<html>`, with compact values for tile gaps, `.data-table` row height and
  `.card` padding expressed as spacing tokens rather than literals.
- **Where**: new spacing tokens in `src/app/globals.css`, the theme toggle in
  the header, and the catalog grid plus `/leaderboards` tables.
- **Outcome**: collectors scanning the full catalog get many more tiles per
  screen without a separate layout, and the preference persists like the theme.
- **Risk**: compact rows can break the tap-target minimum on mobile; the toggle
  should be disabled or clamped below the tablet breakpoint.
- **Effort**: M

## Command palette for catalog navigation

- **Category**: interaction
- **What**: A keyboard-invocable overlay that searches badges, rarity tiers and
  the main routes from one input, reusing the existing catalog query rather than
  a new index.
- **Where**: a new client component mounted in `src/app/[locale]/layout.tsx`;
  feeds from `src/lib/queries.ts`.
- **Outcome**: power users reach any badge or tier without traversing the
  filters, and the palette doubles as the keyboard entry point the header
  currently lacks.
- **Risk**: duplicates the existing search box semantics — the two entry points
  must share one query function or they will drift.
- **Effort**: L

## Roving-tabindex keyboard navigation in the badge grid

- **Category**: interaction
- **What**: The grid is hundreds of focusable tiles in document order. Make the
  grid a single tab stop with arrow-key movement between tiles, Enter to open,
  and Escape to leave, wrapping at rows in the correct visual direction under
  RTL.
- **Where**: the catalog grid component under `src/app/[locale]/badges/` and
  `.badge-tile`.
- **Outcome**: keyboard and switch-device users can traverse the catalog in
  seconds instead of tabbing through it, and RTL arrow handling is correct by
  construction.
- **Risk**: a grid whose visual order differs from DOM order under RTL will move
  focus the wrong way unless the column mapping is derived from direction.
- **Effort**: M

## Persistent filter chip rail with URL-backed state

- **Category**: information-architecture
- **What**: The catalog's active filters are scattered between the search input,
  a status control and the URL. Consolidate them into one sticky chip rail that
  shows every active filter, each removable in place, with the URL as the single
  source of truth.
- **Where**: the catalog page under `src/app/[locale]/badges/` plus `.chip`.
- **Outcome**: users see why the result set is small, can drop one filter
  without re-opening a panel, and can share an exact view as a link.
- **Risk**: deep-linking a filter combination that no longer matches any badge
  needs an explicit empty state, or the rail reads as broken.
- **Effort**: M

## `.data-table` responsive card fallback

- **Category**: information-architecture
- **What**: Give `.data-table` an agreed `data-label` contract so it collapses to
  stacked key–value cards below the tablet breakpoint instead of horizontal
  scrolling.
- **Where**: `.data-table` in `src/app/globals.css`; consumers on
  `/leaderboards`, `/stats` and the profile inventory table.
- **Outcome**: leaderboards and inventory read on a phone without sideways
  scrolling, and the same markup serves both presentations.
- **Risk**: any table that forgets `data-label` renders headerless values in
  card mode — the contract needs a lint or a documentation line in AGENTS.md.
- **Effort**: M

## Badge detail in-page anchor rail

- **Category**: information-architecture
- **What**: Badge detail pages stack description, drop window, rarity
  breakdown, owner trend and ownership in one column. Add a sticky anchor rail
  (logical-inline start, so it mirrors under RTL) that jumps between sections
  and highlights the current one, collapsing to a horizontal scroller on mobile.
- **Where**: the badge detail page under `src/app/[locale]/badges/[slug]/` and
  the rarity/ownership sections it renders.
- **Outcome**: the longest page on the site becomes navigable, deep links like
  "the rarity breakdown" become shareable, and the trend chart stops being the
  thing everyone scrolls past.
- **Risk**: a third sticky element alongside the header and countdown bar can
  consume most of a short viewport; it must be the first to yield on mobile.
- **Effort**: M