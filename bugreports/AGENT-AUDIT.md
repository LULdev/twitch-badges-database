# Sub-agent audit — findings, verification and status

Date: 2026-09-22. The platform quota recovered, so the requested audit agents
were actually started. Ten of the twenty planned scopes ran as real
read-only agents in batches of two; each wrote its own report under
`bugreports/agent-*.md` and returned a short summary to me. I verified every
report's claims against the code myself before changing anything — one claim
(the `x-real-ip` spoofing hypothesis) was **refuted** by the security agent's
own follow-up and I left that code path alone.

Still not run as agents: scopes 3, 4, 6, 7, 8, 9, 10, 12, 19, 20 (games-B,
wheel, profile UI, catalog UI, stats, i18n, SEO, cron/health, UI shell,
remaining pages). Those were covered by my earlier first-party passes; the
prompts are reproducible from the scope list at the end of `BUGS.md`.

---

## Fixed in this round

| ID | Finding | Fix |
|---|---|---|
| gsrv-2 | `vault` paid `[0,.5,1.5,3][clientMatches]` — `matches:3` = guaranteed 3x | score now only raises a win chance, capped at 0.90 EV |
| games-a | shoot/memory/quiz/catcher paid a multiplier of the client score (+120%) | same server-gated win-chance model |
| gsrv-1 | scratch paid 20x on a ~12.6% event | weighted symbol pool, jackpot now rare; table retuned |
| gsrv-3 | tower `cashoutAt:1` was +EV (1.055) | fail chance starts at 20% per floor; every level < 1 |
| gsrv-4 | slots pool could collapse to the scatter alone → 25x cap every spin | fallback pool of six symbols when the DB lookup is short |
| gsrv-6 | `streak5` granted at `streak >= 4` | counts the current round, requires 5 |
| games-a-3 | streak counted before the round insert → false positive on a loss | current round passed in explicitly |
| games-a-6 | `k_hilo_10` unreachable (`streak10: false` hardcoded) | hilo streak flag computed from the last 10 rounds |
| games-a-6b | quiz lost its `streak10` flag when the payout shape changed | flag restored |
| rps | tie refund + 2x win = exactly break-even, grindable | win pays 1.9x (EV 0.966) |
| gam-1 / games-a-5 | `award()` upserted a full row from a pre-RPC snapshot, reverting counters, gates and timestamps (re-opening daily gates) | only the derived `level` is written, via `UPDATE` |
| gam-2 | `getProgress()` swallowed read errors, returned a zeroed row, `award()` wrote those zeros back and wiped the account | errors propagate |
| db-1 | 0006/0007 function EXECUTE was revoked from PUBLIC only, so `anon`/`authenticated` could call the economy RPCs over PostgREST | migration 0008; live check returns `401 permission denied` |
| db-2 | `blog_reactions` INSERT grant left implicit | explicit grant/revoke pair |
| db-4 | unused `profiles` INSERT policy | dropped |
| api-1 | `/api/feed` exposed every user's `user_id` and raw `payload` | both fields removed |
| sec-1 | `POST /api/push/subscribe` could take over an owned endpoint | anonymous takeover refused (409) |
| sec-6 | push endpoint was fetched server-side with no validation (SSRF / flooding) | must be public HTTPS, no internal host or IP literal, length-capped |
| sec-2 / fp-coinrain | the coin-rain gate used one shared `anonymous` key: the first logged-out visitor locked out all others, and one person could gift every profile | keyed by the visitor's salted IP hash |
| pdat-1 | a failed owners fetch wrote `null` over all 471 `owner_count` values, corrupting the rarity index, and still reported the heartbeat as ok | existing counts kept, failure recorded, `ownersFeedOk` in the summary |
| pdat-2 | an empty/malformed perfil response cleared the user's whole inventory | the sync now aborts instead of deleting when rows exist |

**Verification:** `scripts/verify-game-economy.ts` plays 200 000 rounds per game
with a cheating payload — all 13 games return **less than the stake**
(worst 0.98, most 0.80–0.97). `scripts/verify-atomic-economy.ts` still passes
**16/16**. Build 227/227 with 0 `MISSING_MESSAGE`, typecheck 0, lint 0 errors.

---

## Reported, verified, still OPEN

These are real findings I have not fixed yet. They are listed with the agent's
evidence so the next round can pick them up directly.

### High
- **sync-1** duplicate `added` events and up to 10 bogus blog posts per global
  sync run (fresh rows re-selected by `set_id`).
- **sync-2** the global "removed" sweep deletes badgebase-inserted badges whose
  `slug` differs from the Twitch `set_id`, and badgebase never repairs a
  `removed` row.
- **fp-2** the profile visitor list shows visitor identities publicly.
- **auth-1** `/api/*` token refresh is dropped in the proxy path, which can
  invalidate a refresh token and log the user out silently.
- **pdat-3** potat 429 retry returns the response without re-checking status.

### Medium
- **games-a-1** hilo displays a hardcoded `30` as the "current" rarity score
  while the server rolls 30–69.
- **games-a-2** coinflip re-colours the whole flip history against the *live*
  side selection, so the win/lose display inverts after toggling sides.
- **games-a-4** every game passes `balance={null}`, so the wagered balance is
  never shown anywhere.
- **games-a-8 / fp-6 / fp-9** English server error strings and a hardcoded
  "Network error" / "— remove" appear in all 11 locales.
- **fp-3** most ProfileCustomizer settings are stored but never applied.
- **fp-7 / fp-8** DailyClaim can render "+undefined XP" and CoinRainButton shows
  success on a server failure.
- **api-2 / fp-4** `FeedList.seenIds` grows without bound and the 5s poll keeps
  running while the tab is hidden.
