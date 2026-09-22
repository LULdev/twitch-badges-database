# Improvements & feature ideas

Collected 2026-09-22 as phase 3 of the audit request. The ten planned idea
sub-agents were first worked first-party while the platform was refusing agent
launches; later in the same session the quota recovered and **all ten did run as
real read-only sub-agents** (`bugreports/agent-idea-01..10.md`), adding 121
ideas on top. Every idea says what it is and why it earns a place on a Twitch
badge site; nothing here is implemented yet.

| Report | Lens | Ideas |
|---|---|---|
| `agent-idea-01.md` … `agent-idea-04.md` | product, catalog, gamification, community | 49 |
| `agent-idea-05.md` | gamification & economy | 12 |
| `agent-idea-06.md` | data & insights | 12 |
| `agent-idea-07.md` | accessibility & performance | 12 |
| `agent-idea-08.md` | growth, retention, content, community | 12 |
| `agent-idea-09.md` | observability, resilience, data quality, DX | 12 |
| `agent-idea-10.md` | visual design, interaction, IA | 12 |

---

## Part 1 — Ten optimization areas (design + source code)

### 1. Performance & delivery
- **Ship the catalog pages as ISR with per-route tags** and invalidate from the
  sync via `revalidateTag`, so a badge update does not require waiting out the
  whole revalidate window.
- **Batch the catalog reads**: `/badges` currently runs several sequential
  PostgREST round trips (count + page + stats). One `select` with an embedded
  count, or a single SQL view, cuts the largest TTFB contributor.
- **Move the 15-minute potat cadence off the critical path**: write into
  `badge_stats` with `COPY`-style bulk insert (already chunked) and let the badge
  page read a cached view instead of the base table.
- **Image strategy**: badge images are 14–28 px but served at 1x/2x/4x. Emit
  explicit `width`/`height` (done) plus `decoding="async"` and a `sizes`
  attribute on the grid so mobile does not fetch 4x for a 56 px tile.

### 2. Accessibility (beyond the current state)
- **Announce live regions**: the activity feed and the countdown timers change
  without user action; wrap them in `aria-live="polite"` with a throttle, or
  screen-reader users get silent updates.
- **Focus management in the game modals**: after a round resolves, move focus to
  the result so keyboard users do not have to hunt for it.
- **Colour-independence**: rarity is colour + text today; the distribution bars
  and heatmap cells rely on colour alone — add patterns or labels to the
  heatmap legend.
- **Tab order audit in the Header**: the language switcher, theme toggle and
  account menu are visually grouped but interleaved with nav links.

### 3. Type safety & data contracts
- **Generate Supabase types** (`supabase gen types typescript`) and drop the
  hand-written row interfaces in `queries.ts`/`stats.ts`; every `as` cast in
  those files is an unverified assumption.
- **Validate API payloads with a schema** (zod or a hand-rolled guard) instead
  of `typeof x === "string"` chains — `/api/account` stores `customization`
  verbatim today, with no size or shape limit.
- **Make `FeedKind` and `AchievementCategory` the single source** for the
  message keys, so adding one without a translation fails the build.

### 4. Observability
- **Extend `system_heartbeats` with a per-sync metric payload** (rows written,
  API latency, error class) and chart it on `/stats` — the plumbing exists.
- **Alerting**: a daily cron that flags "no heartbeat for 2 h" or "catalog
  older than 26 h" and sends a push/email.
- **Client error reporting**: there is no capture for browser exceptions; a
  single `window.onerror` → `/api/health` breadcrumb would surface the class of
  bug we just fixed (silent unhandled rejection).

### 5. Security hardening (continuing this audit)
- **Rate-limit the public write endpoints** (`/api/blog/react`, `/api/coinrain`,
  `/api/steal`) per IP hash, not only per user.
- **Add `Content-Security-Policy` and `Strict-Transport-Security`** headers in
  `next.config.ts`; the app renders user-influenced strings in several places.
