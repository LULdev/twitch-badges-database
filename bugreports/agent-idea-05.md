# Idea agent #5 — Gamification & Economy

Scope: new BadgesCoins sinks and sources that stay balanced, new XP paths that
reward genuinely badge-related behaviour, and mechanics that stay fair. Every
idea assumes the outcome is decided server-side — a client-reported score,
balance, inventory or achievement is never trusted.

Context read: `README.md`, `AGENTS.md`, `IMPROVEMENTS.md` only. None of the 74
ideas already listed in `IMPROVEMENTS.md` (including the 24 in
`bugreports/agent-idea-01.md` / `-02.md`) is repeated below.

Baseline assumed: coins/XP/level live in `user_progress`; badge ownership is
authoritative only in the server-synced inventory (perfil/GQL → DB); the
catalog, `badge_stats` snapshots and `badge_momentum` are server-written; all
economy mutations must be atomic single-row DB transactions with a changelog
row and a `withHeartbeat()`-wrapped job where applicable.

---

## Collateral Pawnshop (badge-backed loans)
- **Category**: economy
- **What**: A user can post a badge they verifiably own as collateral and
  borrow BadgesCoins against it at a server-computed loan-to-value ratio
  (rarity-weighted). Interest accrues per day; if the loan is not repaid the
  badge's collateral is liquidated (a fixed penalty plus loss of its showcase
  slot) and the coins return to the house sink.
- **Balance**: Interest and liquidation penalties are pure sinks; the loan
  principal is not new money (it is minted against an asset, then burned on
  repayment with interest), so a round trip is always net-negative. LTV is
  capped below 50% of a conservative rarity valuation, so a user cannot borrow
  more than the collateral is worth even if rarity drops.
- **Exploit-proofing**: The collateral is only the *server's* inventory row for
  that badge, never a client claim — a forged "I own this" never reaches the
  loan table. Borrow/repay/liquidate are one row-locked transaction each
  (`SELECT … FOR UPDATE`), so double-borrow against the same badge or
  repay-and-reborrow races fail. LTV and interest come from server constants,
  not request parameters.
- **Effort**: L

## Rarity Tithe (TBRI-scaled claim XP)
- **Category**: progression
- **What**: The XP granted when a badge first enters a user's verified
  inventory is scaled by that badge's TBRI score *at claim time* instead of the
  current flat +1,000. A legendary claim is worth meaningfully more than a
  common one, with diminishing returns for near-duplicate badges in the same
  set.
- **Balance**: XP-only, so it creates no coins and cannot be cashed out. The
  tithe is computed once, from the rarity snapshot the sync already stores, and
  the per-badge grant is one-time — the curve is calibrated so the *median*
  collector earns the same as today and only genuinely rare claims exceed it.
- **Exploit-proofing**: A client cannot report a claim; the award fires from the
  server-side inventory diff in the sync job, so only rows the site itself
  synced can pay. Rarity is read from the server snapshot, not supplied by the
  request, so a client cannot self-declare a badge "legendary". A per-day XP
  cap plus the existing one-time-per-badge guard blunts any replay.
- **Effort**: M

## Curator Level (coverage progression track)
- **Category**: progression
- **What**: A second, parallel level track earned only from catalog *coverage* —
  unique verified badges, weighted by category breadth and rarity — displayed
  next to the XP level on profiles. It cannot be bought, boosted or accelerated
  with coins.
- **Balance**: No coins are minted; the track is a derived view over the
  inventory table, so it adds prestige without inflation. Because it rewards
  breadth across categories rather than raw count, whales cannot saturate it by
  claiming one easy set.
- **Exploit-proofing**: The level is a Postgres view/function over
  server-synced inventory rows, so there is no client-writable field to patch
  and no score to submit. Coverage uses the server's category/set assignments,
  so a client cannot reclassify its own badges to game the breadth term.
- **Effort**: M

## Data-Quality Bounty Board
- **Category**: economy
- **What**: Users can flag catalog defects (missing image, wrong end date,
  mis-categorised badge, stale status) for a coin reward that is paid only
  after a server job re-validates the fix against the authoritative sources
  (Helix / IVR, badgebase, potat).
- **Balance**: Bounties are a coin *source* but gated by verification and
  capped per badge-field and per day, so the minted total is bounded by real
  defects. Reward size is fixed per defect class server-side, so it cannot be
  bid up.
- **Exploit-proofing**: Payout is not triggered by the report — it fires only
  when the sync confirms the field actually changed and the correction matches
  the source. One payout per badge+field ever (unique key), plus a per-user
  daily ceiling, defeats farm-by-spam. Reports are rate-limited per IP hash as
  well as per user, matching the audit's existing recommendation for public
  write endpoints.
- **Effort**: M

