# Round 14 verification — `ac85046` (sync/achievements/a11y batch) + `6ece4e6` (i18n subtitle)

Verifier pass over the two newest code commits. Read-only code review plus live
probes: direct Postgres reads (pooler), real `sync-badgebase` / `sync-global`
runs, one rolled-back trigger experiment, and live fetches of the production
deployment (which is at `9feab40` = `origin/main`, so the live checks exercise
these exact commits).

No project file was modified. The one write side effect is the pair of syncs the
brief sanctioned: 3 `changelog` rows (ids 287–289) and 3 `system_heartbeats`
rows, as disclosed at the end.

Result: **0 high, 2 medium, 7 low.**

---

## Findings

### v14-01 — medium — server — `src/lib/gamification/achievements.ts:551` (with `:546`)

```ts
visitorsCount: distinctVisitors,                 // line 546
...
stealVisits: distinctVisitors,                   // line 551
```

**Evidence.** `f13-2` repointed `stealVisits` at `profile_visits`, but it points
it at the *same* value `visitorsCount` already holds — both are the cardinality
of the identical `distinctVisitors` set built once at lines 510–512 from
`profile_visits.select("ip_hash").eq("profile_id", userId)`. So `k_sharer`
("Influencer", `stealVisits >= 10`, line 199) and `k_popular_25`
("Local Celebrity", `visitorsCount >= 25`, line 184) are now the same condition
at two thresholds, and nothing anywhere reads a share/steal-link signal: grep
finds no writer of anything resembling a link referral, and the live table has
no column for one (`profile_visits(id, profile_id, visitor_id, ip_hash,
created_at)`).

**Why it is a bug.** Two defects in one line. (a) The description is false: the
achievement promises "Get 10 visits through your steal/share link" while it is
awarded for 10 distinct IPs visiting the profile by any route — exactly the
description-does-not-match-the-condition class this round retired
`k_faq_scholar` for and left `f13-6` open for, now re-created by the fix itself.
(b) It makes a second creative achievement trivially redundant with an existing
one, so the catalog's 124 entries are not 124 distinct things to hunt.

