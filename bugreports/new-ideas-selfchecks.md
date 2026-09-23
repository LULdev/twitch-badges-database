# Brainstorm self-checks — what the agents discarded

The ten brainstorm agents were required to re-read their own list against the
229-entry inventory and replace anything that restated an existing idea. This
file records what they reported discarding, so the "no rewordings" claim can be
checked rather than taken on trust. It is their account, summarised; the
machine checks (`npm run ideas:verify` plus the pairwise scan) are the other
half and are described in `docs/ACP.md`.

Roughly **68 drafts were discarded by the agents themselves** before the
mechanical checks even ran.

## badge (45 kept)
Replaced 6 restatements: *Set pages with version ladder* (= Badge genealogy by
artwork family), *Per-badge search interest* (internal duplicate of their own
zero-result idea), *Opt-in ownership presence list* and *Public badge shelves*
(= Public collection pages / Guest Inventory Preview), *Campaign attribution
layer* (= Programmatic landing pages), *Member claim outcome reports* (a fifth
community-submission idea alongside four on the board).
Earlier drafts also discarded for colliding with the inventory: drop-window
duration histogram (= Drop Survival Lab), badge-art clustering (= Badge
genealogy), anniversary flashback (= Badge of the Day), catalog snapshot
permalink (= Badge Time Machine), per-badge field changelog (= Badge
archaeology), threshold-based catalog alerts (= Achievement Composer),
colour/palette browse (= Art-Style Atlas), "recommend the next badge" (= the
on-board assistant idea).

## content (45 kept)
Discarded: *Annual "Year in Badges" report* (= This Month in Badges digest),
*Follow editorial topics + digest* (= Notification preferences centre +
per-locale RSS), *Public corrections log* (= Community Corrections Queue),
*Programmatic per-set landing pages* (= Programmatic landing pages by
rarity/category/status), *Sitemap segmentation* (= Sitemap freshness),
*FAQ knowledge-base expansion* (a restyle of the built FAQ page). Merged
*Content freshness scoring* and *fact-drift alerts* into one idea; folded
*Glossary of collector slang* into the badge glossary idea rather than shipping
two overlapping pages.

## design (45 kept)
Discarded: *Route-level skeleton set* and *Blurred LQIP placeholder* (= BadgeTile
progressive reveal), *Per-view column-count control* (= density switch),
*Site-wide number-odometer* (= the built CountUp component), *Changelog
timeline-rail redesign* (a restyle, not an idea), *Focus-ring styling spec*
(folded into a broader interaction-state token idea). Three more were dropped
as gimmicks rather than duplicates: live drop favicon, badge-art hover loupe,
log/linear axis auto-switch.

## game (45 kept)
Discarded: *Badge Detective*, *Badge Hangman* and the Catalog-Wordle variants
(= Silhouette Showdown), *Fantasy Badge League* and *Badge Portfolio Sprint*
(= Badge Futures Market), *Drop Pool prediction* (= the on-board prediction
idea), *Spectator betting on other members' rounds* (= real-time multiplayer
over SSE), *Time-attack speedrun mode* (a restyle of existing games), *Adaptive
risk limits from your own results* (economy tuning, not a game). *Badge Grand
National* was judged a restatement of ghost races and reworked into a
pari-mutuel field bet; *Idle Badge Vault Tycoon* was renamed to avoid the
existing vault game and the extinct-badge museum.

## addon (45 kept)
Discarded: *Arcade highlight reel* (= the profile-display family), *Arcade
career card* and *Monthly arcade Wrapped* (= Session recap card), *Expert demo
runs* and *Boss rounds with published seeds* (= Ghost races / deterministic
replay), *Random-game lobby with a variety bonus* (a hub restyle, too thin),
*Arcade preferences panel* (= the density switch and the customizer),
*Wheel spin insurance* (= Wheel pity timer), *Balance timeline chart* (a chart
restyle of the economy ledger). *Playstyle persona* was merged into the bet
pattern profile.

## stats (45 kept)
Discarded: *Window Duration Distribution* (= Drop Survival Lab), *TBRI
Volatility vs Owner Volume* (= Rarity Stability Index), *Markov tier transition
probabilities* (= Weekly Rarity Migration Matrix), *Zero-owner badge ratio
trend* (= Orphan Badge Watch), *404 path demand analysis* (= the 404 monitor),
*First-seen-to-window-open lag* (= Leak Radar), *Per-source publish latency*
(= freshness SLO), *Level histogram migration* (rearranges the existing chart),
*Sync anomaly scorecard* (= sync-anomaly review).

## profile (45 kept)
Discarded: *Expiring Status Cards* (= the built mood status), *Mute and Hide
Controls* (generic block control), *Introduction Cards* and *Mutual Progress
Pact* (= Collector Mentorship pairing), *Leaderboard Alias Opt-Out* (= broader
pseudonymous participation), *Collector Vows* (= Verified Collector Oaths +
streaks), *Collector Wrapped* (= Session recap card at a longer window),
*Before/after share cards* (= Collection diffing), *First-mover ribbons*
(= Snapshot Achievements), *Derived style horoscope variant* (= Badge
horoscope). *Dormancy Marker* was merged into the custodian-continuity idea.

## performance (45 kept)
Discarded: a circuit breaker for ownership providers (= the on-board
provider-fetch wrapper), *Cache the header's session/profile lookup* (= Edge-cached
personal dashboards), *Materialise the stats views* (= the cached-view ideas — a
materialised view is one), *Trigram index for catalog search* (= Index the hot
read paths), *Cache the OG render* (on the board verbatim; kept only the narrower
font-input angle), *Code-split heavy modules* (on the board), *Collapse /badges
into one round trip* (on the board), *Roll badge_stats into daily rows* (on the
board; kept the inverse of not writing the row), *Daily cron backstopping a dead
15-minute job*, *Edge-cache the /api/feed poll*. Three internal near-duplicates
were merged before writing.

## usability (45 kept)
Discarded 1: *Announce filter results and focus the count* — the same aria-live
announcement pattern the board already carries twice, merely pointed at a
different region. Replaced with *Highlight and explain search matches*.
Deliberately differentiated eight near-neighbours in-body rather than dropping
them (faceted counts vs the chip rail, breadcrumbs vs the anchor rail, RTL chart
mirroring vs CSS logical properties, per-script font stacks vs the type scale,
ARIA combobox vs command palette, and others).

## xp / coin / admin (45 kept: 15/15/15)
Discarded 1: *Drop-Day XP Surge* — a catalog-triggered global XP multiplier is
the same payoff as the on-board Coin Forge burn-to-multiplier window. Replaced
with *Earned Level Badge Loadout*. Four near-misses were kept only after making
the difference explicit in the body (a level-100 ascension vs the ladder reset, a
personal coin-to-XP desk vs the collective burn meter, a next-level path coach vs
the collection completion solver, step-up re-authentication vs panel 2FA).
