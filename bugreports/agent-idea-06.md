# Idea agent #6 — turning synced data into insight

Twelve feature ideas that convert the already-synced data (catalog, drop/claim
windows, owner-count time series, TBRI rarity with six signals, per-user
inventory, changelog, /stats) into analysis, visualisation, forecasting and
comparison for collectors. None needs a new data source.

## Claim-Window Scarcity Forecaster
- **Category**: insight
- **What**: For every currently-open claim window, extrapolate the owner-count
  curve to its `end_date` and publish a forecasted final owner count plus the
  TBRI tier that implies. The badge page then says "on this pace it lands
  around 41k owners — Rare, not Legendary", giving collectors a reason to
  decide now rather than after the window closes.
- **Inputs used**: drop windows (start/end, free/paid), per-badge owner-count
  time series, TBRI scarcity signal.
- **Effort**: M
- **Risk if built badly**: a naive linear fit over a non-linear claim curve
  produces confidently wrong "final rarity" numbers.

## Rarity Stability Index
- **Category**: insight
- **What**: Derive a volatility score per badge from the variance of its TBRI
  over the synced time series, and sort the catalog into "stable", "drifting"
  and "turbulent" rarity bands. Collectors use it to tell a permanently rare
  badge from one whose score is still collapsing as newcomers claim it.
- **Inputs used**: owner-count time series, `badge_momentum` view, TBRI history.
- **Effort**: M
- **Risk if built badly**: short histories make young badges look turbulent by
  default; the index needs a minimum-history guard.

## Collection Scarcity Curve vs Catalog Baseline
- **Category**: visualisation
- **What**: Plot a logged-in user's inventory as a percentile curve of owner
  counts (rarest → most common) and overlay the same curve for the whole
  catalog. The gap between the two lines shows instantly whether a collection
  is rarity-heavy or mainstream without reading a single badge page.
- **Inputs used**: per-user inventory, per-badge owner counts, TBRI.
- **Effort**: M
- **Risk if built badly**: a reshuffled curve invites over-reading; needs the
  catalog baseline drawn alongside so the comparison is honest.

## Badge Cohort Age Pyramid
- **Category**: visualisation
- **What**: A horizontal cohort chart bucketing the whole catalog by release
  age against rarity band, so collectors see at a glance whether the rare
  badges are the ancient ones or the recent limited drops. Each cohort row is
  clickable through to the filtered catalog.
- **Inputs used**: catalog release dates, TBRI rarity tiers.
- **Effort**: S
- **Risk if built badly**: mixing "release date" sources (catalog vs window)
  shifts cohorts and misleads.

## Display-Wear Retention Ranking
- **Category**: insight
- **What**: Rank badges by the share of owners who still display them (the wear
  signal) as a standalone "collection shelf" leaderboard — the badges people
  claim and quietly retire versus the ones that stay on. A one-line summary
  per badge explains whether its wear is high or low for its age.
- **Inputs used**: owner stats wear signal, catalog age, owner counts.
- **Effort**: S
- **Risk if built badly**: wear is sampled at sync time, not lifetime; framing
  it as "abandonment" overstates what the number measures.

## Category Rarity Benchmarks
- **Category**: insight
- **What**: Publish per-category median owner count and median TBRI, then show
  every badge's deviation from its own category median ("this Sub badge is
  rarer than 82% of Sub badges"). Lets collectors judge a badge fairly instead
  of comparing it to an unrelated category.
- **Inputs used**: catalog category/metadata, owner counts, TBRI.
- **Effort**: S
- **Risk if built badly**: small categories give noisy medians that imply
  precision the data does not have.

## Time-to-Plateau Clock
- **Category**: insight
- **What**: For badges with observed windows, measure the lag between the claim
  window opening and the owner count flattening, and publish the distribution
  plus a live "days until this badge plateaus" estimate. Directly answers the
  collector question "if I wait, will I miss it?".
- **Inputs used**: drop windows, owner-count time series, status/expiry rows.
- **Effort**: M
- **Risk if built badly**: a plateau detected from a lull rather than the true
  ceiling would tell collectors the window is safely closed when it is not.

## Obtainability × Scarcity Quadrant Map
- **Category**: visualisation
- **What**: Scatter every badge on two axes — how hard it was to obtain
  (window brevity and free/paid) against how few owners it currently has — and
  label the quadrants. The "hard to get yet thinly owned" quadrant is the
  collector's target list, and it is derived purely from existing signals.
- **Inputs used**: drop windows, owner counts, TBRI obtainability and scarcity
  inputs.
- **Effort**: M
- **Risk if built badly**: two composite axes collapsed into "good/bad" labels
  turn a descriptive map into prescriptive advice.

## Window Collision Calendar
- **Category**: visualisation
- **What**: A month-view calendar that overlays every active and upcoming claim
  window, highlighting days when multiple windows overlap so collectors can
  see claim-fatigue crunches in advance. Month summaries count concurrent
  windows and total badges expiring.
- **Inputs used**: drop windows (start/end, free/paid), expiry status rows.
- **Effort**: S
- **Risk if built badly**: windows without a reliable end date render as
  zero-length events and distort the crunch count.

## Expiry Rarity Impact Forecast
- **Category**: insight
- **What**: When a window closes, recompute the badge's TBRI at its projected
  final owner count and show the before/after score with a plain-language
  "moves from Uncommon to Rare" note. Turns the abstract rarity formula into a
  per-badge prediction a collector can act on.
- **Inputs used**: TBRI six-signal formula, owner counts, drop windows.
- **Effort**: M
- **Risk if built badly**: publishing a predicted tier as if it were the actual
  tier misleads anyone who screenshots it and skips the label.

## Weekly Rarity Migration Matrix
- **Category**: visualisation
- **What**: A week-over-week Sankey/heatmap of how many badges moved between
  rarity tiers, built from the stored time series rather than a live diff. It
  answers "is the catalog getting rarer or easier this month?" at a glance.
- **Inputs used**: owner-count time series, TBRI recomputation, changelog rows.
- **Effort**: M
- **Risk if built badly**: recomputing TBRI for stale snapshots drifts from the
  stored score and creates phantom tier moves.

## Collector Similarity Network
- **Category**: visualisation
- **What**: Cluster collectors by Jaccard overlap of their synced inventories
  and render a force-directed network, exposing collecting tribes and outlier
  profiles that share almost no badges with anyone. A natural discovery surface
  for like-minded collectors, using only inventories already synced.
- **Inputs used**: per-user inventories for all synced profiles, catalog rows.
- **Effort**: L
- **Risk if built badly**: inventory sync coverage varies per user, so popular
  collectors look dissimilar simply because their profile synced less.