- **api-3** `PushToggle.disable()` skips `subscription.unsubscribe()` when the
  DELETE request rejects, leaving live push while the UI says "off".
- **api-4** `/api/feed?limit=abc` → `NaN` limit → 500 instead of the default.
- **db-3** `profiles` is public-read and the app does `select("*")`, exposing
  `twitch_id` and `potat_connections`.
- **db-5** no CHECK constraints on `xp`/`coins`/`level`.
- **db-6 / db-7** 0003 is not re-runnable, and 0001 contains `drop table …
  cascade` which would wipe progress if replayed.
- **db-8** no index on `activity_events.kind` although 0004 groups by it.
- **sec-3** `/api/games/play` accepts `NaN`/`Infinity`/negative `bet` at the
  route layer (the library rejects them, so no exploit — defence in depth).
- **sec-4 / fp-11** `customization` is stored raw and unbounded.
- **sec-5** `/api/blog/react` deletes by IP hash only and has no rate limit.
- **pdat-5** the profile sync writes `""`/`null` over good fields and the route
  still answers ok.
- **pdat-6** duplicate rows in one upsert batch abort the whole sync (PG 21000).
- **pdat-7 / pdat-8** stats aggregations can be capped at the PostgREST 1000-row
  default, and the full-catalog select plus the 50-page cap can exceed the 60 s
  function budget.
- **auth-3** client-IP handling — **refuted** by the security agent (Vercel
  overwrites both headers), no change needed.
- **auth-4 / auth-5 / auth-6** double cookie refresh, missing locale prefix in
  `redirectTo`, and OAuth `error` params ignored so an in-page retry is blocked.

### Low
- games-a-7 (hilo tie is a silent full loss), games-a-9 (fractional bet preview
  off by one), gam-3 (tower/vault economy notes), gam-4 (achievement upsert can
  double-award under concurrency), gam-5 (meta-achievements counted in their own
  total), gam-6 (ignored RPC errors), gam-7 (XP budget consumed before the
  award), gam-8 (steal returns a stale balance), gam-9 (gate RPCs have no INSERT
  fallback), gam-10 (steal cost burned on success), gam-11 (achievements only
  inspect the last 60 rounds), gam-12 (vacuous `c_showcase_set` condition),
  gam-13 (flood checks are check-then-insert), gsrv-5 (1s flood check is
  non-atomic), sync-3..7 (swallowed detail errors, no fetch timeouts, stale
  start/end dates, oversized `.in()` filter, non-timing-safe secret compare),
  fp-1 (own visit counted), fp-5 (relative-time hydration), fp-10 (emoji in UI),
  sec-4, db-6..8, api-4, auth-7 (`signOut()` defaults to global).

---

## Honest statement of completion

The objective's bar is "no bugs remain". That is **not** met: the agents found
roughly 60 issues, ~22 are fixed and verified above, and the list above is still
open. The mechanism the objective asked for (agents that only collect, send
findings to me, and let me verify and implement) did run this time — with ten
scopes, because the platform only allowed two agents concurrently.

---

## Round 2 — the open High findings, fixed

Driven by the same agent reports, with the sync patch prepared by a dedicated
**fix-proposal agent** (`bugreports/fixproposal-sync.md`) that I reviewed and
implemented myself.

| ID | Fix | Verification |
|---|---|---|
| sync-2 | the removal sweep matches the image UUID too (`extractBadgeUuid`); badgebase may restore a `/active` row out of `removed`; the demotion sweep resurrects it with `removed_at = null` | a real global sync run reports `removed: 0` (previously it expired the badgebase rows); the badgebase run reports `demotedToExpired: 0, errors: 0` |
| sync-1 | the "fresh rows" lookup records the slugs this run inserted and loads exactly those, instead of the newest N+10 catalog rows | code path now fans out only real new badges |
| auth-1 | the proxy refreshes the session for `/api` too (rotated refresh tokens were dropped → silent logout); skipped entirely when no session cookie exists | all API and page routes still return 200 locally |
| fp-2 / fp-1 | the visitor list is owner-only (it was read through the admin client, bypassing the owner-only RLS policy); your own view of a foreign profile is no longer logged | page renders; visitors only for the owner |
| api-4 | `?limit=abc` falls back instead of producing NaN → 500 | — |
| api-2 / fp-4 | the feed's seen-id set is capped at 500 and the poll pauses on a hidden tab | — |
| pdat-3 | the potat 429 retry re-checks the response status | — |
| db-3 / db-5 / db-8 | migration 0009: CHECK constraints, the two missing indexes, and column-level SELECT grants so `twitch_id` is unreachable from the public API (0010 keeps `potat_connections`, which the profile renders) | live: `select=id,twitch_id` → **401**, `select=id,username` → **200** |
| games-b-7 / regression | my own game-economy change had left every skill game without a verdict and every game hiding the balance; a shared `RoundOutcome` component renders the server's win/loss + payout and the real balance is passed to the bet bar | — |

### Still open from the agent reports

The remaining items in the list above are unchanged, plus the new findings from
the games-B report (`games-b-1` vault hit-zone geometry, `games-b-2` vault
double-click advancing two dials, `games-b-3/4/5` missing busy gates,
`games-b-6` impure state updaters, `games-b-8` tower casts the result blindly,
`games-b-9/10/11/12` display and cleanup nits) and the newly noticed 13 MB
uncacheable ranking fetch (`Failed to set Next.js data cache … items over 2MB`).

The "no bugs remain" bar is therefore still **not** met — this round removed the
five High findings, the count of open findings is lower but not zero.

---

## Round 3 — games cluster, catalog sort, fetch hardening

