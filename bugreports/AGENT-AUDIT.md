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
