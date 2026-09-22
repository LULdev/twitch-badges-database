# Fresh audit round 13 (`f13-`) — new defects, no re-reports

Date: 2026-09-22. Independent read-only audit of `C:\Users\LUL\Twitch-Badges-Database`
after the fifteen scopes and twelve verification rounds recorded in
`bugreports/AGENT-AUDIT.md` and `bugreports/verify-*.md`. Nothing already listed
there (fixed or open) is repeated here. No project file was edited; the only
write is this report. Read-only probes used the anon/publishable key over the
REST API and the local sources; no production data was modified.

Live state observed while auditing (read-only, anon REST): 476 badges
(434 `expired`, 22 `active`, 20 `upcoming`; 472 `ivr`, 4 `badgebase`),
21 rows with `is_confirmed_active = true` (all carry an image UUID),
20 `activity_events`, 1 `user_progress`, **0** `game_rounds`, **0**
`steal_attempts`. Several findings below are therefore *latent* — they need a
data volume or a state the current single-user DB has not reached — and that is
stated per finding.

Severity counts: **0 high, 3 medium, 5 low.**

---

## f13-1 — the badgebase "empty listing" incident guard is inside the per-row catalog loop, not after it, so it can be bypassed by the last row

- **Severity**: medium (a data-loss guard that is not where its own comment says it is)
- **Side**: server / sync
- **File:line**: `src/lib/syncs/badgebase.ts:92` (`for (const row of allBadges) {`),
  `:102-108` (the guard), `:109` (`bySetId.set(...)`), `:110` (the `}` that
  closes the loop)
- **Evidence** (brace-verified, not inferred):
  ```
  92:  for (const row of allBadges) {                 open=1
  93:    const uuid = extractUuid(row.image_url_1x …) ?? …
  95:    if (uuid) byUuid.set(uuid, row);
  97:  // The /active listing is the authority … Placed after the catalog load
  102:  if (activeCards.length === 0 && [...byUuid.values(), ...bySetId.values()].some(
  104:  )) {
  105:    throw new Error("drop-window listing is empty …");
  108:  }
  109:    if (!bySetId.has(row.set_id as string)) bySetId.set(row.set_id as string, row);
  110:  }                                              close=1
  ```
  The guard (and its 8-line comment claiming it runs *after the catalog load*)
  sits between `byUuid.set` and `bySetId.set`, i.e. **inside** the loop. It is a
  patch artifact: the indentation of the guard is the function body's (2 spaces)
  while its actual nesting is the loop body's (4). It therefore runs once per
  catalog row (476× today) instead of once, and — decisively — `bySetId` is
  populated *after* the guard on the same iteration, so a confirmed-active row
  becomes visible to the guard only from the **next** iteration.
- **Consequence**: the srv-5/v12-05 protection is defeated in exactly the case it
  was written for, when the only confirmed-active row carries no parsable image
  UUID and is the **last** element of `allBadges`. `badgebase.ts:204-227` inserts
  rows with `image_url_1x: card.imageUrl` verbatim, so a card whose `imageUrl`
  is empty/null yields a row with no UUID — `extractUuid` returns null and the
  row lands in `bySetId` only. The catalog select has no `ORDER BY`
  (`:82-88`), so which row is "last" is arbitrary. In that configuration the
  guard never fires on an empty `/active` listing, the run proceeds, and the
  sweep at `:236-283` clears `is_confirmed_active` on every row and demotes
  every dateless badge to `expired` — the mass-demotion incident the guard
  exists to prevent. Today the bypass is not reachable: all 21 confirmed-active
  rows have UUIDs (live probe above), and `byUuid` catches them.
- **Confidence**: high on the structure (brace count) and on the mechanism;
  the bypass itself is a narrow state that is currently not present in the data.
- **Fix direction**: move the `if (activeCards.length === 0 && …)` block to
  immediately after the `for` loop (line 110), so `byUuid` and `bySetId` are
  both fully populated and the guard runs exactly once. A short unit test that
  feeds one confirmed-active, UUID-less row would pin it.

---