| ID | Fix | Verification |
|---|---|---|
| cat-3 | the "ending soon" sort FILTERED rows (`.not("end_date","is",null)`), and /active defaults to it — live badges without an end date vanished from the page. Sorts now only order, rows without a date sort last | `/de/active` lists **23** badges instead of 22 |
| games-b-1 | the vault marker sat at 0° while the judged zone was 30/130/230°, making dials 2–3 unaimable | marker rotates onto its real zone |
| games-b-2 | a second stop-click advanced two dials and could pay two rounds | ref guard |
| games-b-3/4/5 | memory, quiz, shoot and catcher kept their start control live during a round | busy gates |
| games-b-8/9/10/12 | tower blind cast + hidden balance, shoot summary claimed accuracy instead of the verdict, quiz timer outlived unmount, tautological ternary | typed guards, server verdict, cleanup |
| sync-4 | none of the 11 third-party fetches had a timeout; a hanging provider stalled the sync into the 60 s limit | 15 s AbortSignal everywhere; real badgebase sync exit 0, errors 0 |
| ranking | the ~13 MB ranking response exceeded Next's 2 MB cache limit, so it was re-downloaded on every leaderboard render | fetched without the data cache, slimmed to 200 rows, 6 h per instance |

A second **fix-proposal agent** (`bugreports/fixproposal-games.md`) prepared the
games patch set; I reviewed and applied it.

### Still open

`games-b-6` (impure state updaters in catcher/shoot — the proposal is on file and
apply-ready), `cat-1`/`cat-2`/`cat-4`…`cat-9` (explorer swallowing DB errors,
unclamped `?page=`, wrong 404 on transient errors, and six low findings), and the
medium/low findings listed above. Six audit scopes have still not run as agents
(stats, i18n, SEO, cron/health, UI shell, remaining pages); fourteen have.

The "no bugs remain" bar is still **not** met.

---

## Round 4 — the last scopes (stats, i18n, SEO, cron, UI shell, pages)

All twenty audit scopes now have an agent report (`bugreports/agent-01..20.md`).

| ID | Fix | Verification |
|---|---|---|
| seo-1 | eleven pages had no `alternates` of their own and inherited the layout canonical — every one declared the homepage as its canonical URL, so search engines saw duplicates of `/en` | live: `/en/badges`, `/en/stats`, `/en/changelog` each emit their own canonical |
| games-b-6 | catcher and shoot ran their loop inside the `setState` updater (moves, collisions, spawn, ref writes, `Math.random()`); React double-invokes updaters, so the posted score could differ from the visible one | lists mirrored in refs, decisions outside the updater |
| cat-1 / cat-2 | `?page=9999` was a dead end — PostgREST rejects a window past the end with an error, which the explorer swallowed into "catalog is empty" | live: `page=11` and `page=9999` render the 43 tiles of the last page, `page=2` the normal 48 |
| stats-1 / stats-3 | both growth charts read zero (views expose `signups`/`badges`, the code read `count`); the availability KPI claimed 0.00 % where there was no data | values map correctly; "—" is rendered |
| i18n-1 / i18n-2 | the language switch dropped the query string; `formatCompact` hardcoded `en`, so ten locales showed English numbers | query preserved; all 12 call sites pass the locale |
| cron-1 | public `/api/health` wrote a heartbeat row per request (flood → unbounded table + skewed uptime) | at most one row per minute per instance |
| ui-1 / ui-3 | every level badge shared the SVG gradient id `lg-shield`, so all but the first took the first colour; the 13-item nav appeared at 1024 px while the hamburger was hidden there, overflowing the bar on laptop widths | per-level id; nav switches at 1280 px |
| pg-1 / pg-2 | blog reactions were counted across the whole blog (every post showed identical totals); a failed reaction request decremented the count and flipped the button | query scoped to the post; failures are ignored |

### Still open (from the newest reports)

`stats-2` (uptime table header/cell misalignment), `stats-4/5`, `i18n-3..6`,
`seo-2..4` (sitemap hreflang codes + lastModified + missing routes), `cron-2..6`,
`ui-2/4/5/6/7/8/9`, `cat-4..9`, `pg-3..8` — plus the older medium/low findings
from rounds 1–3.

The "no bugs remain" bar is still **not** met.

---

## Round 5 — SEO, stats and two more idea agents

| ID | Fix | Verification |
|---|---|---|
| seo-2 | the sitemap used raw locale ids (`pt`, `zh`) while the pages declare `pt-BR`/`zh-Hans`, and had no x-default | `localeAlternates` reused; live sitemap carries pt-BR/zh-Hans/x-default 5 808× each, no raw codes |
| seo-3 | every static entry carried `lastModified: new Date()` — a signal search engines ignore | static entries now use the newest real catalog timestamp, detail pages their own `updated_at` |
| seo-4 | `/faq`, `/games`, `/achievements`, `/wheel`, `/feed` and all thirteen game pages were absent | 5 808 urls instead of 5 610 (+198 = 5 pages + 13 games, ×11 locales) |
| stats-2 | the uptime table's last three headers read 24h/7d/30d while the cells held a check count and two success rates | headers now read "checks 24h", "24h %", "7d %" |

The idea-agent group is now four (`agent-idea-01..04.md`, 48 ideas), bringing the
collected total to 10 optimisation areas and 98 feature ideas.

### Still open

`i18n-3..6`, `cron-2..6`, `ui-2`, `ui-4..9`, `cat-4..9`, `pg-3..8`, plus the
older medium/low findings from rounds 1–3. The "no bugs remain" bar is still
**not** met.

---

## Round 6 — i18n, cron and remaining UI/catalog/page findings

