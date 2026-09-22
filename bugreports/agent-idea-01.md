# Feature ideas — agent #1 (unique / impressive)

Twelve proposals that only make sense on a live Twitch badge catalog. Each one
consumes data this project already collects (catalog image UUIDs, badge_stats
time series, drop windows, TBRI components, own-vs-displayed owner counts,
changelog, inventory snapshots, XP/coin economy) or extends an existing
mechanic. Every idea here is deliberately distinct from the 50 in
IMPROVEMENTS.md.

---

## Silhouette Showdown

- **Category**: unique
- **What**: A daily quiz game built from the real catalog art: the page renders
  a badge PNG as a pure-black silhouette (or a 12-pixel downsample) and asks the
  user to name the badge from four catalog options. Correct answers award XP and
  a streak multiplier; the pool is drawn from badges the user has *seen* in the
  catalog so the difficulty is personalized.
- **Why it fits**: The catalog already ships every badge image plus its title,
  category and rarity, so the entire game content is derived, not authored. It
  turns the catalog itself into the game board rather than adding a
  disconnected mini-game, and the streak hook feeds the existing daily-login
  loop.
- **Effort**: S
- **Risk if built badly**: Badge art is 14–28 px native, so a bad silhouette is
  either unrecognizable or trivially recognisable — the difficulty curve must be
  tuned per badge size or the game feels random.

## Badge Futures Market

- **Category**: impressive
- **What**: A prediction market where users stake BadgesCoins on claims about
  the catalog: "badge X will cross 50,000 owners within 30 days", "badge Y will
  drop out of the legendary tier this month". Positions are priced by the crowd,
  settled automatically from the `badge_stats` time series, and the market
  history for each badge is shown on its detail page.
- **Why it fits**: The 15-minute potat sync already writes owner-count time
  series per badge and recomputes rarity (TBRI) each run, so every market is
  objectively resolvable without a human oracle — the exact precondition a
  prediction market needs.
- **Effort**: L
- **Risk if built badly**: If settlement windows are generous and oracle rules
  ambiguous, a handful of users with scripted potat reads can farm near-certain
  markets and drain the coin supply.

## Badge Time Machine

- **Category**: impressive
- **What**: A global, scrubable timeline of the entire catalog: drag a slider to
  any past date and the badge grid, owner counts, rarity tiers and "claimable
  now" state re-render as they were on that day. A "then vs now" mode overlays
  two dates so you can see exactly which badges were added, expired or demoted
  in between.
- **Why it fits**: Snapshot history from the 15-minute potat run plus every
  catalog diff already recorded in the changelog is a full event log; the time
  machine is a read-only projection over data that currently only powers the
  trend chart on one page.
- **Effort**: L
- **Risk if built badly**: Point-in-time reconstruction from a sparse series
  will interpolate silently and present invented numbers as fact — every cell
  needs an explicit "as of" timestamp and a staleness marker.

## Leak Radar

- **Category**: unique
- **What**: A dedicated page that lists badges detected in the catalog feed
  *before* Twitch announces them — inserted via the badgebase sync's upcoming
  path — with a per-badge "spotted N hours before official release" counter and
  a confidence note on the source. A push topic lets people subscribe only to
  leaks, separate from the normal new-badge push.
- **Why it fits**: The badgebase sync deliberately inserts upcoming badges ahead
  of their live window by matching image UUIDs; that early-warning side effect
  is currently invisible. Surfacing it turns an implementation detail of the
  sync into a genuinely distinctive feature no badge site offers.
- **Effort**: M
- **Risk if built badly**: If "leak" is used loosely, it becomes rumor-mongering
  — one false positive published as a leak destroys the credibility of the
  whole page, so the detection threshold must be conservative and sourced.

## Fading Badges

- **Category**: unique
- **What**: A leaderboard and per-badge status built on the gap between *owned*
  and *still displayed*: a badge whose owner count is flat while its wear share
  craters is flagged "fading", a badge with both rising is "rising". Each badge
  gets a small owned-vs-worn divergence chart with a "worn by X% of owners
  today" line.
- **Why it fits**: TBRI already computes wear as 15% of the score, but the site
  only ever shows the resulting number, never the divergence itself. Making the
  two inputs visible turns an internal rarity component into a browsable
  signal — "badges people regret claiming" is a story the data already holds.
- **Effort**: S
- **Risk if built badly**: Wear share is a single-source measurement (potat), so
  an outage looks like a mass abandonment event; the page needs to mark
  low-confidence windows rather than declaring every badge "fading".

## Drop Survival Lab

- **Category**: impressive
- **What**: A statistics page that treats every claim window as a survival
  observation and renders Kaplan-Meier curves of "how long badges stay
  claimable", split by category, free-vs-paid and year. A live table shows the
  median remaining claim time for badges currently open, so collectors can see
  which windows historically close fast.
- **Why it fits**: The badgebase sync stores start and end for every drop
  window (`data-reset` dates); that is a complete survival dataset nobody has
  ever analyzed. It gives the catalog a genuine quantitative-research artifact
  instead of another grid.
