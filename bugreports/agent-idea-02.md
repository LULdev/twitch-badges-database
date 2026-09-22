# Idea agent #2 — 12 unexpected & cool feature ideas

Twelve proposals built strictly on what this project already collects: the global
badge catalog, `badge_stats` owner time series, TBRI rarity, drop/claim windows
from badgebase, categories, the inventory snapshots, and the XP/BadgesCoins
economy. None duplicate the fifty ideas in `IMPROVEMENTS.md`; where one is
adjacent, the difference is called out.

---

## Badge Half-Life

- **Category**: unexpected
- **What**: For every badge, plot the owner curve from the first sighting and
  measure how long it took to reach half of its lifetime owners — a decay
  constant. Badge pages show it as "half-life: 4 days" with a small sparkline,
  and the catalog gets a sortable "fastest burn / slowest burn" list.
- **Why it fits**: `badge_stats` already stores a per-badge owner time series
  every 15 minutes, so half-life is arithmetic on data we already have. It turns
  a static owner count into a statement about how a badge was actually farmed —
  a genuinely new axis nobody publishes.
- **Effort**: M
- **Risk if built badly**: badges with short histories or noisy potat samples
  produce nonsense half-lives, so the fit needs a minimum-sample and
  goodness-of-fit gate before anything is displayed.

## TBRI-100 — a market index for the rarest badges

- **Category**: cool
- **What**: A single charted index: the mean TBRI of the 100 rarest badges,
  rebased to 100 at launch, updated with each potat sync. A badge page states
  whether that badge is "outperforming the index" and a `/index` page shows the
  line with the biggest movers of the day.
- **Why it fits**: rarity inputs and their history already land in `badge_stats`;
  the index is one aggregate query and one Recharts chart. Collectors get the
  language of a market ("my collection beat the index this month") without any
  real-money implication.
- **Effort**: M
- **Risk if built badly**: a moving index invites day-trading impulses; it must
  read as a curiosity, not as a score to defend, and never gate any reward.

## Rarity Promotion & Demotion Ticker

- **Category**: cool
- **What**: A live feed of tier crossings — "Badge X just fell from Legendary to
  Epic as 12,000 players claimed it." Each entry links to the badge with a
  before/after TBRI breakdown explaining which input moved.
- **Why it fits**: `computeRarity` runs on every sync and the changelog
  infrastructure already exists; a tier change is a diff on a value we recompute
  every 15 minutes. It makes an invisible background process visible and
  dramatic.
- **Effort**: S
- **Risk if built badly**: threshold jitter can emit the same badge flapping
  between two tiers several times a day; it needs hysteresis or a per-badge
  cooldown before writing a ticker row.

## Silhouette — the daily badge guessing game

- **Category**: cool
- **What**: One badge per day is shown as a black silhouette (and a second
  difficulty: heavily blurred) and the player types or picks the set name; a
  correct first guess pays XP scaled by the badge's TBRI. Streaks and a
  wordle-style shareable emoji-free result grid.
- **Why it fits**: the catalog is the answer key, and rarity is the natural
  difficulty dial — obscure badges become hard puzzles for free. It slots into
  the existing 13-game, achievement and XP machinery instead of inventing a new
  economy.
- **Effort**: M
- **Risk if built badly**: silhouettes of badges with dark artwork are
  unreadable on dark theme; the image treatment needs a per-badge contrast check
  and a "skip" that does not break the streak unfairly.

## Collector Percentile Card

- **Category**: cool
- **What**: From the leaderboard and owner data, a profile header line: "412 of
  1,203 badges — top 6% of tracked collectors," plus a nudge ("4 badges from the
  next percentile, cheapest gap: these three"). Shareable as an OG card.
- **Why it fits**: worldwide leaderboards and per-badge owner counts already
  exist; a percentile is a rank-and-count query, and the "cheapest gap" is a
  join between the catalog and the user's missing set. It gives the same data a
  second, more personal reading.
- **Effort**: S
- **Risk if built badly**: percentiles computed over a small or skewed set of
  tracked profiles mislead users; the copy must state the population, or the
  card becomes a false claim.

## Collection Fingerprint

- **Category**: cool
- **What**: Hash a user's owned-badge set (sorted UUIDs + tier mix) into a
  deterministic identicon-style pattern rendered in the profile accent colour,
  with a "clone distance" readout: "you share 78% of your collection with
  @someone."