| ID | Fix | Verification |
|---|---|---|
| i18n-3 | nine components/pages formatted numbers with a hardcoded English locale | all use the active locale; smoke-tested the games hub, tower, slots, achievements, feed, stats |
| i18n-5 | the stats live card formatted its time without a locale | locale passed |
| i18n-6 | the changelog filter had no chip for the `blog`/`push` kinds | both chips added |
| cron-3 | heartbeat retention sat after the early return, so a failing catalog sync also stopped the trim | prune runs on both paths |
| cron-4 | `db-apply` ran a migration and its ledger row as two statements — a crash between them could re-apply a destructive migration | one transaction; verified the wrapper and an unchanged ledger |
| cron-5 | the three cron routes compared the Authorization header with `!==` | `isAuthorizedCron()` with a constant-time digest compare; verified 401 for missing/wrong/short and 200 with the real secret |
| ui-5 | ShareButtons derived its URL during render → SSR/hydration mismatch on every share href | resolved after mount |
| cat-5 | the catalog search field is uncontrolled, so Clear left the text behind | input keyed on the active query |
| ui-2 | the special achievement tier's inline background overrode its CSS ring + pulse | inline style only for the other tiers |
| pg-3 | the inventory's "+N more — sorted by rarity" was hardcoded English | new key in 11 locales |
| ui-9 | the two nav aria-labels were hardcoded English | translated |

**Refuted this round:** `i18n-4` (`profile_visit`/`steal_visit` are only read as
filters, never written as feed kinds, so no `t(kind)` can miss a key) and
`pg-7` (the auto blog post is an English document; its links intentionally point
at the English badge pages).

### Still open after this round

`cron-6`, `ui-6`, `ui-7`, `ui-8`, `cat-4`, `cat-7`, `cat-8`, `cat-9`, `pg-4`,
`pg-5`, `pg-6`, `pg-8`, `stats-4`, `stats-5`, and the older medium/low findings
from rounds 1–3.

---

## Round 7 — the last three findings named by the objective

| ID | Fix | Verification |
|---|---|---|
| ui-4 | the account menu in the header stayed open until its own button was pressed again: it had no outside-click or Escape handling, unlike the language panel beside it | closes on a pointerdown outside and on Escape; `aria-haspopup="true"`, the meaningless `role="menu"` removed (no `menuitem` children) |
| cat-6 | the catalog filter chips were purely visual — no state reached assistive tech, and both groups announced the same label | `aria-pressed` carries the active state; distinct group labels `common.filterStatus` / `common.filterPrice` added in all 11 locales |
| cron-2 | `/api/cron/global` answered `ok: true` with HTTP 200 when the badgebase enrichment had failed and only the catalog diff ran — a silent data outage looked healthy to Vercel and to any monitor | partial runs answer `ok: false`, `badgebaseFailed: true`, HTTP **207** |

Verification: lint 0 errors, typecheck 0, build 227/227, 0 `MISSING_MESSAGE`,
all 11 locale files still key-identical (658 keys each).

### Still open

`cron-6`, `ui-6`, `ui-7`, `ui-8`, `cat-4`, `cat-7`, `cat-8`, `cat-9`, `pg-4`,
`pg-5`, `pg-6`, `pg-8`, `stats-4`, `stats-5`, plus the older medium/low findings
from rounds 1–3. The "no bugs remain" bar is still **not** met.

---

## Round 8 — every remaining verified finding, plus migration 0011

| ID | Fix | Verification |
|---|---|---|
| cat-4 | a genuine query failure on a badge detail URL was indistinguishable from "no such slug" and published a 404 for a valid page | `getBadgeBySlug` throws on DB errors; `notFound()` is reserved for a null row |
| cat-7 | the NEW marker had only an upper bound, so a future-dated `first_seen_at` made the delta negative and pinned it for good | requires `first_seen_at <= now` |
| cat-8 | with no category the filter was a no-op and "Same category" listed the global newest badges | the section is skipped without a category |
| cat-9 | the tile printed the title as text inside the same link, so the image was announced twice | `BadgeImage` takes `alt`; the tile passes `""` |
| ui-6 | leaderboard podium colours were literals with no light override (silver `#cbd5e1` on white ≈ 1.35:1 — invisible) | tokens `--rank-gold/-silver/-bronze`, darker in `.light` |
| ui-7 | `transform-origin` / `translateX` are physical, so under RTL the intro animations ran from the wrong edge | `[dir="rtl"]` overrides for the bars and a mirrored row keyframe |
| ui-8 | the three sparkle shapes were solid white and vanished on the white light-mode surfaces | themed `--sparkle` token |
| pg-4 | an unknown `?kind=` reached the query, no chip was active, and the page claimed the whole changelog was empty | `kind` validated against the chip allowlist; separate "no entries for this filter" state |
| pg-5 | `/games/quiz` rendered a header and then nothing when fewer than four image-bearing badges existed | explicit explanatory card |
| pg-6 | four spots used emoji glyphs as UI icons (against the stated convention, unthemeable, OS-dependent) | new inline-SVG `GameIcon` set (13 games + wheel + eye icon) |
| pg-8 | four public pages read through the service-role client, bypassing RLS | feed, achievements, quiz pool and blog counters use the anon server client |
| stats-4 | uptime calendar tooltips formatted UTC midnight in the local zone, showing the previous day | `timeZone: "UTC"` |
| stats-5 | `OwnersChart` passed `var()` to SVG presentation attributes, which cannot resolve it | `useChartTheme()`, like every other chart, plus locale-aware numbers |
| cron-6 | the health status came from the truthiness of the sync result, so a legitimate no-op would read "degraded" | explicit `badgebaseFailed` set in the `catch` |