- **Rename the message keys that still carry a vendor name** (`profile.potat*`)
  so the identifiers do not leak into the rendered payload.
- **Audit `customization`**: cap the JSON size (e.g. 4 KB) and allow-list keys
  server-side so a stored blob cannot grow unbounded or inject CSS values.

### 6. Database & schema
- **Enforce the invariants in the database**: `coins >= 0`, `xp >= 0`,
  `level between 1 and 100` as CHECK constraints — the app logic already
  assumes them.
- **Add `user_progress.updated_at` to the hot path** with a partial index, and
  an index on `activity_events (kind, created_at)` for the feed filters.
- **Partition or roll up `badge_stats`**: a time series per badge grows without
  bound; a nightly rollup into daily rows keeps the owner-trend chart fast.
- **Backup policy checklist** in the README (Supabase PITR settings, restore
  test) — the project currently has no documented recovery path.

### 7. Code structure
- **Split `src/lib/queries.ts`** (500+ lines) into `catalog`, `profile`,
  `content` modules; it mixes four concerns and is the file every page imports.
- **One source of truth for rarity input**: `computeRarity` is called from two
  syncs with slightly different argument shapes; a single loader removes the
  drift risk that already caused one incident.
- **Extract the sync boilerplate** (`snapshot → diff → upsert → changelog →
  heartbeat`) into a helper; three engines repeat it.
- **Delete the dead keys** flagged by the audit (227 messages are never
  referenced) once the dynamic-key sites are migrated to explicit maps.

### 8. SEO & content
- **Programmatic landing pages** for each rarity tier, category and status
  combination (`/badges/legendary`, `/badges/twitchcon`) with real copy — the
  catalog already has the data and the i18n scaffolding.
- **Sitemap freshness**: include `lastModified` from the newest `badge_events`
  row per badge instead of a build timestamp.
- **RSS per locale** and `<link rel="alternate">` between them.
- **Open Graph for badges**: the profile OG route exists; a badge OG card with
  image + rarity + owner count would improve shares.

### 9. Gamification balance & fairness
- **Publish the odds** in one place (a static page fed from the same constants
  the games use) so the numbers cannot drift from the marketing copy.
- **Soft-limit the heists**: the flood check is per victim; a global daily cap
  would stop coordinated draining of the top collectors.
- **Progressive jackpot** for the wheel: a small share of every spin builds a
  pot that grows visibly — a strong reason to return daily.
- **Seasonal reset option** for the game ladder, keeping lifetime level intact.

### 10. Developer experience
- **Wire the audits into CI**: `bugreports/*.mjs` plus `tsc`, `eslint` and a
  `MISSING_MESSAGE` grep as a required check on every pull request — the FAQ
  and placeholder bugs both shipped with a green build.
- **A `verify` npm script** that runs lint + typecheck + build + the i18n audit
  + the atomic-economy test in sequence.
- **Seed fixtures** for a local Supabase so a new contributor does not need the
  production database to see a populated UI.
- **Document the invariants** that this audit had to rediscover (LIKE escaping,
  atomic counters, IP header trust) in AGENTS.md — partially done.

---

## Part 2 — Fifty feature ideas

Grouped by character. `T` = ties directly into Twitch badges.

### Unique & innovative (1–10)

1. **Badge archaeology / provenance page** `T` — for every badge: first global
   sighting, when the claim window opened, how the owner count moved week by
   week. Nobody publishes a badge's life story.
2. **Collection diffing against any date** `T` — "what did I own on 1 Jan?" from
   the inventory snapshot history; a personal time machine.
3. **Badge genealogy** `T` — cluster badges by artwork family (same artist/set)
   and show the family tree, so collectors can chase a whole lineage.
4. **Predictive drop calendar** `T` — a model over past windows that estimates
   the next drop date per category, with an explicit confidence band.
5. **Rarity replay** `T` — animate how a badge's rarity tier changed over its
   lifetime, including the moment it crossed into legendary.