## Daily Drop Trials
- **Category**: progression
- **What**: The server issues each user a small set of daily, badge-anchored
  objectives ("claim a badge from a set released in the last 30 days", "claim a
  badge in a category you have never collected") that pay XP and a modest coin
  sum when the next inventory sync confirms them.
- **Balance**: Rewards are capped per day and the objective pool is drawn
  server-side, so the maximum daily mint is fixed and comparable to the login
  bonus. Coins are deliberately a minority of the reward (XP-heavy) to avoid a
  new inflation channel.
- **Exploit-proofing**: Completion is evaluated from the server's inventory
  diff, never from a client "done" call; the client only *reads* the day's
  trials. Objectives are seeded by the server per user per day (no re-rolling
  for a cheaper objective), and each trial is marked consumed in the same
  transaction that pays it.
- **Effort**: M

## Leaderboard Banner Rental
- **Category**: economy
- **What**: A user can rent a highlighted banner slot above a leaderboard for a
  fixed window (e.g. 7 days). Price is set by a server-side demand curve that
  rises with current occupancy and resets after each window.
- **Balance**: This is a clean, status-only sink: no coins return to the renter
  and no gameplay advantage is granted. The demand curve keeps it from becoming
  a cheap permanent fixture for the top spender and gives a predictable coin
  drain proportional to how many people want the slot.
- **Exploit-proofing**: The purchase is one atomic transaction that debits the
  balance and writes the slot with a unique per-window constraint, so
  double-spend and over-booking fail. Price and duration come from the server
  table at purchase time; the request supplies only the slot id. Expiry is a
  server job, not a client timer.
- **Effort**: S

## Coin Forge (deflationary burn → community multiplier)
- **Category**: economy
- **What**: Users can burn coins into a visible global "Forge" meter. When the
  meter fills, everyone gets a short, modest XP multiplier window; the meter
  then resets. Burning also grants a purely cosmetic forge stamp on the
  profile.
- **Balance**: Burned coins are destroyed, so the mechanic is a net sink; the
  payout is XP (never coins) and is time-boxed and small, so the global effect
  cannot out-inflate what was burned. Because the multiplier is shared, a
  single whale burning alone mostly benefits everyone else — no private +EV.
- **Exploit-proofing**: The burn is a single DB transaction (debit + increment
  meter) and the meter's fill is evaluated server-side, so a client cannot
  claim the meter is full or forge a burn. The multiplier is applied inside the
  server XP-award path from a server-stored window timestamp, so a client
  cannot grant itself boosted XP by replaying a request.
- **Effort**: M

## Heist Insurance Pool
- **Category**: economy
- **What**: Victims of coin heists can buy a daily premium; successful thefts
  are then partly reimbursed from a pool funded by those premiums. Pricing is
  actuarial (server-computed from the user's recent heist exposure).
- **Balance**: Payouts come only from premiums already collected, so the pool
  is zero-sum and cannot mint coins; the premium always exceeds expected payout
  (the house keeps a small sink cut), so insurance is never +EV. It also
  blunts the "drain the top collectors" problem the audit flagged.
- **Exploit-proofing**: Claims settle against the server's own heist ledger —
  a user cannot fabricate a theft. Collusion farming (an alt heisting you to
  trigger insurance) is bounded because reimbursement is capped below the
  premium per period and requires independent, server-recorded attacks;
  payouts go to the pool's own ledger, not to any client-supplied destination.
- **Effort**: M

## Collector Trust Score
- **Category**: progression
- **What**: A server-computed trust score from account age, verified Twitch
  login, sync-confirmed claims, and absence of anomaly flags. It gates high-risk
  actions (larger wagers, faster heists) and grants small fee rebates on sinks
  such as the pawnshop and banner rental.
- **Balance**: Rebates are discounts on sinks, not new coins, so trust cannot be
  converted into net income; higher limits let established users play more, but
  every action they unlock still has house edge.
- **Exploit-proofing**: The score is derived entirely from server data (auth
  records, inventory sync rows, the anomaly detector) with no client-writable
  input, so it cannot be inflated by a request. It only ever *loosens* limits
  and *reduces* fees, so a compromised score yields no payout path; the anomaly
  detector can zero it on suspicious flows.
- **Effort**: M

## Snapshot Achievements (first-mover / extinct ownership)
- **Category**: achievement
- **What**: Achievements that can only be earned from *historical* server
  snapshots — e.g. claiming a badge within minutes of its first catalog
  sighting, or holding a badge that later went extinct, or owning a badge before
  its rarity promotion.
- **Balance**: Achievements pay XP only, so there is no coin mint. They reward
  the site's core behaviour (being present for drops, keeping a real
  collection) rather than grinding, and each is one-time.
- **Exploit-proofing**: The predicate is evaluated against immutable
  `badge_stats` / `badge_events` history and the server inventory timeline, so
  it cannot be back-filled: a client arriving late cannot fabricate an earlier
  claim. There is no client-side submission path at all — evaluation runs in the
  sync job and writes the achievement row itself.
- **Effort**: M

## Set-Completion Rewards
- **Category**: achievement
- **What**: When a user's verified inventory covers every badge in a catalog
  set (`set_id`), the server grants a one-time XP and coin bonus plus a
  set-specific profile emblem, with the bonus scaling by the set's rarity.
- **Balance**: Sets are fixed and finite, so total mintable coins are bounded by
  the catalog itself; rewards are one-time per set per user. Rarity scaling is
  read from the server so a rare set pays more than an easy one without letting
  anyone mint repeatedly.
- **Exploit-proofing**: Set membership comes from the server catalog and
  completion from server-synced inventory, so a client cannot declare a set
  complete. A unique constraint on (user, set_id) makes the payout idempotent,
  and the grant happens inside the same transaction that detects completion.
- **Effort**: S

## Badge Oracles (XP-only prediction)
- **Category**: progression
- **What**: Before a drop window closes, users can predict whether the badge
  will still be claimable on a given date. Predictions are locked before the
  deadline and settled by the server from the authoritative `end_date`; correct
  calls pay XP (never coins), weighted by how early the call was made.
- **Balance**: XP-only keeps it out of the money economy entirely, so it cannot
  be arbitraged for coins; early-call weighting rewards genuine catalog
  knowledge rather than luck, and a per-day XP ceiling caps the total.
- **Exploit-proofing**: Settlement reads the server's synced window data — a
  client cannot report an outcome. Predictions are write-once and timestamped
  server-side before the deadline (no late edits), and the same badge cannot be
  predicted twice per user, so a client cannot hedge both sides.
- **Effort**: M