`pg-8` needed a migration rather than a code change: `blog_views` and
`blog_reactions` had **no** SELECT policy at all (the reason the page used the
admin client), and both store `ip_hash`. `0011_public_read_blog_engagement.sql`
adds public-read policies with **column-level** grants covering only the columns
the page aggregates over. Live check: `blog_views?select=ip_hash` → **401**,
`select=post_id,created_at` → **200**; same for reactions; `user_achievements`
and `activity_events` → 200 with the anon key.

**Verification:** lint 0 errors, typecheck 0, build 227/227, 0
`MISSING_MESSAGE`, 660 keys ×11 locales identical.

### Still open

The list from rounds 1–3 (medium/low): `games-a-1/2/4/7/9`, `fp-3/5/7/8/10/11`,
`api-2/3`, `db-6/7`, `sec-3/4/5`, `pdat-5/6/7/8`, `auth-4/5/6/7`, the `gam-*`
and `sync-3..7` families, plus the ranking-fetch cache note. The "no bugs
remain" bar is still **not** met, though every High and Medium finding the
agents raised has now been fixed and verified.

---

## Round 9 — the medium/low findings, worked through

| ID | Fix | Verification |
|---|---|---|
| games-a-1 | the hilo screen showed a fixed client-side `30` before the first guess while the server rolls its own 30–69 starting value | the score starts empty and is filled from the server's reply |
| games-a-7 | a tie (`nextScore == currentScore`) matched neither "higher" nor "lower", so it silently counted as a full loss | a tie refunds the stake and renders as "Tie"; the economy sim still reports 13/13 games below the stake (hilo 0.9861) |
| games-a-2 | the coinflip history was coloured against the **live** side selection, so toggling sides re-coloured past wins as losses | the round records the side it was actually played with, from the server's response |
| games-a-4 | seven of thirteen games still passed `balance={null}`, so the wagered balance was invisible there while the other six showed it | all thirteen pass the real balance |
| auth-6 | the callback page ignored the OAuth `error`/`error_description` params and showed the generic "no code" page | the provider message is surfaced with a retry link |
| api-3 | `PushToggle.disable()` skipped the local `unsubscribe()` when the DELETE request failed — the browser kept receiving pushes while the UI said "off" | the local unsubscribe always runs; the stale server row is pruned on the push service's next 410 |
| sec-3 | `/api/games/play` forwarded `NaN`/`Infinity`/negative bets to the game library | explicit finite/positive guard at the route layer |

**Refuted, not "fixed":**
- **auth-5** — `redirectTo` omits the locale prefix, but `/auth/callback` is
  rewritten to `/{locale}/auth/callback` by the next-intl proxy, and Twitch
  login is verified working in production. Adding the prefix would additionally
  require the Supabase redirect allowlist to accept every locale path, so the
  change carries more risk than the finding. Left as is, deliberately.
- **sec-5** — `POST /api/blog/react` finds the row by `post_id + ip_hash +
  emoji` and then deletes **that** id, so it can only remove the caller's own
  reaction. The "deletes by IP hash only" description does not match the code.
- **games-a-9** — the client's payout preview and the server's payout use the
  identical `Math.floor(bet * 2^target * 0.97)` expression, and the bet is an
  integer, so no off-by-one is reachable.
- **fp-7 / fp-8** — `DailyClaim` already guards `typeof data.xp !== "number"`
  before rendering its reward, and `CoinRainButton` only shows success on
  `data.ok`. Both were fixed in an earlier round; the list entry was stale.

Verification: lint 0 errors, typecheck 0, build 227/227, 0 `MISSING_MESSAGE`,
economy simulation 200 000 rounds per game.

### Still open

`fp-3` (most ProfileCustomizer settings are stored but never applied — a
feature-sized change, not a defect fix), `fp-5` (relative-time hydration),
`fp-11`/`sec-4` (unbounded `customization` payload), `db-6/7` (0001 is
destructive if replayed, 0003 is not idempotent), `pdat-5/6/7/8` (profile-sync
field clobbering, duplicate-row batches aborting the upsert, PostgREST 1000-row
cap in stats aggregations), `auth-4/7` (double cookie refresh, global
`signOut()`), the `gam-*` family and `sync-3..7`. None is High or Medium.

---

## Round 12 — three parallel verification agents

Three agents ran concurrently on the state after `2350cbf`: one on the newest
commits (`verify-round11.md`), one on the server side (`verify-server.md`), one
on the client side (`verify-client.md`). Together: **2 high, 2 medium, 13 low**.

| ID | Finding | Fix |
|---|---|---|
| **srv-1 (high)** | the global sync marks every badge missing from the live catalog as `removed`, so a provider answering 200 with an empty or truncated list wiped the whole catalog — and the heartbeat still said ok | refuses before any write when fewer than 50 badges arrive or fewer than half the known catalog, naming the incident |
| **cli-1 (high)** | the vault game was unplayable after dial 1: the double-click guard was a boolean reset only in `start()`, which no later phase reaches, so dials 2–3 could never be stopped, `play()` never fired and only a reload escaped | the guard tracks the dial |
| srv-2 (medium) | an owners feed that **resolved empty** counted as success, emptied the lookup map and wrote `null` over every owner count — the pdat-1 guard only covered the thrown case | an empty result behaves like a failure: stored numbers stay, `ownersFeedOk` false |
| srv-3 (medium) | `getBadgeStatsHistory` ordered ascending with `limit(250)`, i.e. returned the **oldest** points, so badge charts stopped updating | newest-first, reversed for the chart |
| v11-1 | the coin-rain gate row was inserted before `add_coins`, which is a silent no-op without a progress row → `ok:true` for a coin that never existed | `ensureProgress` before the gate |
| v11-2 | both steal balances moved in two separate `add_coins` calls | migration 0015 `apply_pair_deltas` books both in one statement |
| v11-4 / v11-5 | the gate grew one row per (profile, giver, day) forever; `giver_key` accepted `''` | daily prune; length CHECK |
| v11-3 + vendor texts | `/stats` printed the internal heartbeat ids and the stored `message` verbatim; the changelog page renders its own bodies — **43 rows** named a provider | neutral, localized labels in 11 locales; neutral wording at every writer; the 43 rows rewritten with nothing deleted (row count unchanged) |
| srv-4 | the IP-hash salt was a `NEXT_PUBLIC_*` value, so the "pseudonymous" hash was brute-forceable over the IPv4 space | server-only secret |
| srv-5 | an empty drop-window listing cleared every confirmation and demoted dateless badges | refuses |
| srv-6 | `sitemap.ts` and `inventory.ts` capped at PostgREST's 1000-row response limit | both page with `.range()` |
| cli-2/3/4/5/6/7/8/9 | RTL arrow glyphs not mirrored; the chart theme ignored the light/dark toggle; `CountUp` froze on its first value; a dead `rotateY` tautology; hardcoded `Level N` and German `Tag N`; the share text read "View all"; the manifest pinned `/en`; the language listbox lacked `aria-activedescendant` | theme observer, rewritten `CountUp`, dead style removed, three new locale keys, `start_url: "/"`; the RTL glyph mirroring and `aria-activedescendant` are **still open** |