- **Effort**: M
- **Risk if built badly**: Windows that are still open are right-censored data;
  treating them as completed (or dropping them) biases every curve, so the
  estimator must handle censoring correctly or the numbers are quietly wrong.

## Achievement Composer

- **Category**: unique
- **What**: A page where users write their own achievement as a predicate over
  catalog fields — "own every badge from category X released in 2024", "own 3
  badges in the legendary tier" — and the self-evaluating achievement engine
  awards it when satisfied. Composed achievements appear on the profile next to
  the 125 built-in ones and are shareable by URL.
- **Why it fits**: Achievements are already self-evaluating rather than
  hard-coded checks, so a user-authored predicate is an extension of the
  existing evaluator, and the catalog fields (category, tier, release date,
  owned) are exactly the vocabulary users want to write against.
- **Effort**: M
- **Risk if built badly**: User-expressed predicates are a query language, and a
  naive evaluator is both a DoS vector and a way to write impossible goals —
  the vocabulary must be a fixed allow-listed schema, never translated SQL.

## Collection Completion Solver

- **Category**: unique
- **What**: Given a user's inventory, the currently claimable badges and the XP
  curve, the solver computes the cheapest concrete path to the next milestone:
  which badges to claim, which games to play and in what order to reach a chosen
  target (next level, next achievement, tier completion), with the coin/XP cost
  of each route and a "no feasible path" verdict when there isn't one.
- **Why it fits**: Inventory, XP curve, achievement predicates and game rewards
  all live server-side already; nobody has joined them into a single planner.
  It converts the site's many separate progress bars into one actionable list.
- **Effort**: M
- **Risk if built badly**: Optimization over a live, changing catalog produces a
  plan that is stale before it is read — it must recompute against fresh data
  and label its assumptions, not cache a route for a day.

## Verifiable Badge Credential

- **Category**: impressive
- **What**: A user can export a signed, offline-verifiable attestation of their
  badge inventory (an Ed25519-signed payload with the badge IDs, issuance date
  and a verification URL) that any third party can check without calling the
  site. A public `/verify` page accepts pasted credentials and shows pass/fail
  with the underlying claims.
- **Why it fits**: The project already resolves true per-user badge ownership
  from badges.blog/GQL, which is the hard part; signing the resolved result adds
  the one missing primitive — a trust boundary that lets "I own this badge"
  travel outside the site.
- **Effort**: M
- **Risk if built badly**: Signing without binding the credential to a login and
  a short validity window lets a stale credential assert a collection forever —
  the payload needs issuer, subject and expiry or the signature proves nothing.

## Live Owner-Delta Stream

- **Category**: impressive
- **What**: Replace the once-a-minute `LiveRefresher` poll on badge pages with a
  server-sent-events stream that pushes owner-count deltas as they land from the
  sync, driving an animated counter and a rolling momentum sparkline. A "surge"
  badge appears live on the catalog grid for any badge whose delta crosses a
  threshold between polls.
- **Why it fits**: The `badge_momentum` view already computes the rate of
  change, and the 15-minute cadence means there is a continuous supply of deltas
  — the site currently throws that liveness away by polling the same number.
- **Effort**: M
- **Risk if built badly**: A stream that is really a 60-second poll wearing an
  SSE costume is worse than the poll, and a hypothesis-free sparkline on a
  15-minute data source implies a precision the data does not have.

## Art-Style Atlas

- **Category**: unique
- **What**: An ML pass over the badge images classifies each into an art-style
  tag (pixel art, flat vector, gradient/mesh, photo-derived, era-of-release) and
  a new browse mode lets users explore the catalog by style and see how Twitch's
  badge art direction changed year over year. Each badge card shows its tags,
  and filter URLs are shareable.
- **Why it fits**: The catalog holds every global badge image, and the images
  are the only artifact on the site never actually analyzed — this is a derived
  dataset no competitor has, and it doubles as a visual-history feature.
- **Effort**: M
- **Risk if built badly**: A noisy classifier that mistags noticeably different
  styles destroys trust in every other derived metric on the site, so low-
  confidence tags must be hidden rather than shown as fact.

## Badge DNA Barcode

- **Category**: unique
- **What**: Every badge gets a deterministic visual barcode (a small striped
  glyph) encoding a canonical hash of its rarity vector, category and release
  date. The barcode appears on the badge OG card and can be scanned from a
  phone camera or pasted into a lookup box to open that badge — and comparing
  two barcodes visually shows how close two badges are in the rarity space.
- **Why it fits**: Rarity is a fixed 4-component formula over data the site
  already owns, so a stable fingerprint is cheap to define; it gives every badge
  a physical, shareable identity and turns the OG pipeline into an interactive
  entry point.
- **Effort**: S
- **Risk if built badly**: Encoding a hash of a *mutable* rarity score means the
  barcode silently changes when a badge's owner count moves — the fingerprint
  must be over immutable identity fields or it invalidates every shared card.