## f13-2 — three achievements can never unlock: their input events are never written anywhere

- **Severity**: medium (3 of 125 achievements permanently unreachable)
- **Side**: server / gamification
- **File:line**: `src/lib/gamification/achievements.ts:198` (`k_faq_scholar`),
  `:186` (`k_spy`), `:199` (`k_sharer`); the readers at `:362`, `:363`, `:480`,
  `:486`; the only writer of feed events, `src/lib/gamification/xp.ts:65`
- **Evidence**: the three checks read fields that no code ever produces.
  - `k_faq_scholar` uses `faqVisits` = `faqRes.count` where `faqRes` is
    `activity_events … .eq("kind","profile").eq("payload->>page","faq")`
    (`:362`). A repo-wide grep finds **no** `logActivity` call with
    `kind: "profile"` and no `page: "faq"` anywhere; the FAQ page
    (`src/app/[locale]/faq/page.tsx`) never writes an event.
  - `k_spy` uses `profilesVisited` = `visitPayloads.filter(p => p.payload?.page === "profile")`
    (`:486`); `k_sharer` uses `stealVisits` with `page === "steal-link"`
    (`:480`), both over `activity_events … .in("kind", ["profile_visit","steal_visit"])`
    (`:363`). No `logActivity` call ever writes `kind: "profile_visit"` or
    `"steal_visit"`, and there is no share/steal-link page in the tree at all.
  - Corroborated live: the 20 `activity_events` rows contain only the kinds
    `achievement`, `level_up`, `daily`, `wheel` — none of `profile`,
    `profile_visit` or `steal_visit` has ever existed.
  This is the same read-without-writer situation round 6 noticed for the
  `t(kind)` i18n question (refuted there as an i18n issue) but which was never
  followed to the achievements that consume those kinds.
- **Consequence**: `k_faq_scholar` (100 XP / 100 coins), `k_spy` (100/100) and
  `k_sharer` (100/100) are dead content in all 11 locales. `stats_achievements`
  lists them forever at `unlocks = 0`, so the "rarest unlocks" panel is wrong
  by construction, and the achievement wall can never be completed (a
  completionist caps at 122/125). The FAQ page exists and is linked, so the
  intent was real; the tracking was never wired.
- **Confidence**: high (grep plus live kind distribution).
- **Fix direction**: either wire the writers (log a `profile_visit`/
  `steal_visit`/`profile`+`page:"faq"` event at `recordProfileVisit`/the FAQ
  page/`ShareButtons`) or repoint the three checks at data that exists
  (`profile_visits` rows where `visitor_id = userId` for `k_spy`, the blog/FAQ
  page views, and drop `k_sharer` if no share-link surface is planned). Note
  `activity_events` is public-read, so do not put an IP hash in the payload.

---

## f13-3 — `buildStats()` reads the per-user history through un-limited, unordered selects, so every counter derived from them is silently capped at PostgREST's 1000-row response limit

- **Severity**: medium (achievements mis-evaluate for any established player)
- **Side**: server / gamification
- **File:line**: `src/lib/gamification/achievements.ts:354`
  (`from("game_rounds").select("game,won").eq("user_id", userId)` — no limit),
  `:360` (`from("steal_attempts").select(...).or(...)` — no limit), consumed at
  `:384-388` (`gamesByType`), `:437-439`, `:481-483`