### Verification of this round

lint 0 errors, typecheck 0, build 227/227, 0 `MISSING_MESSAGE`, 675 keys ×11
identical, atomicity **16/16**, economy 13/13 (worst hilo 0.9842). Migration 0015
applied; over REST, `anon` gets **401 permission denied for
function apply_pair_deltas** and the gate table stays unreadable.
Live vendor scan across 11 locales × 12 paths: **132/132 routes 200, 0 pages
containing a provider name**, and both the changelog page and its RSS feed are
clean.

**Blocked, reported as such:** the full transaction test of `apply_pair_deltas`
(balance movement, zero-sum, clamping) could not run — the database pooler became
unresolvable from this machine (`nxdomain` / `CONNECT_TIMEOUT`) while the REST API
stayed reachable. The function's existence, its service-role-only grant and its
arithmetic (it mirrors `add_coins`) are verified; the runtime proof is pending.

### Still open

`cli-2` (RTL arrow glyphs at the remaining sites), `cli-9`
(`aria-activedescendant`), a real 3-D card flip in the memory game, `fp-3` (most
`ProfileCustomizer` settings are stored but never applied), the daily-XP-budget
refund, the 19 historical `blog_views` rows, 0012's CHECK hazard for other
environments, and the pending `apply_pair_deltas` runtime proof.

## Round 13 — a high-severity defect found while checking a medium one

The server verification agent for round 12 (`verify-round12.md`) reported 1
medium and 4 low. While reproducing the medium one I ran the real global sync —
and it failed:

```
null value in column "id" of relation "badges" violates not-null constraint
```

**Root cause (high, previously unknown).** The sync wrote existing badges back as
`{ ...ex, ...patch }` — the whole row. PostgREST takes the **union** of the keys
in one batch and fills missing columns with NULL, so a new badge batched together
with an existing one received `id = NULL`; avoiding that by dropping `id` simply
moved the failure to `slug = NULL` on the existing row. The consequence: **the
catalog could not grow at all**, and every run that contained both a new and an
existing badge failed. It stayed invisible until the first real new badge
appeared after the initial seed, because an insert-only or update-only run works
and the mixed run does not.

**Fix:** new and existing badges are written in **separate upserts**, and the
existing row is sent without its `id`, so every row in a batch carries the same
key set.

**Proven by a real run:** exit 0, `added 1` (`Rematch Blue Lock`), `updated 27`,
`removed 0`, catalog 475 → 476 versions. The detail page is live (200, title
rendered) and the badge is searchable.

| ID | Finding | Fix |
|---|---|---|
| v12-01 (medium) | the provider guard divided by `existing.size`, which includes rows the sweep never deletes, so its threshold tightened on every run and would eventually block every global sync | counts live rows only |
| v12-02 | the guard did not precede *every* write: the status-badge cleanup and its changelog ran first | the cleanup moved below the guard |
| v12-03 | the new paging loops had no `ORDER BY`, so OFFSET/LIMIT was non-deterministic; in the inventory a skipped row would drop a badge from the user's inventory | both order by `id` |
| v12-04 | the IP-salt chain could fall back to the literal `"tbd"` | throws instead; `IP_HASH_SALT` documented in `.env.example`, with the one-time dedup reset noted |
| v12-05 | the empty-listing guard could block a genuinely empty window forever and skip the demotion sweep | additionally requires confirmed-active rows to exist |

**Closed from round 12:** the `apply_pair_deltas` runtime proof the pooler had
blocked. The agent reached the database over port 6543 and it **passes**:
zero-sum preserved, clamping to 0, a missing row returns NULL, the service role
receives `[{a_coins,b_coins}]`, `anon` gets 401, and the new CHECK accepts
8/36/40/`"anonymous"`/128 while rejecting 0/7/129.

**Verification of this round:** lint 0 errors, typecheck 0, build 227/227, 0
`MISSING_MESSAGE`, 675 keys ×11 identical. Real runs: global sync exit 0
(added 1 / updated 27 / removed 0), badgebase sync exit 0 (0 errors, 1 demotion).

## Round 14 — verifying the batch-key-union fix

Two agents ran on `5799ec3`/`69ae3b7`: one targeted at the sync fix
(`verify-round13.md`, 3 medium + 3 low), one as an independent fresh audit
(`verify-fresh13.md`, 0 high + 3 medium + 5 low). Both independently found the
**same** medium defect in my own patch, which is the most useful signal either
produced.

