# Round 15 verification — `da1733c` (achievements/sync batch) + `b27d4b5` (docs)

Verifier pass over the newest code commit. Read-only review plus live probes:
direct Postgres/PostgREST reads with the service role, execution of the
`achievements.ts` module to count the real catalog, and two real sync runs
(`runBadgebaseSync` then `runGlobalSync`, called directly so no heartbeat
fiction is introduced).

No project file was modified except this report. The only production writes are
the two changelog rows the runs themselves emit (ids 293 "Drop-window listing
sync completed", 294 "Catalog sync completed") — disclosed at the end.

Result: **0 high, 2 medium, 2 low.** Four areas attacked are clean (below).

---

## Findings

### v15-01 — medium — server — `src/lib/syncs/badgebase.ts:111–127`
(with `src/app/api/cron/global/route.ts:47`, `src/app/api/cron/badgebase/route.ts:15`,
`src/lib/health.ts:48–62`)

```ts
if (activeCards.length === 0 && allBadges.some((row) => row.is_confirmed_active === true)) {
  console.warn("[badgebase] /active listing is empty … skipping this run");
  return { activeCards: 0, …, skipped: "empty-listing" };
}
```

**Evidence.** `withHeartbeat` accepts a `summarize` callback that becomes the
heartbeat `payload`, and **every caller omits it** — `cron/global/route.ts:47`,
`cron/badgebase/route.ts:15` and `scripts/sync-badgebase.ts:8` all call
`withHeartbeat("sync/badgebase", () => runBadgebaseSync())` with two arguments,
so `recordHeartbeat` is invoked with `payload: null` (`health.ts:56–61`). Nothing
in `src/` or `scripts/` reads `summary.skipped` (grep: the string appears only at
`badgebase.ts:125`). The skip therefore writes **no changelog row** (the
`logChange` at `:297` is unreachable on this path) and a heartbeat with
`status: "ok"` and an empty payload.

**Why it is a bug.** The commit message and `AGENT-AUDIT.md` round-15 both claim
the skip "is reported in the summary … **and the heartbeat**". It is not: the
heartbeat is the documented single source of truth for uptime (`AGENTS.md`:
"`system_heartbeats` stays the single source of truth"), and it stays green while
the sync does nothing. The guard cannot distinguish a genuinely empty drop
window from a **parser regression** (badgebase.de dropping `data-status`) or a
provider incident, so a silent skip can now persist indefinitely: confirmed-active
rows keep `status: "active"` forever (this sync is the only writer that clears
`is_confirmed_active`), and any badge the global sync inserts while the listing is
unparseable stays `expired` because badgebase never confirms it. Pre-commit this
state was a loud 500 + error heartbeat every tick; the fix traded the noise for
total silence. The old failure was reported as the defect; the replacement
removed the only alert channel without adding one.

**Confidence.** High. `withHeartbeat` arity is visible at three call sites;
`health.ts:60` sets `payload: summarize ? summarize(result) : null`; no reader of
`skipped` exists; two live `sync/badgebase` heartbeats in the table carry
`payload` null.

**Fix direction.** Pass a `summarize` that surfaces the skip
(`(s) => ({ skipped: s.skipped ?? null, activeCards: s.activeCards })`), or have
`runBadgebaseSync` record a `degraded` heartbeat itself when it skips, so the
condition is visible on `/stats` instead of only in a serverless log line.

---

### v15-02 — medium — i18n / SEO — `messages/*.json:284`, `messages/*.json:635`
(with `src/app/[locale]/stats/page.tsx:816,836–838`, `src/app/[locale]/faq/page.tsx:19,57–64,67–69`)

```json
"stats": { … "achSubtitle": "125 goals across three tiers" }        // :284, all 11 locales
"faq":   { … "achievementsA": "125: 50 common milestones, 50 creative challenges and 25 truly unexpected specials. …" } // :635
```

**Evidence.** The commit retired `k_sharer`, taking the active catalog from 124 to
123 (verified by executing the module: 50 common + 48 creative + 25 special =
123; `ACHIEVEMENTS.length` = 124). `6ece4e6` templated **only** the
`/achievements` subtitle, and `da1733c`'s own docs assert "the page states that
number by itself". Two other live surfaces still hardcode the old count:

- `/stats` renders `t("achSubtitle")` as the section head
  (`stats/page.tsx:816`) while the same section prints
  `{achievementCatalogSize}` = 123 (`:836–838`), computed from `ACH_BY_ID`
  (`:287–290`). The page contradicts itself in all 11 locales — e.g. English
  "125 goals across three tiers" above "123 achievements".
- `/faq` renders `t("achievementsA")` (`faq/page.tsx:19` in `FAQ_KEYS`, rendered
  at `:67–69`) **and emits it as the `FAQPage` JSON-LD `acceptedAnswer`**
  (`:57–64`), so search engines are fed the wrong number. All 11 locales.
- The published post `blog_posts.slug = "achievements-system-125-trophies"`,
  title "125 Achievements: The Complete Trophy Wall" (live, published 2026-09-20),
  and its seed source `scripts/seed-gamification-blog.ts:54–59,132` carry the same
  claim.

**Why it is a bug.** The same "description does not match content" class this
round explicitly retired an achievement for; the round-14 fix was applied to one
of the four surfaces. The number is machine-generated on `/stats` and `/faq`
(the FAQ has no live count to show), so a static "125" is a false claim on a
public, indexable page.

**Confidence.** High (grep of all message files: `achSubtitle` and
`achievementsA` contain `125` in every locale; module executed for the 123;
live row queried for the blog post).

**Fix direction.** Template both strings like the `/achievements` subtitle, or
drop the number ("all achievements across three tiers" / "Every achievement
awards XP…") since neither page can feed it live at render time. Same for the
blog post title.

---

### v15-03 — low — server — `src/lib/gamification/achievements.ts:196–199, 245–260, 266`

**Evidence.** The round-14 advice (`verify-round14.md`, v14-09) was to "remove
`k_faq_scholar` from `ACHIEVEMENTS` entirely and keep only its tombstone comment".
The commit did the **opposite and inconsistently**: it kept `k_faq_scholar` in
`ACHIEVEMENTS` with `() => false` and an inline comment ("this line only keeps the
entry's metadata"), but it **deleted the `k_sharer` line outright** — there is no
`k_sharer` entry any more:

```
RETIRED_ACHIEVEMENT_IDS = new Set(["k_faq_scholar", "k_sharer"])   // :260
ACHIEVEMENTS.length === 124        // not 125; k_sharer is gone
ACH_BY_ID.size === 123             // k_faq_scholar filtered
```

So `RETIRED_ACHIEVEMENT_IDS` contains an id that exists in no list, the docblock
("Achievements whose described condition no code can observe … delete the id
from this set") describes an id that is not present, and the promised "metadata
kept" exists for one retired id only.

**Why it is a bug (latent).** `k_sharer` was *reachable* before this commit
(`stealVisits = distinctVisitors >= 10`, a lower bar than `k_popular_25`), so a
user could already hold a `user_achievements` row for it. Such a row would
silently disappear from the profile hero (`profile/[username]/page.tsx:407` —
`ACH_BY_ID.get` returns `undefined`, `if (!achievement) return null`) while the
header chip still counts it (`unlockedAchievements.length`, `:402`), and if it
ever surfaced in the `/stats` "rarest" list it would render the **raw id**
("k_sharer") as the title (`stats/page.tsx:865`, `meta?.title ?? row.achievement_id`).
Live check: **0 `k_sharer` and 0 `k_faq_scholar` rows** in `user_achievements`
(the 13 distinct unlocked ids are all active entries), so no user is affected
today — the inconsistency is real but currently inert.

**Confidence.** High on the code/state facts (module execution + row counts);
the impact is conditional on a future/past unlock, currently zero.

**Fix direction.** Pick one convention: either restore the `k_sharer` line as a
`() => false` tombstone next to `k_faq_scholar`, or delete `k_sharer` from
`RETIRED_ACHIEVEMENT_IDS` and fix the docblock — and filter the profile chip and
the `/stats` rarest title through `ACH_BY_ID` so a stale row can never surface as
a raw id.

---

### v15-04 — low — client — `src/components/games/TowerGame.tsx:31,45`
(with `src/lib/gamification/games.ts:486`)

```ts
cashoutAt: typeof raw.cashoutAt === "number" ? raw.cashoutAt : undefined,   // :31
const playedFloor = last ? (last.cashoutAt ?? last.floor) : cashoutAt;      // :45
```

**Evidence.** The tower resolver always returns both fields — on survival and on a
crash:

```ts
const cashoutAt = clampInt(input.cashoutAt ?? 5, 1, 10);   // the REQUESTED target
let floor = 0;
while (floor < cashoutAt) { floor += 1; if (Math.random() < failChance) { survived = false; break; } }
return { payout, result: { cashoutAt, floor, survived, top: … } };   // games.ts:474–486
```

`cashoutAt` is present for every outcome, so `last.cashoutAt ?? last.floor` never
evaluates the fallback — the `?? last.floor` branch is dead and the comment "the
floor the round actually settled on" is false: `floor` is the settled floor,
`cashoutAt` is the requested target.

**Why it is a bug.** On a crash at floor 2 with the slider at 7, `playedFloor = 7`,
so the "← cash out" marker sits on **floor 7** and floors 3–7 all render red
(`reached = floor <= 7`, `survived = false`) as if they were climbed and failed.
The pre-commit expression (`last ? last.floor : cashoutAt`) marked the actual
crash floor and rendered only floors 1–2 — this commit **regressed crash
rendering** while claiming the opposite ("marks the floor the round ended on after
a crash"). The stated fix is not achieved by the code it shipped.

**Confidence.** High (server return is unconditional; the `??` is unreachable).

**Fix direction.** Use `last.survived ? last.cashoutAt : last.floor` if the
intended UX is "marker on the target reached only when it survived", or revert to
`last.floor`, and correct the comment.

---

## Checked and found clean

1. **`badgebase.ts` guard data/position (v14-03/04).** `allBadges` is loaded at
   `:84–90`, before the guard at `:111`, and the guard precedes every write
   (`:204` update, `:216` insert upsert, `:291` sweep upsert, `:297` logChange).
   The field name is right — the 21 confirmed-active rows carry
   `is_confirmed_active === true` (queried). Latent note: `select("*")` has no
   `.order()`/pagination, so past PostgREST's 1000-row cap the guard and the sweep
   would see a truncated catalog; the catalog is **476 rows**, so unreachable now
   (the global sync does paginate, so it is not exposed to this).
2. **`BadgebaseSyncSummary` consumers (v14-02 aftermath).** Exactly three:
   `cron/global/route.ts:47`, `cron/badgebase/route.ts:15`,
   `scripts/sync-badgebase.ts:8`. All JSON-serialize or ignore it; the added
   optional `skipped` field breaks none of them. (That none *reads* it is
   v15-01, not a type break.)
3. **`achievements.ts` type/retirement consistency.** No `stealVisits` or
   `faqVisits` remains anywhere in `src/`, `scripts/` or `messages/`; no `faqRes`
   or `__retired__` query remains (`grep` empty). `AchStats` has no importer
   outside `achievements.ts`. `evaluateAchievements` loops `ACTIVE_ACHIEVEMENTS`
   (`:290`) and `ACH_BY_ID` is built from it (`:266`), so both retired ids are
   excluded from evaluation and UI. `() => false` sits only on a retired id, so it
   cannot make a live achievement unreachable.
4. **`pageAll` shapes (v14-06).** `profile_visits` is
   `(id, profile_id, visitor_id, ip_hash, created_at)` (migration 0003), so both
   `pageAll` reads (`profile_id` by `visitor_id`; `ip_hash` by `profile_id`) are
   valid and both are `.order("id")` + `.range()`. `pageAll` returns `{data,error}`,
   consumed as `.data` at `:524/:549`. `distinctVisitors` is a `Set<string>` of
   `ip_hash` (`:510–512`) and `profilesVisited` a `Set` of `profile_id` — distinct
   values, not row counts. The 14-way `Promise.all` destructuring is correctly
   aligned with all 14 array entries.
5. **`global.ts` exclusion set (v14-07).** `vercel.json` schedules only
   `/api/cron/global` (06:00) and `/api/cron/potat` (06:30); badgebase runs *inside*
   the global cron at `route.ts:47`, i.e. **after** `runGlobalSync`, so the
   badgebase values win on every scheduled run. Global still reads
   `ex.start_date`/`ex.end_date`/`ex.is_confirmed_active` from its own snapshot for
   `resolveStatus` (`:210–217`) — those reads are unaffected by omitting the columns
   from the write-back. Real runs reproduced the documented pair: badgebase
   `enriched: 41`, then global `added 0 / updated 0 / removed 0 / statusChanged 0`,
   and all 21 confirmed-active rows still carry `status: "active"` with no
   confirmed-but-not-active rows — nothing was reverted. **Observation (same class,
   not covered):** `is_paid` is also badgebase-written (`badgebase.ts:174–175`) and
   is *not* in the exclusion set, so an out-of-band badgebase→global sequence with a
   stale snapshot could still ping-pong it; latent because global's snapshot already
   contains badgebase's value in the fixed order.
6. **Profile page level/progress (v14-08).** `level = levelFromXp(progressRow?.xp ?? 0)`
   is inside `if (profile)`, and `levelFromXp(0)` returns level 1
   (`levels.ts:25–40`), so the badge and XP bar render for a member with no row.
   Both remaining `progress` reads are null-safe (`:280` ternary, `:402` optional
   chaining); no unguarded dereference exists, and `readProgress` is read-only
   (`xp.ts:88–97`, `maybeSingle`, no upsert).
7. **The count claim itself.** Executed `achievements.ts`:
   `ACTIVE_ACHIEVEMENTS.length === 123` (50 common / 48 creative / 25 special);
   `ACHIEVEMENTS` is 124, `ACH_BY_ID` is 123, both retired ids filtered. No
   `123`/`124` is hardcoded anywhere in `src/` or `messages/`; the only `125`
   strings are the v15-02 surfaces.

## Real runs observed (this machine)

```
BADGEBASE_SUMMARY {"activeCards":21,"upcomingCards":20,"enriched":41,"inserted":0,"demotedToExpired":0,"errors":0}
GLOBAL_SUMMARY    {"source":"ivr","versions":476,"added":0,"updated":0,"removed":0,"statusChanged":0,"addedTitles":[]}
```

Both match the commit's gate figures. Catalog stayed at 476 rows; the 21
confirmed-active rows were not cleared and nothing was demoted; no badge, profile,
progress or visit row changed.

**Production writes left behind by the sanctioned runs:** `changelog` ids **293**
("Drop-window listing sync completed") and **294** ("Catalog sync completed") —
neutral `data_sync` wording emitted by the syncs themselves. Because the runner
called the sync functions directly, **no** `system_heartbeats` row was written
(the newest heartbeat remains id 77 from the commit's own runs). No other probe
wrote anything.