6. **Public API with keys** — let other tools query the catalog, rarity and
   leaderboards; keys shown on the profile page as a "developer" badge.
7. **Collective goal events** — a community-wide target ("unlock 1 M badge
   claims this month") with a shared progress bar in the header.
8. **Badge bounties** `T` — users stake BadgesCoins on finding who owns the
   rarest collection; the finder takes the pot.
9. **Time-capsule profiles** — a private message attached to your profile that
   unlocks automatically in a year, with a badge as the key.
10. **Cross-catalog identity** — one profile that links Twitch, and optionally
    other platforms, showing a unified "collector score".

### Cool & satisfying (11–20)

11. **Live drop room** `T` — a page that opens automatically when a new global
    badge appears, with a shared countdown and live chat-lite reactions.
12. **Streak calendar with freeze** — a GitHub-style contribution grid for XP,
    plus one purchasable "freeze" per month so a holiday does not kill a streak.
13. **Wheel pity timer** — a visible counter that guarantees an epic-or-better
    slot after N spins without one.
14. **Animated level-up takeover** — full-screen 1.5 s animation when a user
    crosses a bracket, with the new badge unfurling.
15. **Badge shards** `T` — collect fragments of a legendary badge across days;
    assembling one unlocks a profile-only variant.
16. **Profile theme marketplace** — users publish colour/effect presets and
    others apply them with one click; authors earn BadgesCoins per install.
17. **Session recap** — after each visit: XP earned, badges found, rank change,
    as a shareable card.
18. **Duels** — challenge another collector to a best-of-three across three
    random games, both stakes visible before accepting.
19. **Live tournament bracket** — a weekly knockout where the winner takes a
    share of every entry fee and gets a temporary crown on the leaderboard.
20. **Collection showcase video** — one click renders a short MP4 of the
    profile's rarest badges with the level badge as the intro.

### Unexpected (21–30)

21. **Badge weather** `T` — a globe or map view showing which regions are
    unlocking which badges right now, from anonymised owner deltas.
22. **Silent auction for rare slots** — one showcase slot per month is auctioned;
    the winner's badge sits in a visible "podium" for everyone.
23. **Collector obituary** `T` — when a badge finally expires, the site publishes
    a short eulogy post with its stats; a melancholy archive of the catalog.
24. **Anti-hoard tax** — beyond a threshold of idle BadgesCoins, a small decay
    feeds the jackpot, making hoarding visible and socially costly.
25. **Badge horoscope** `T` — a playful daily "what your collection says about
    you" derived from the categories a user owns most.
26. **Mystery profiles** — every Monday one random profile is highlighted with
    their rarest badge and a riddle about who they are.
27. **Rarity insurance** — pay BadgesCoins to freeze a badge's rarity tier for a
    week so a sudden claim wave cannot demote your showcase.
28. **Community museum** `T` — a curated rotating exhibit of extinct badges with
    editorial text, toggled by votes.
29. **Ghost races** — replay a past tournament run as a ghost opponent to beat.
30. **Badge NFT-style certificates (non-blockchain)** — a signed, shareable
    PNG certificate for rare collections, generated server-side.

### Ordinary but expected (31–40)

31. **Wishlist with push alerts** `T` — watch a badge and get notified the
    moment it becomes claimable.
32. **Public collection pages with filters** — sort a profile's badges by
    rarity, date, category; shareable filtered URLs.
33. **Compare more than two users** — a table view across up to five usernames.
34. **Export** — CSV/JSON of the catalog and of a personal inventory.
35. **Search by image** `T` — upload a badge screenshot and find the matching
    entry.
36. **Discord/Telegram webhook** for new drops and tournament results.
37. **A real settings page** with account deletion (GDPR) and data export.
38. **Comment threads on badges** `T` — moderated, with reactions; the seed for
    community knowledge.
39. **Multi-language blog posts** — the post language selector already exists in
    the schema; surface it.
40. **Achievement progress bars** — show "3 / 10 games played" style progress for
    the next achievable achievement.

### Impressive / technical (41–50)

41. **Server-rendered rarity simulations** — "if this badge gains 5 000 owners,
    its score becomes X", computed on the server and shown as a slider.
42. **Real-time multiplayer rounds** — a shared slots or roulette table where you
    see other players' bets land live via SSE.
43. **Deterministic replay of every game round** — store the seed and inputs so
    any round can be re-run and verified by anyone (provable fairness).
44. **Anomaly detection on the economy** — nightly statistics flag impossible
    coin flows and auto-freeze the accounts involved.
45. **Bulk badge imports via QR** `T` — scanning a TwitchCon booth poster adds
    the badge to a "seen in the wild" collection.
46. **A public status page** with the heartbeat data, already collected, as a
    standalone `/status` route with incident notes.
47. **Vector rarity maps** — a 2-D scatter of owner count vs age with every
    badge plotted, zoomable; finding the "lonely corner" is the game.
48. **Time-shifted leaderboards** — "top collectors of badges released in the
    last 30 days", computed from the existing snapshot history.
49. **Edge-cached personal dashboards** — per-user progress rendered at the edge
    with stale-while-revalidate so the header HUD never blocks.
50. **An LLM badge assistant** `T` — answers "which currently claimable badge
    fits my collection best?" from the catalog, with cited rows.

---

## Suggested order if this ever gets built

1. Earn trust first: #31 (wishlist alerts), #32 (public collection pages),
   #37 (account settings/GDPR) — small, high-value, no new mechanics.
2. Then depth: #1 (provenance), #5 (rarity replay), #47 (rarity map) — they use
   data that is already collected.
3. Then social loops: #11 (drop room), #18 (duels), #19 (tournament).
4. Then the big swings: #42 (real-time multiplayer), #43 (provable fairness),
   #50 (assistant).

---

## Part 3 — 24 ideas from the idea sub-agents

Two idea agents ran after the platform quota recovered (the other eight scopes
stayed first-party). Their full write-ups are in `bugreports/agent-idea-01.md`
and `bugreports/agent-idea-02.md`; none duplicates the fifty above.

### Unique / innovative
- **Silhouette Showdown** [S] — a quiz that shows only a badge's outline; the
  catalog's image UUIDs make the asset side trivial.
- **Leak Radar** [M] — watch for a badge appearing in public inventories before
  its official window opens, and surface it as a scoop.
- **Fading Badges** [S] — badges whose claim window is closing drift visually
  toward grey as their `end_date` approaches.
- **Achievement Composer** [M] — let collectors define their own achievement
  from composable predicates, tracked by the existing evaluation loop.
- **Collection Completion Solver** [M] — "which 12 badges would make my
  collection the most complete per coin spent", solved over the catalog.
- **Art-Style Atlas** [M] — cluster badges by artwork family so collectors can
  chase a whole lineage.
- **Badge DNA Barcode** [S] — render a badge's six TBRI signals as a small
  barcode, shareable and comparable.

### Impressive / technical
- **Badge Futures Market** [L] — trade on a badge's predicted rarity tier using
  the momentum series; settles against the real tier.
- **Badge Time Machine** [L] — reconstruct any past date's catalog from
  `badge_stats` and inventory snapshots.
- **Drop Survival Lab** [M] — simulate how long a badge survives at a given
  owner-growth rate, using the window-brevity input.
- **Verifiable Badge Credential** [M] — sign a profile's rarest-badge claim so
  it can be verified elsewhere without trusting the page.
- **Live Owner-Delta Stream** [M] — stream owner-count changes as they land,
  the data the momentum score already consumes.

### Unexpected
- **Badge Half-Life** [M] — publish the median time-to-expiry per category.
- **Timezone Drop Lottery** [S] — which region unlocks a badge first, from
  anonymised owner deltas.
- **Orphan Badge Watch** [S] — badges with an owner count of zero or a missing
  image, presented as a museum of the forgotten.
- **Co-Ownership Recommendations** [M] — "collectors who own this also own…",
  derived from the owner lists already synced.

### Cool
- **TBRI-100 Index** [M] — a market-index style composite of the catalog.
- **Rarity Promotion & Demotion Ticker** [S] — a live feed of badges crossing a
  tier boundary.
- **Silhouette Daily Badge Game** [M] — one silhouette per day, streak-based.
- **Collector Percentile Card** [S] — a shareable "you are in the top X%" card.
- **Collection Fingerprint** [S] — a deterministic visual hash of a collection.
- **Deadline Density Calendar** [S] — a heatmap of upcoming expiry days.
- **Badge Bingo** [M] — a card of categories/rarities to complete.
- **Collector Net Worth** [M] — value a collection with derived BadgesCoins.

**Total collected: 10 optimisation areas, 50 first-party ideas and 121
sub-agent ideas = 171 feature ideas across the five requested categories.**

---

## Part 3 — the six additional idea sub-agents (batch 2)

The objective asked for ten idea sub-agents. Five had run (`agent-idea-01..05`,
24 ideas) before the platform quota blocked further launches; the quota later
recovered and the remaining five ran as real read-only sub-agents, so all ten
scopes now have a report. Each file holds twelve ideas with category, inputs,
effort and risk.

- **`agent-idea-05.md`** — gamification & economy (seasonal XP resets,
  collection-driven pass tracks, wager-free practice modes, coin sinks,
  server-verified tournament rounds, and similar).
- **`agent-idea-06.md`** — data & insights: Claim-Window Scarcity Forecaster,
  Rarity Stability Index, Collection Scarcity Curve, Badge Cohort Age Pyramid,
  Display-Wear Retention Ranking, Category Rarity Benchmarks, Time-to-Plateau
  Clock, Obtainability × Scarcity Quadrant Map, Window Collision Calendar,
  Expiry Rarity Impact Forecast, Weekly Rarity Migration Matrix, Collector
  Similarity Network.
- **`agent-idea-07.md`** — accessibility & performance: Arabic RTL via CSS
  logical properties, screen-reader announcements for countdowns and the
  activity feed, focus management/traps in game modals and the wheel,
  colour-independent rarity tiers, landmarks + skip link + one H1 per page,
  `prefers-reduced-motion`, one-round-trip catalog reads, tag-based ISR
  invalidation from the sync engines, cached OG renders, cached stats views,
  code-split recharts/game runtime, indexes for the hot read paths.
- **`agent-idea-08.md`** — growth, retention, content, community: embeddable
  live badge widget, guest inventory preview, missing-badge challenge card,
  lapse-back crate, themed leaderboard rotations, catalog-locked profile frames,
  badge of the day, "this month in badges" digest, how-to-earn playbooks,
  community corrections queue, collector fleets, feed cheers.
- **`agent-idea-09.md`** — observability, resilience, data quality, DX: provider
  contract fixtures, boundary validation for provider payloads, write-band
  assertions, per-source freshness SLO, `SYNC_DRY_RUN=1`, migration-drift
  preflight, post-deploy smoke check, shared provider-fetch wrapper (timeout,
  error classes, circuit breaker), sync cost/time budget guard, locale parity
  audit in verify, provider registry, anomaly review on the changelog page.
- **`agent-idea-10.md`** — visual design, interaction, IA: elevation/radius
  token scale, rarity ramps as tokens, badge-tile progressive reveal with a
  token-shaped skeleton, countdown urgency states, light-mode contrast pass on
  `--line`/muted text, locale-aware type scale with logical insets,
  comfortable/compact density switch, command palette, roving-tabindex grid
  navigation, persistent URL-backed filter chip rail, `.data-table` responsive
  card fallback, badge-detail anchor rail.