- **Why it fits**: the owned set is already fetched and cached for the profile;
  rendering a fingerprint is pure client work with no new storage. It makes
  collections comparable at a glance and gives profiles a visual identity.
- **Effort**: S
- **Risk if built badly**: "clone" framing can read as an accusation; the
  overlap feature should be phrased as affinity, and the fingerprint must not
  expose a badge-by-badge diff of a private profile.

## Timezone Drop Lottery

- **Category**: unexpected
- **What**: Convert every drop and claim window to the visitor's local time and
  show a personal "windows you slept through" count, plus the badges you own
  that were only claimable between 02:00 and 06:00 your time.
- **Why it fits**: badgebase windows carry absolute start/end timestamps;
  intersecting them with a visitor's timezone offset is a subtraction. It turns
  global-window fairness into something a collector can finally see and joke
  about, and it explains their own gaps.
- **Effort**: S
- **Risk if built badly**: timezone handling is the classic source of off-by-one
  claims ("you missed it") — windows must render in the user's zone with the
  zone named, never in server time.

## Deadline Density Calendar

- **Category**: cool
- **What**: A month grid where each day is shaded by how many claim windows
  close that day and how rare those badges are, with a click to expand the list.
  A header blurb: "this week closes 7 windows, 2 of them Legendary."
- **Why it fits**: claim-window end dates from badgebase plus TBRI give a
  per-day urgency score with no new collection. It is a planning surface the
  site lacks — the catalog answers "what is live," not "what is about to end."
- **Effort**: S
- **Risk if built badly**: if it sells urgency without accuracy, one wrong end
  date destroys trust in every countdown; it must degrade to "date unknown"
  rather than guess.

## Orphan Badge Watch

- **Category**: unexpected
- **What**: A small rotating exhibit of badges at the bottom of the owner
  distribution — zero, one or two recorded owners — each with its story and a
  "submit what you know" nudge. Basically an adoption page for the catalog's
  loneliest entries.
- **Why it fits**: potat owner counts and the TBRI owner-scarcity input already
  identify the tail; the page is a filtered list plus editorial copy. It
  surfaces the most interesting rows in the database, which today are buried at
  the end of a sort.
- **Effort**: S
- **Risk if built badly**: zero-owner badges are often badges whose counts are
  missing, not genuinely unowned; the page must distinguish "unclaimed" from
  "uncounted" or it publishes a lie.

## Co-Ownership Recommendations

- **Category**: unexpected
- **What**: "Collectors who own this badge also own…" — a similarity graph built
  from the owner lists potat returns, rendered on badge pages and on a user's
  profile as three suggested next targets with a reason line.
- **Why it fits**: `?owners=true` responses are already the raw material for a
  co-occurrence matrix; the project currently uses them for counts only. It
  converts an existing sync payload into the site's first recommendation engine
  with no new data source.
- **Effort**: M
- **Risk if built badly**: co-occurrence driven by a small, overlapping set of
  power users collapses every recommendation to the same five badges;
  popularity must be discounted or the feature looks broken.

## Badge Bingo

- **Category**: cool
- **What**: A monthly 5×5 card of achievable catalog objectives — "claim a badge
  from a category you own none of," "find a badge under 500 owners," "be online
  when a window closes" — verified server-side from the inventory diff, with XP
  for each line and a full-card reward.
- **Why it fits**: categories, owner counts and the inventory snapshot diff
  already exist, and it reuses the achievement evaluation pattern instead of a
  new rules engine. It pushes collectors toward neglected corners of the catalog
  rather than toward the same popular badges.
- **Effort**: M
- **Risk if built badly**: if objectives are not verified against real events,
  the card becomes either trivially farmable or impossible; every square needs a
  server-checkable predicate and a stated deadline.

## Collector Net Worth

- **Category**: cool
- **What**: A single number on the profile derived from rarity and drop type —
  each owned badge contributes a TBRI-weighted value into a "collection worth,"
  with a public net-worth board alongside the existing XP leaderboard and a
  breakdown showing which badges drive it.
- **Why it fits**: TBRI, owner counts and the owned set are all in place; this is
  a weighted sum, not a new mechanic. It gives rarity a consequence beyond a
  tier label and creates an intrinsic reason to chase scarce badges.
- **Effort**: M
- **Risk if built badly**: it must never convert to BadgesCoins or any spendable
  asset, or rarity becomes an economy exploit; it stays a read-only stat with a
  published formula.