- **Evidence**: PostgREST caps a single response at 1000 rows, and this repo
  relies on that fact elsewhere — `src/lib/queries.ts:527` ("PostgREST caps a
  single response at 1000 rows"), `src/lib/inventory.ts:26-28`, `src/lib/queries.ts:531-545`
  and `src/app/sitemap.ts` were all paged for exactly this reason (pdat-7,
  srv-6, pdat-8). `buildStats` still issues two un-paged, **unordered** selects
  over per-user history:
  - `game_rounds` (one row per round, forever) → `gamesByType[game].played/won`
    is computed from at most 1000 arbitrary rows.
  - `steal_attempts` filtered by `.or(thief_id.eq.<me>,victim_id.eq.<me>)`
    (two rows per heist once you are involved) → `defendedCount`,
    `stealCostPaid`, `bestStealAmount` are sums over at most 1000 arbitrary rows.
  The other `buildStats` readers have the same shape (`:356` wheel events,
  `:359` coin-rain events, `:365` all activity kinds, `:366` visits) but their
  thresholds (10/25/100) are far below the cap, so they are not yet affected.
- **Consequence**: for a player past 1000 rounds, the unordered window can omit
  an entire game, so `c_games_all` ("Play every game at least once") and
  `s_full_house` ("Play 10+ rounds of every game") can fail for a player who
  satisfies them, and `s_perfectionist_rps`/`k_shoot_500` can be missed. Past
  1000 steal rows, `k_thief_10`, `k_fortress`, `s_generous` and `s_sniper`
  undercount. This is the "works until the 1000th row" shape: the DB currently
  has **0** `game_rounds` and **0** `steal_attempts`, so nothing is wrong today,
  and it becomes wrong deterministically as soon as a player is active enough.
- **Confidence**: high on the code (no `.limit`/`.range`, no `order`); the cap
  value is the repo's own stated PostgREST default.
- **Fix direction**: page these two selects with `.order("id")` + `.range()` (or
  replace them with SQL aggregate views, the pattern 0013 already established
  for the catalog) so the counts are complete at any volume. A `count: "exact",
  head: true` for `games_played` is not enough — the per-game breakdown needs
  the rows.

---

## f13-4 — viewing any profile writes a `user_progress` row through the service role, inflating the public "players" KPI and dragging "avg level" toward 1

- **Severity**: low (stat integrity; an unauthenticated write on a read path)
- **Side**: server / pages + stats
- **File:line**: `src/app/[locale]/profile/[username]/page.tsx:216`
  (`getProgress(profile.id).catch(() => null)` inside `if (profile)`),
  `src/lib/gamification/xp.ts:94-99` (the `upsert({ user_id })` that
  `getProgress` performs when no row exists), view
  `supabase/migrations/0004_stats_uptime.sql:44-47`
  (`count(*)::bigint as players`), consumed at
  `src/app/[locale]/stats/page.tsx:462-464`
- **Evidence**: `getProgress` uses `createAdminClient()` and, on a missing row,
  inserts one (`xp.ts:94-99`). The profile page calls it for the **viewed**
  profile (not the viewer) whenever the profile exists, before any auth check on
  the viewer — an anonymous GET of `/profile/<name>` therefore issues a
  service-role INSERT. `stats_gamification.players` is `count(*) from
  user_progress`, and `/stats` renders it as "players" with `active7d` as its
  hint. `level` defaults to 1 (`0003_gamification.sql:11`), so those rows also
  enter `avg(level)`.
- **Consequence**: the headline "players" figure counts every account that was
  ever *looked at*, not every account that played, and `avgLevel` is pulled
  toward 1 by rows that have no XP. The effect is bounded (one row per profile,
  PK `user_id`), so it is a measurement error, not a leak or a growth vector.
  It is also a side effect on a GET: an unauthenticated visitor to a shared
  profile link causes a DB write.
- **Confidence**: high on the code path and the KPI mapping; medium on how
  visible the skew is at the current scale (1 profile).
- **Fix direction**: give the profile page a read-only progress lookup (a
  `select` without the insert-on-miss), and keep the `ensureProgress`-style
  insert on the gamification write paths only.

---

## f13-5 — `/api/progress` returns `level` as a `LevelInfo` object where every other surface treats it as a number

- **Severity**: low (wrong response shape; no current consumer reads the field)
- **Side**: server / API
- **File:line**: `src/app/api/progress/route.ts:15`
  (`level: levelFromXp(progress.xp)`), against
  `src/lib/gamification/levels.ts:25-40` (`levelFromXp` returns
  `{ level, totalXp, xpIntoLevel, xpForNext, progress }`)
- **Evidence**: `award()` and every page use `levelFromXp(xp).level`
  (`xp.ts:197`, `:216`; `games/page.tsx:48`; `profile/[username]/page.tsx:229`).
  The route serialises the whole `LevelInfo`, so the JSON body is
  `{"level":{"level":3,"totalXp":…,"progress":0.42,…}}` instead of
  `"level":3`. Both live consumers (`src/components/WheelOfFortune.tsx:44`
  reads `wheelSpunToday`, `src/components/games/useGame.tsx:29` reads `coins`)
  ignore the field, so nothing renders wrong today.
- **Consequence**: any future consumer that trusts the documented HUD payload
  gets an object where it expects a number (e.g. `data.level >= 5` is `false`
  for every user, `String(data.level)` renders `[object Object]`). It is a
  latent contract bug rather than an observed one.
- **Confidence**: high on the code; the impact is unexercised (no caller reads
  `level`).
- **Fix direction**: `level: levelFromXp(progress.xp).level`, or drop the field.

---

## f13-6 — three "special/creative" achievement conditions do not implement the description they advertise

- **Severity**: low (content correctness; the conditions are satisfiable but mean something else)
- **Side**: server / gamification
- **File:line**: `src/lib/gamification/achievements.ts:241` (`s_ghost_town`),
  `:216` (`s_pioneer`), `:210` (`s_top_percent`)
- **Evidence**:
  - `s_ghost_town` — "Have zero profile visitors in your first 7 days":
    `s.profileViews === 0 && s.activityCount > 0`. There is no 7-day (or any
    time) condition; `activityCount` is every `activity_events` row for the user
    (`:492`). The first time a brand-new player does anything (their first game
    logs an event, then evaluation runs) with nobody having viewed them yet, the
    check passes — so the "special" achievement is effectively a first-activity
    achievement, not a 7-day one.
  - `s_pioneer` — "Be among the first 100 users": `s.userCount <= 100`, where
    `userCount` is the **current** total profile count (`:364`, `:494`). An
    account that registered as #37 but only plays after user #101 exists can
    never unlock it, while the description promises early registration.
  - `s_top_percent` — "Be among the top 3 coin holders": `s.userCount >= 20 &&
    s.progress.coins >= 50000` — no ranking is consulted at all, so it is a
    plain "hold 50k coins once 20 accounts exist" check.
- **Consequence**: three achievements award their XP/coins on conditions
  unrelated to their labels. The visible effect is small today (one user) but
  `s_ghost_town` is granted to essentially every new player on their first
  action, which misrepresents the achievement wall and awards 100 coins + 100 XP
  for free.
- **Confidence**: high on the code; medium on how much the mislabel matters to
  the product.
- **Fix direction**: implement the stated conditions (`created_at`-relative
  window for `s_ghost_town`; evaluate `s_pioneer` from the user's registration
  rank, e.g. a stored `signup_index`, rather than the live count; a real top-3
  query for `s_top_percent`) or reword the descriptions to match what is
  actually checked.

---

## f13-7 — potat and global write whole rows built from a pre-run snapshot, so a run that overlaps the other reverts its concurrent change

- **Severity**: low (latent; needs two syncs to overlap within seconds)
- **Side**: server / sync
- **File:line**: `src/lib/syncs/potat.ts:189-198` (`upsertRows.push({ ...badge,
  owner_count, active_count, percentage, last_polled_at, rarity_score,
  rarity_tier, ...status })`) and `:224-229` (upsert by `set_id,version`);
  `src/lib/syncs/global.ts:205-207` / `:231-236` (the same pattern for
  `upsertsExisting`)
- **Evidence**: both syncs read a full row set once (`potat.ts:82-102`,
  `global.ts:56-67`), compute patches in memory, and then upsert the **whole
  row** back (potat spreads `...badge`; global spreads `...existingWithoutId`).
  Neither uses a partial update, and neither is transactional with respect to
  the other. `potat` only overrides `status` when it computed a change
  (`potat.ts:197`), so the snapshot's `status`, `title`, `description`,
  `is_confirmed_active`, `rarity_*` are all re-written as read. This is the same
  read-modify-write shape as the round-13 fix (`global` splitting new vs
  existing rows) but across two different syncs instead of within one batch.
  The potat cron runs every 15 minutes (GitHub Actions) while the global cron
  runs `runGlobalSync()` then `runBadgebaseSync()` back-to-back
  (`src/app/api/cron/global/route.ts:21-52`), so the windows can overlap.
- **Consequence**: if badgebase demotes a badge (or global flips its status /
  refreshes artwork) between potat's read and potat's write, potat's upsert
  silently reverts the newer value; the same in reverse. The changelog then
  records a transition that the row does not hold, and `/active` can briefly
  show a badge the authoritative listing already demoted (or vice versa) until
  the next run. Reachability is a few seconds per day, so this is a robustness
  finding, not an observed failure.
- **Fix direction**: have each sync write only the columns it owns (a targeted
  `update` per row or a partial upsert), or serialize the two writers (e.g. a
  shared advisory lock / a `last_synced_at` guard so a run skips if the catalog
  moved under it).

---

## f13-8 — the Tower cash-out marker follows the live slider, so after a round the "← cashout" arrow points at a floor that was never played

- **Severity**: low (display/logic mismatch; no economy effect)
- **Side**: client / games
- **File:line**: `src/components/games/TowerGame.tsx:35-37`
  (`const reached = last ? floor <= last.floor : floor <= cashoutAt;`
  `const isCashout = floor === cashoutAt;`), `:11`, `:76`
- **Evidence**: after a round, `last` holds the server's `{ floor, survived }`
  and the row colouring correctly switches to `last.floor`, but `isCashout`
  keeps comparing against the **current** `cashoutAt` state, which the range
  input still mutates (`:71-78`). Nothing disables the slider after a round.
- **Consequence**: play at cash-out 5, then drag the slider to 8 — the result
  rows still describe the floor-5 round, but the "← cashout" arrow and accent
  border jump to floor 8, i.e. the UI claims a cash-out target the round never
  used. This is the same class as the coinflip fix (games-a-2, "re-colours the
  whole history against the live side selection"): the displayed round is
  rendered against live input state instead of the state it was played with.
- **Confidence**: high (pure render logic); cosmetic.
- **Fix direction**: capture the played `cashoutAt` into `last` (the server
  already returns it in `result.cashoutAt`) and render `isCashout`/`reached`
  from `last.cashoutAt` when `last` is set — or freeze the slider until "again".

---

## Checked and found clean (so the next round does not redo it)

- **i18n namespace/key resolution** — a namespace-aware scan over every
  `useTranslations`/`getTranslations` binding in `src/` (resolving `ns.key`
  paths against `messages/en.json`) produced only 5 hits, all false positives
  from a reused `t` variable in `generateMetadata`; `meta.badgeTitle`,
  `meta.postTitle`, `meta.profileTitle` all exist. `games.streakDay` is present
  and `common.streakDay` is gone, i.e. the c12-1 mis-namespacing has been
  corrected since. No missing key found.
- **PostgREST key-union (mixed row shapes in one batch)** — every multi-row
  `.insert`/`.upsert` in the tree was enumerated: `global.ts:289` and `:372`
  (uniform `{badge_id,kind,detail}`), `global.ts:225-236` (new rows uniform;
  existing rows are `{...fullRow, ...patch}` where every `patch` key is already
  a column of the spread row, so the key set is identical), `potat.ts:224`
  (uniform), `badgebase.ts:278-283` (uniform), `inventory.ts:92` (uniform),
  `potat.ts:231` `badge_stats` (uniform). No mixed-shape batch remains.
- **Catalog identity / slug collisions** — live: 476 rows, **0** rows whose
  stored `slug` differs from `badgeSlug(set_id, version)`, **0** collisions when
  that function is applied to every existing `set_id:version`. The round-13
  concern does not reproduce on the current catalog.
- **badgebase guard's first write** — apart from the placement issue above, the
  guard does precede the first mutation in the function (the per-card update at
  `:191-198`), and `fetchHtml` throws on a non-200, so only a 200-with-garbage
  listing reaches it.
- **Daily/wheel/coin-rain gates** — `claim_daily_gate` / `claim_wheel_gate` are
  true compare-and-sets (`0007:144-196`), `ensureProgress` runs before each
  (`daily.ts:18`, `wheel.ts:46`, `daily.ts:318`), and `coin_rain_gate`'s PK
  `(owner_id, giver_key, day)` makes the rain gate atomic (`0014:18-24`). All
  application keys are ≥ 8 chars (uuid 36, ip-hash 40, `"anonymous"` 9), so the
  0015 length CHECK cannot reject a legitimate key.
- **`apply_pair_deltas`** — one statement, both CTEs, `greatest(0, …)` clamping
  matching `add_coins`; `p_a != p_b` is guaranteed by the self-steal
  (`daily.ts:94`) and self-rain (`daily.ts:303`) refusals, so the "same row
  updated by two data-modifying CTEs" hazard is unreachable.
- **Steal flood window** — the pre-checks plus the post-insert re-count and the
  cleanup of the raced row (`daily.ts:157-181`) behave as commented; the counter
  updates happen after both coin moves and are logged, not thrown.
- **Session/IP hashing** — `hashIp` throws rather than falling back to a literal
  salt (`session.ts:44-55`), `clientIp` prefers `x-real-ip` and otherwise takes
  the rightmost `x-forwarded-for` entry, and every importer of
  `gamification/session` is server-only (no `"use client"`).
- **Paged reads** — `inventory.ts:34-54`, `queries.ts:531-546` and
  `app/sitemap.ts` all page with a deterministic `order`; `getBadgeStatsHistory`
  takes the newest `limit` and reverses for the chart.
- **`/api/feed` parameter parsing** — absent/NaN `limit` and `cursor` both fall
  back to documented defaults (`route.ts:10-20`); the public projection excludes
  `user_id` and `payload`.
- **`/api/push/subscribe`** — endpoint validation (HTTPS, no IP literal /
  internal host, ≤512 chars) and the ownership check before upsert/DELETE are
  present; a dead endpoint is pruned on 404/410 (`push.ts:64-73`).
- **`/api/account` bounds** — display name 64, bio 280, banner URL scheme-checked
  and 500, colour regex, showcase ≤6, `customization` object-only with ≤64 keys
  and ≤4096 serialised chars; the `profiles_protect_columns` trigger restores
  `is_admin`/`view_count`/`twitch_id` for non-service-role writes.
- **`collector_stats` privacy** — the view is `security_invoker = true`, so
  `user_inventory`'s RLS applies and a private collector's `badges_owned`
  resolves to 0 for anonymous readers; no count leak.
- **Client state machines** — `VaultGame` now carries both the per-dial guard and
  the 250 ms time guard and resets on `start()`; `CoinflipGame` records the
  played side; `HiloGame` starts empty and takes the score from the server;
  `SlotsGame` disables its button until the symbol pool loads and clears its
  interval; `BlackjackGame`'s deal loops terminate. `useGame`'s `refresh`/
  `play` and the `RoundOutcome` render match the server response shape.
- **Dead exports** — `logChanges` (`changelog.ts:44`), `absoluteUrl`
  (`seo.ts`), `totalXpForLevel` (`levels.ts:19`), `badgeStatus`
  (`types.ts:110`), `recentPerfectFlags`/`distinctHoursToday` in `AchStats` have
  no caller. `adjustCoins` is used by `scripts/verify-atomic-economy.ts`, so it
  is not dead. These are code smells with no behavioural consequence and are
  listed for completeness only.
- **`markdown.ts` / `jsonld.ts`** — `jsonLdScript` escapes `<`, `>`, `&` and the
  JS line separators; `renderMarkdown` escapes its inline text and the only
  generated links target our own `/en/badges/<slug>` (slug is `[a-z0-9-]`), so
  no `javascript:` href or `</script>` break is reachable from the auto-post
  path.
- **`proxy.ts`** — one refresh per request, cookies written after the response
  is built, `/api` included, `sb-`-cookie short-circuit; the matcher excludes
  `_next/static`, `_next/image`, `sw.js` and extensioned paths.