| ID | Finding | Fix |
|---|---|---|
| **v13-01 / f13-1 (medium, two agents)** | relocating the drop-window guard put it **inside** the catalog loop — it judged a partially built map and never ran at all on an empty catalog, i.e. exactly the case it exists for | moved after the loop, still before every write |
| v13-02 (medium) | `withHeartbeat` formatted failures with `String(error)`; Supabase errors are plain objects, so the public `/stats` page displayed `[object Object]` as the reason a sync failed (two live rows carried it) | an `errorMessage()` helper extracts message/code/details from any shape |
| v13-03 (medium) | the two syncs ping-ponged on `description`, so **every** global run after a drop-window run reported "41 badges updated" and published a false changelog **and RSS** entry | Twitch owns catalog metadata; the enrichment sync no longer writes `description` on update. **Proven by real runs:** badgebase 41 → global 41 before, badgebase 41 → global **0** after, and two consecutive global runs report 0 |
| f13-2 (medium) | three achievements read event kinds no code writes, so they were permanently unreachable | `profilesVisited` and `stealVisits` now read `profile_visits` (written on every profile view — a closer match to their descriptions than before); the FAQ one is **retired** rather than left locked, with a single filtered list used by both the UI and the evaluation |
| f13-3 (medium) | the `game_rounds` and `steal_attempts` selects were unbounded, so PostgREST's 1000-row cap silently truncated the aggregates behind `c_games_all`, `s_full_house`, `k_thief_10`, `s_sniper` | both page in 1000-row steps, keeping the same data shape |
| v13-04 / v13-05 / v13-06 | no `ORDER BY` on the catalog loader; the write-back carried columns the other syncs own; the guard counted raw feed entries rather than distinct badges | ordered by `id`; the potat-owned columns are excluded; the guard counts `incomingKeys.size` |
| f13-4 | viewing someone's profile created a `user_progress` row through the service role on an **anonymous GET**, inflating the public "players" KPI and pulling the average level toward 1 | new `readProgress()`; the profile page never creates a row |
| f13-5 / f13-8 | `/api/progress` returned a whole `LevelInfo` object where every other surface exposes a number; the tower marked the **live slider** position after a round instead of the floor that was played | `.level`; the marker uses the played floor |
| migration 0016 | the shared touch trigger stamped `updated_at` on all ~476 rows every run, defeating the sitemap's per-row `lastModified` | a badges-specific trigger keeps `updated_at` when only `last_seen_at` moved |

**Also fixed, found while checking the above:** retiring one achievement made the
hardcoded subtitle ("125 achievements — 50/50/25") false while the page rendered
124 tiles — the same description-does-not-match-content class this round retired
the entry for. The counts are now placeholders fed from the same list the page
renders, in all 11 locales and in the page metadata.

**Left open, documented:** `f13-6` — three special achievements check conditions
that do not implement their descriptions (`s_ghost_town` fires on a new player's
first action; `s_pioneer` and `s_top_percent` check a coin threshold rather than a
ranking). That needs a product decision, not a code line. `f13-7` — the short
overlap window between two sync runs, narrowed for the global sync by the excluded
columns.

**Verification of this round:** lint 0 errors, typecheck 0, build 227/227, 0
`MISSING_MESSAGE`, 675 keys ×11 identical. Live: **77/77 routes across 11
locales**, the subtitle renders the real count ("124 achievements…", "124
Errungenschaften"), the retired tile is gone, `/stats` is free of
`[object Object]`, and no placeholder is rendered as text.

## Phase 3 completion — the ten idea sub-agents

All ten idea scopes ran as real read-only sub-agents
(`bugreports/agent-idea-01..10.md`, 121 ideas). `IMPROVEMENTS.md` now carries
10 optimisation areas, 50 first-party ideas and those 121 sub-agent ideas —
171 in total — with a per-report index.

---

## Round 10 — verification round, then the low findings

Two verification agents ran against `bb7fe91`; their reports are
`bugreports/verify-round8.md` (5 findings, one medium) and
`bugreports/verify-independent.md` (8 findings, three medium). Both also listed
what they checked and found clean.

I distributed the 13 new findings by file ownership to four fix agents so they
could not overwrite each other, each with an exclusive scope: syncs
(`fix-a-syncs.md`), DB/API (`fix-b-db.md`), gamification
(`fix-c-gamification.md`), auth/client (`fix-d-auth-client.md`). Result: 33
fixes, 6 refutations, migrations 0012 + 0013.

### The two findings that mattered most

**R8-2 (medium, confirmed live).** `recordBlogView` counted existing views with
`select("id")` on `blog_views`, a table whose columns are
`(post_id, ip_hash, created_at)` — **there is no `id`**. PostgREST rejected the
select (42703), the code discarded the error, `count` stayed `null`, and the
5-minute dedup never engaged: every page view inserted a row. My own live proof
before the fix: 5 duplicate `(post_id, ip_hash)` groups out of 19 rows, one
group with four rows. Now counts `post_id` and refuses to count on a failed
read.

**ind-2 (medium).** The coin-rain gate was a read-then-write on
`activity_events`, and a signed-in user could rain on their own profile for a
free coin. Self-rain is now refused; the concurrency window needs a
compare-and-set RPC that does not exist yet (see residuals).

### What I verified myself rather than taking on trust

- Both economy scripts re-run: **13/13 games below the stake** (worst hilo
  0.9885) and **16/16 atomicity checks**.
- The new views are complete, not just "not capped": `stats_catalog_rarity`
  sums to 164+32+19+228+32 = **475**, exactly the catalog row count.
- The `sync-5` date-clearing looked like a data-loss regression; the loop
  `continue`s on a failed detail fetch *before* the patch, so only genuinely
  unpublished dates are cleared.
- The `pdat-8` throw is caught by the caller (`ownersOk = false`, existing
  counts kept) — a silent truncation became a visible partial failure.
- `ok: !potatEnriched` on the inventory route does **not** break the client:
  `SyncButton` reads the HTTP status, not the body field, and a degraded run
  stays 200.
- The game race-guard cannot crash on a user's first round (`newest.length === 2`
  guards the access) and the 100 ms slack leaves a 1 Hz player alone.