**Confidence.** High (the identity of the two values is a two-line code fact; the
absence of any share-link signal is a failed grep plus the table's column list).

**Fix direction.** Either reword `k_sharer`'s description to what the data
supports ("Get 10 different visitors to your profile") *and* change its
threshold so it is not a prefix of `k_popular_25`, or add a real share signal
(the share URL already carries `?ref=`-shaped intent; a `payload.ref` on
`activity_events`, or a `ref` column on `profile_visits`, would make the
description true), or retire it like `k_faq_scholar`.

---

### v14-02 — medium — server — `src/lib/syncs/badgebase.ts:105–114`

```ts
if (
  activeCards.length === 0 &&
  [...byUuid.values(), ...bySetId.values()].some(
    (row) => row.is_confirmed_active === true,
  )
) {
  throw new Error("drop-window listing is empty while confirmed-active badges exist — refusing to clear confirmations and demote badges");
}
```

**Evidence.** The comment above it claims: "a genuinely empty window must not
block this sync forever". It does. `is_confirmed_active = true` is cleared in
exactly one place in the whole repository — this same function's sweep
(`:266–275`, `sweepRows.push({...row, is_confirmed_active: confirmed})` → upsert
`:277–282`). Grep over `src/`, `scripts/` and `supabase/migrations/` shows every
other occurrence of the flag is a read (`potat.ts:174`, `global.ts:207`,
`types.ts:149`) or a migration-era one-off (`0005`). So the moment any row is
confirmed-active, the guard's second conjunct is permanently true and the only
code that could ever falsify it is the run the guard is refusing to perform.
Live: **21** rows currently carry `is_confirmed_active = true` (`conf` probe),
so today an empty or unparseable `/active` page freezes the entire enrichment
sync — no enrichment, no demotion, no `last_seen_at` refresh, an error heartbeat
every run — until badgebase's listing becomes non-empty again on its own.

**Why it is a bug.** The guard is meant to distinguish "provider incident"
(block) from "legitimately empty window" (proceed). The condition it tests
cannot tell them apart, so it always blocks, and the state that triggers it
never expires. A safety check that can only be cleared by an external party is a
liveness bug, and the comment asserts the opposite of the behaviour, which is
how it survived review.

**Confidence.** High on the deadlock (provable from the code: no other clearing
writer exists); the "how likely is an empty window" part is judgement, not
evidence.

**Fix direction.** Make the block bounded or stateful: e.g. allow the sweep when
`activeCards.length === 0` and the previous run *also* saw an empty listing (one
extra column on the heartbeat payload, or a small `sync_state` row), or scope the
clear to rows whose detail page was fetched this run instead of clearing
everything at once.

---

### v14-03 — low — server — `src/lib/syncs/badgebase.ts:107`

**Evidence.** The guard asks the deduplicated maps, not the catalog:
`bySetId` is populated with `if (!bySetId.has(row.set_id))` (`:96`), i.e. one
row per `set_id` — the *first* in `allBadges` order — and `byUuid` keeps the
*last* row per extracted image UUID (`:95`). A confirmed-active row that is not
its set's first version **and** whose `image_url_1x`/`_2x` carry no
`/badges/v1/<uuid>` match is therefore absent from both maps and invisible to
the check.

**Why it is a bug.** This is a false negative on a catastrophic action: with the
guard not firing, the sweep clears `is_confirmed_active` on every row and
demotes every dateless badge to `expired` — the exact incident the guard exists
to prevent. `allBadges` is in scope and is the complete list; the maps are a
lossy projection of it.

**Confidence.** Medium. The code path is certain; the input that triggers it
(a confirmed-active badge with no UUID-bearing artwork that is not its set's
first version) is not present in today's 476 rows.

**Fix direction.** `if (activeCards.length === 0 && allBadges.some((row) => row.is_confirmed_active === true))`.

---

### v14-04 — low — server — `src/lib/syncs/badgebase.ts:106` (with `src/lib/twitch/badgebase.ts:71–72`)

**Evidence.** The guard counts *parsed cards*, not *active* cards. The listing
parser pushes a card for either status:

```ts
const status = attr(block, "data-status");
if (status !== "active" && status !== "upcoming") continue;
```

so `fetchBadgebaseListing("/active")` can return a non-empty array in which
every card is `status: "upcoming"` — a layout change, or a page served from the
wrong template, is enough. The guard then passes (`activeCards.length !== 0`),
`confirmedActive` is `false` for every card (`:149`), and the run clears every
confirmation and demotes every dateless badge. `activeKeys` (`:123–127`) is
built after the guard and is the thing that actually encodes "the listing
vouched for nothing".

**Why it is a bug.** Same class as `v14-03` but reachable from the *provider
side* rather than from catalog shape: the guard's premise should be "the
listing confirmed zero badges", which the card count does not express.

**Confidence.** Medium-high on the mechanism; the current page is benign —
I parsed the live listing: `/active` → 21 cards, all `status: "active"`, all
with a UUID; `/upcoming/` → 20 cards, all `"upcoming"`.

**Fix direction.** Move the `activeKeys` construction above the guard and test
`activeKeys.size === 0` (the guard's own message already says "listing is empty
while confirmed-active badges exist").

---

### v14-05 — low — client — `src/components/games/TowerGame.tsx:37–40`

```ts
const playedFloor = last ? last.floor : cashoutAt;
const reached = floor <= playedFloor;
const survived = last ? last.survived : true;
const isCashout = floor === playedFloor;
```

**Evidence.** The server's tower result is
`{ payout, result: { cashoutAt, floor, survived, top } }`
(`src/lib/gamification/games.ts:473–487`); on a failure `floor` is the floor that
*failed* and `survived` is false. `isCashout` therefore puts the accent border and
the literal "← cashout" label (`:58–62`) on the floor that crashed: a busted round
renders "floor 3 ← cashout" in the danger colour. The client stores only
`floor/survived/payout` in `last` (`:20–24`) and discards `result.cashoutAt`, the
one field that identifies the intended cash-out floor.

**Why it is a bug.** `f13-8` correctly fixed the *reached* range (floors above the
played floor no longer light up) but swapped the marker's meaning from "the floor
you aimed at" (the live slider — wrong after a round) to "the floor the round
ended on" (wrong when it ended in a crash). The row now claims a cash-out that
did not happen.

**Confidence.** Medium-high (the label on a crashed floor is objectively wrong;
impact is cosmetic, the payout text below the grid is correct).

**Fix direction.** Keep `playedFloor = last ? last.floor : cashoutAt` for
`reached`, and use a separate marker: carry `cashoutAt` out of `raw` into `last`
and use `const markerFloor = last ? (last.survived ? last.floor : last.cashoutAt) : cashoutAt;`
for `isCashout` (falling back to `cashoutAt` when the field is absent).

---

### v14-06 — low — server — `src/lib/gamification/achievements.ts:428–435`

```ts
supabase.from("profile_visits").select("profile_id").eq("visitor_id", userId).limit(1000),   // :428
...
supabase.from("profile_visits").select("ip_hash").eq("profile_id", userId).limit(1000),      // :435
```

**Evidence.** Both new/changed reads keep a bare `.limit(1000)` with no
`.order()`. PostgREST caps a response at 1000 rows, which is exactly the silent
truncation `f13-3` fixed two entries earlier in the same commit (there it added
`pageAll` with `.order("id")` + `.range()`). The rows are unordered, so a user
past the cap gets an *arbitrary* 1000-row subset, not the newest or oldest.

**Why it is a bug.** `profilesVisited` feeds `k_spy` (50 distinct profiles) and
the `ip_hash` set feeds `visitorsCount` **and** `stealVisits` (v14-01). A
truncated subset undercounts all three; the direction of the error is
unpredictable because the subset is unordered.

**Confidence.** High on the code fact; not yet reachable — live
`profile_visits` has 5 rows, `game_rounds` and `steal_attempts` have 0.

**Fix direction.** Run both through the same `pageAll` helper with
`.order("id")` (`profile_visits.id` is `bigint generated always as identity
primary key`, so it is a valid cursor), or replace the counts with two `.select(..., { count: "exact", head: true })`-style aggregates over a `distinct` view/`group by`.

---

### v14-07 — low — server — `src/lib/syncs/global.ts:134–144` and `:221–224`

**Evidence.** The write-back is a blacklist: everything in the snapshot row
except `id, created_at, updated_at, owner_count, active_count, percentage,
last_polled_at, rarity_score, rarity_tier` is re-sent on every run
(`upsertsExisting.push({ ...existingWithoutId, ...patch })`). The columns
badgebase owns — `is_confirmed_active`, `start_date`, `end_date`,
`release_date`, `how_to_earn`, `status`/`removed_at` — are not in it. The
commit's own justification for the list ("writing them back from a snapshot
taken at the start of this run would revert anything those syncs wrote in
between") applies verbatim to those columns.

**Why it is a bug.** It is the residual half of `f13-7`, and it has a concrete
consequence the potat half does not: a global run that overlaps a badgebase run
writes `is_confirmed_active: false`/stale dates back over the fresh
confirmation, so a genuinely redeemable badge loses `active` until the next
drop-window sync. Two independent triggers exist (`/api/cron/global` runs
global→badgebase in sequence, but `/api/cron/badgebase` is a separate route that
nothing schedules today and can be invoked out of band), so the window is narrow
but real.

**Confidence.** Medium (mechanism certain; requires a concurrent run to bite).

**Fix direction.** Invert the list: build `upsertsExisting` from a whitelist of
the columns this sync actually computes (`set_id, version, slug, title,
description, image_url_*, click_url, category, is_paid, source, first_seen_at,
last_seen_at, status, removed_at, is_confirmed_active` only when this run
computed it) instead of "the whole row minus everything another writer owns" —
a blacklist has to be updated by whoever adds a column, which is how
`is_confirmed_active` was missed.

---

### v14-08 — low — client/server — `src/app/[locale]/profile/[username]/page.tsx:209–229` (uses `:262`, `:270–280`)

**Evidence.**

```ts
// Gamification: level (badge ALWAYS visible), coins, achievements, visitors.
let progress: Awaited<ReturnType<typeof readProgress>> = null;
...
progress = progressRow;
if (progressRow) level = levelFromXp(progressRow.xp);
```

with `{level && <LevelBadge level={level.level} size={64} />}` (`:262`) and the
XP bar gated on the same `level` (`:270`). `readProgress` returns `null` for a
member who has no `user_progress` row, and the page no longer creates one.
Nothing crashes — every other use is guarded (`:277`, `:399`) — but the level
badge and the XP bar disappear, where before the profile page's `getProgress`
created the row and a level-1 badge was rendered.

**Why it is a bug.** The comment directly above the code still promises "badge
ALWAYS visible", and the row is not guaranteed: `user_progress` is only created
by `ensureProgress` (`daily.ts:18`, `wheel.ts:46`), by `getProgress` for the
*signed-in* user (`games/page.tsx:46`, `achievements/page.tsx:55`,
`/api/progress`) or by an award. A member who has never claimed, spun, played or
opened /games shows no level at all on their public profile. The `f13-4` fix
itself is correct (verified below) — this is its unhandled UI consequence.

**Confidence.** High on the behaviour; low on how often it is visible (the live
DB holds exactly **1** `user_progress` row against 1 profile, so nobody is
affected today).

**Fix direction.** Either render a neutral "no level yet" state / a level-1 badge
from `levelFromXp(0)` when `progress` is null, or fix the comment if hiding the
badge is the intent. Do not go back to creating the row — that reintroduces
`f13-4`.

---

### v14-09 — low (nit) — server — `src/lib/gamification/achievements.ts:419–425` (with `:52`, `:198`, `:556`)

**Evidence.** Retiring the achievement left its probe in the `Promise.all`:

```ts
supabase.from("activity_events").select("id", { count: "exact", head: true })
  .eq("user_id", userId).eq("kind", "__retired__"),
```

It is awaited on every `evaluateAchievements` call (i.e. after **every** award,
game round, wheel spin, steal and login claim) and can only ever return 0.
`faqVisits` is still carried in `AchStats` (`:52`), still populated (`:556`),
and still read by the still-present `k_faq_scholar.check` (`:198`) — a check no
code path can now reach, since both the evaluation loop (`:284`) and `ACH_BY_ID`
(`:260`) use `ACTIVE_ACHIEVEMENTS`.

**Why it is a bug.** Not a defect — dead weight on the hottest write path, plus
a comment ("Kept in place so the destructuring … is unchanged") that preserves
garbage for destructuring's sake.

**Confidence.** High.

**Fix direction.** Drop the query and let the destructuring shrink (`_faqRes`),
or replace that slot with `Promise.resolve({ count: 0, data: [] })`; remove
`k_faq_scholar` from `ACHIEVEMENTS` entirely and keep only its tombstone comment
in `RETIRED_ACHIEVEMENT_IDS`'s docblock.

---

## Checked and found clean

**1. `badgebase.ts` guard position and map population.** The catalog loop
(`:92–97`) completes before the guard (`:105`); the only statement between them
is the `allBadges` select. Every write in the function — the per-row `update`
(`:191`), the insert upsert (`:203`), the sweep upsert (`:277`) and the
`logChange` (`:284`) — is after it. `bySetId` is fully populated at that point
(one row per `set_id`, first wins). It cannot fire when the listing has cards
(`v14-04`'s weaker premise aside); it *can* fire forever on an empty one
(`v14-02`).

**2. The description ping-pong.** Reproduced with real runs immediately after the
commits, on the exact sequence that used to break:
`sync-badgebase` → `{activeCards: 21, upcomingCards: 20, enriched: 41, inserted:
0, demotedToExpired: 0, errors: 0}`, then `sync-global` → `{source: "ivr",
versions: 476, added: 0, updated: 0, removed: 0, statusChanged: 0}` — twice in a
row, both 0/0. Before the fix that pair reported `updated: 41`. (a) Stable. (c)
Inserts still get a description: the insert payload still carries
`description: detail.description` (`:209`), and the three live
`source = "badgebase"` rows sampled all have one. (b) Nothing lost a
description: all 21 confirmed-active rows and all 20 `upcoming` rows have one,
and all 21 active rows also still carry the badgebase-written `how_to_earn`; the
28 empty descriptions in the catalog all belong to the `bits` set (`expired`,
`source = ivr`), which badgebase's listings never match, so the old write was
never what filled them.

**3. `pageAll`.** Terminates: `if (page.length < PAGE) break` after each
1 000-row page, so an exact multiple costs one extra empty request and stops.
Shape is preserved — both call sites consume `{ data }` and nothing reads the
returned `error`, so `({ data, error })` is a superset of what
`supabase.from(...)` returns. Both are ordered by `id`, which is the cursor the
`range()` steps need. Live row counts (0 `game_rounds`, 0 `steal_attempts`) mean
the truncation was theoretical; the fix is still correct. One residual note: a
mid-pagination error returns the partial page with the error, and the caller
ignores it, so a partial aggregate can be silently used — same as before the
change. Second note: paging assumes the server's max-rows is ≥ 1 000 (it is;
requesting exactly `range(from, from+999)` returns 1 000).

**4. Repointed visit signals.** `recordProfileVisit(profileId, visitorId,
ipHash)` inserts `{ profile_id, visitor_id, ip_hash }` (`visits.ts:30–32`) and is
called with `viewer?.id ?? null` (`profile page:91`), so `profile_id` is always
populated and `visitor_id` exactly when the visitor is signed in — which is what
`profilesVisited`'s `.eq("visitor_id", userId)` needs. Live `profile_visits`: 5
rows, 0 with a `visitor_id` (all logged-out), so `k_spy` is currently 0 for
everyone and reachable only through signed-in viewing — the intended semantics.
The old `activity_events` kinds it replaced are confirmed dead: 0 rows with
`kind in ('profile_visit','steal_visit')` live.

**5. Retired achievement filtering.** One filtered list, used everywhere it
matters: `ACTIVE_ACHIEVEMENTS` drives the UI (`achievements/page.tsx:101`), the
counts (`:24–27`, `:72–75`), the evaluation loop (`achievements.ts:284`) and
`ACH_BY_ID` (`:260`). `ACHIEVEMENTS` has no other importer anywhere in `src/` or
`scripts/`. The profile page's `ACH_BY_ID.get` returns `undefined` for a retired
id and skips the tile (`:405`). Live: `/en/achievements` renders 124 tiles,
"FAQ Scholar" appears 0 times, 0 occurrences of `k_faq_scholar`, and 0
`user_achievements` rows for it.

**6. `readProgress` / null handling.** `readProgress` never creates a row
(`select … maybeSingle`, no upsert) and throws on a read error, which the page
converts with `.catch(() => null)`. Every downstream use of `progress` is
optional-chained or gated (`:277`, `:399`), and `level` is only set when a row
exists, so no crash path. Nothing else in the app depends on the profile page
creating the row: the "players"/`avgLevel` suspects in `stats.ts` read the
`stats_gamification` view (`count(*)`/`avg(level)` over `user_progress`,
migration 0004) and are now honest — live count is 1 row. No other
`getProgress(profile.id)`-shaped call remains for a merely-viewed user.

**7. `errorMessage`.** Cannot throw for any shape I could construct: `Error`
(with/without message), Supabase's plain `{ message, code, details, hint }`
objects, `{ details: "..." }`-only objects, objects with non-string `message`,
circular objects (the `JSON.stringify` is inside `try`), `BigInt` values
(`stringify` throws → caught), `null`, `undefined`, strings, numbers, symbols.
Ordering is right: a Supabase error prints `message (CODE)`, which is what the
public page needs. One nit: an `Error` with an empty `message` falls through to
`JSON.stringify(error)` and prints `{}`. Live check: `/en/stats` contains 0
occurrences of `[object Object]`.

**8. Migration 0016.** Applied (ledger row present) and live. Exactly one
non-internal trigger on `public.badges`:
`CREATE TRIGGER badges_touch_updated BEFORE UPDATE ON public.badges FOR EACH ROW
EXECUTE FUNCTION touch_badges_updated_at()` — the same trigger *name* as 0001's,
so the `drop trigger if exists` in 0016 replaces it rather than stacking a second
one; `profiles_touch_updated` and `blog_posts_touch_updated` still call the
unconditional `touch_updated_at()`, as documented. Behaviour verified by a
rolled-back experiment on a real row: updating only `last_seen_at` left
`updated_at` at its previous value; changing `title` moved it forward; after the
rollback the row was byte-identical (so production data is unmodified). Catalog
evidence: the 476 rows share 8 distinct `updated_at` values (the leftovers of
the pre-migration runs) while `last_seen_at` already carries a single fresh
value — i.e. the freshness stamp no longer moves `updated_at`.

**9. `/api/progress`.** Now returns `level: levelFromXp(...).level` (a number).
The only two consumers (`WheelOfFortune.tsx:42`, `games/useGame.tsx:28`) read
`wheelSpunToday` and `coins` respectively and never touch `level`, so nothing was
written against the old object shape — no regression, and the leftover-object
inconsistency the commit describes is real. Live unauthenticated response is
unchanged (`{"authenticated":false}`, HTTP 200).

**10. `6ece4e6` — the subtitle placeholders.** All 11 message files carry all
four placeholders (`{total} {common} {creative} {special}`, checked
programmatically) and the code passes exactly those four, in both the body and
`generateMetadata` (`achievements/page.tsx:23–28`, `:71–76`). Live render checked
in all 11 locales: each page contains the realised total (124) and the only
occurrences of a literal `{total}` are inside the serialised message catalog in
the RSC payload — the rendered `<p class="mt-1 text-sm text-muted">` reads
"124 achievements to hunt — 50 common, 49 creative, 25 truly unexpected."
(`/de`: "124 Errungenschaften zum Jagen — 50 gewöhnliche, 49 kreative, 25 völlig
unerwartete."). 50/49/25 is consistent with the retired creative entry and with
the per-section headers (`(0/50)` etc. in the payload). `/en/stats` is free of
`[object Object]`.

---

## Sync summaries observed (real runs, this machine)

```
[sync:badgebase] { "activeCards": 21, "upcomingCards": 20, "enriched": 41,
                   "inserted": 0, "demotedToExpired": 0, "errors": 0 }

[sync:global]    { "source": "ivr", "versions": 476, "added": 0, "updated": 0,
                   "removed": 0, "statusChanged": 0, "addedTitles": [] }   (run 1)

[sync:global]    { "source": "ivr", "versions": 476, "added": 0, "updated": 0,
                   "removed": 0, "statusChanged": 0, "addedTitles": [] }   (run 2)
```

Catalog stayed at 476 rows; migration ledger unchanged; the 21 confirmed-active
rows were not cleared and nothing was demoted.

**Production writes left behind by the sanctioned runs** (nothing else was
modified): `changelog` ids 287–289 — one `Drop-window listing sync completed`
and two `Catalog sync completed` `data_sync` rows, neutral wording, no provider
name — plus three `system_heartbeats` rows (`sync/badgebase`, `sync/global` ×2,
all status `ok`). Same footprint as the previous round's real runs, which are
also still in the table (ids 286 and earlier). No badge, profile, progress or
visit row was changed by any probe: the one trigger experiment ran inside a
transaction that was rolled back and the row was verified identical afterwards.