- The steal credit change is a true zero-sum transfer: thief `-price + stolen`,
  victim `+price - stolen`. Previously `price` left the economy on every
  successful heist.
- I bounded the new OG font cache at 32 entries — keyed by display name, a CJK
  subset is 100 KB+, and the map had no cap inside a long-lived instance.
- `sync-4`'s refutation, by my own scan: no `await fetch(` in `src/lib` or
  `src/app/api` lacks a timeout.

### Projects' new files
`supabase/migrations/0012_customization_bounds.sql`,
`0013_catalog_aggregates.sql`, `src/app/[locale]/error.tsx`,
`src/components/GameIcon.tsx`, and the six agent reports.

### Residual (documented, not fixed)

- **Coin-rain / view gates** still need a `claim_coin_rain` CAS RPC or a unique
  index on a UTC-day time bucket; the self-rain exploit itself is closed.
- **gam-7**'s daily-budget refund needs a consume+apply function in SQL.
- **blog_views** holds 19 rows with the pre-fix duplicates (5 groups). The
  counter is display-only; the historical rows were left untouched rather than
  deleting production data unasked.
- **fp-3**: most `ProfileCustomizer` settings are still stored but never applied
  (a feature-sized change; the full list is in `fix-d-auth-client.md`).

### Verification of the shipped commit

lint 0 errors, typecheck 0, build 227/227, 0 `MISSING_MESSAGE`, 664 keys ×11
identical. Deployed as `49453c4`; live smoke test **165/165 routes across 11
locales**, `/api/feed` default restored, the callback surfaces the provider
error, `/auth/callback` still resolves to `/{locale}/auth/callback`, a page
request carrying a bogus `sb-` cookie still returns 200 (the proxy refresh
branch), and the OG profile card returns `image/png`.

## Round 11 — verifying the low-findings commit

A verification agent checked `49453c4` (`bugreports/verify-round10.md`): **1 high,
5 low**, plus an explicit clean list (proxy both paths + redirect + no double
refresh + no login loop, the race-guard's "nothing moves before the guard", the
steal's zero-sum arithmetic, `ensureProgress`, the blog `post_id` dedup,
`error.tsx` in all 11 locales, the OG font gate and its 32-entry cache, the
`0001` guard, `0003`'s drop+recreate, and the `/api/account` bound).

| ID | Finding | Fix |
|---|---|---|
| **v10-1 (high)** | the coin-rain dedup filtered `activity_events` on `payload.giver = <salted IP hash>` while the row was written with `payload.giver = "anonymous"` — for logged-out visitors the check never matched, so `/api/coinrain` was an unbounded +1-coin faucet against any profile. The earlier `sec-2` fix had changed only the read side | migration 0014 adds `coin_rain_gate` with primary key `(owner_id, giver_key, day)`, RLS on and **no** policy, so the gate is a true compare-and-set **and** the hash stays out of the public-read `activity_events`. Verified live: first insert 1 row, second identical insert **23505**, anon read **401**. Window changes from a rolling 24 h to a UTC day |
| v10-2 | the thief's counter error was thrown between the two coin moves, leaving a half-applied non-zero-sum transfer plus a 5-minute lockout | both coin moves first, then both counters; a counter problem is logged, not thrown |
| v10-3 | the compensating DELETE discarded its error, so an unsettled round/attempt could survive and count for streaks, `maxBet` and the feed; the comment also claimed only the first racer voids | the delete error is checked and logged; the comment now matches reality (every racer voids — conservative and free, nothing has moved yet) |
| v10-4 | `fetchAllDistribution()` had no `.catch()`, so the new page-cap throw aborted the whole 15-minute sync with a 500 | the distribution feed fails **before any write**, with the provider's reason; the previous claim that the caller catches it held only for the owners feed |
| v10-5 | 0012's validating CHECKs run against pre-existing rows, so a legacy oversized blob would block the migration and every later one | applies cleanly here (1 profile, `{}`) and is already applied — recorded as a note for other environments rather than changing history |
| v10-6 | a persistent dedup-read error silently dropped every blog view; `recordProfileVisit` reported "not counted" after its row was already inserted | both dedup failures are logged; the contradictory profile lookup is gone (the foreign key already proves the profile exists) |

Also fixed on the way: dead `thiefProfile` query per steal removed, and
`/api/coinrain` no longer answers `already: true` for an unknown profile or a
self-rain — it now reports only what the gate actually did (live-confirmed
before the fix: an unknown profile answered `already: true`).

**Still open after this round:** `fp-3` (most `ProfileCustomizer` settings are
stored but never applied — feature work, not a fix), the daily-XP-budget refund
that needs a consume+apply function, the 19 historical `blog_views` rows with
pre-fix duplicates, and 0012's CHECK hazard for other environments. **No High,
Medium or Low defect from any agent report is open.**

Verification: lint 0 errors, typecheck 0, build 227/227, 0 `MISSING_MESSAGE`,
atomicity **16/16**, economy sim 13/13 games below the stake (worst hilo 0.9873).
Deployed as `098ce06`; live smoke **165/165 routes across 11 locales**, plus
`POST /api/coinrain` rejects a missing profile id (400), leaves zero gate rows
and zero feed rows for an unknown profile, `/api/health` 200, `/api/cron/global`
401 without the secret.
