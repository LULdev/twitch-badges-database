# Verification — round 28 (commit `486be34`)

Scope attacked: `0023_complete_privilege_revoke.sql`, `0021`'s overload loop,
`scripts/verify-atomic-economy.ts`, the whole privilege surface, and the economy
scripts. Everything was checked against the **live** database
(`uueughkvgmoljqhmbowm`, PG 17.6, session pooler :5432) and against throwaway
databases created and dropped in this round. No project file was written except
this report. No production row was modified: the two probes that would have
written were run inside rolled-back transactions, and both economy runs were
bracketed by a full-table snapshot/compare/restore that applied **0** operations.

The critical detail from the brief was honoured: the ACL check uses
`aclexplode(coalesce(proacl, acldefault('f', proowner)))`, **not** a regex over
`proacl::text`. The `=X/` pattern is the **owner** self-grant
(`{postgres=X/postgres,…}`) and reading it as "anon can execute" is the classic
false positive; `acldefault` is required so that a `NULL proacl` (which means
"PUBLIC gets EXECUTE by default") is expanded rather than read as "no grants".

---

## Findings

### v28-01 — `blog_reactions` still grants **table-level INSERT** to anon/authenticated, and it is reachable — low (known/deliberate: db-2)

- **Side:** db
- **File:** `supabase/migrations/0023_complete_privilege_revoke.sql:37`
  (`grant insert on public.blog_reactions to anon, authenticated;`); the same
  grant is absent from the post-commit `0011:29-33`.
- **Evidence (live, measured):**
  - `has_table_privilege('anon','public.blog_reactions','INSERT') = true`;
    `authenticated` likewise. Every other privilege is `false`.
  - Column SELECT is exactly `(post_id, emoji, created_at)`; `ip_hash` is **not**
    selectable — `SET ROLE anon; select ip_hash …` → `42501 permission denied`.
  - A rolled-back probe **succeeded**: `set local role anon; insert into
    public.blog_reactions (post_id, emoji, ip_hash) select id,'like','deadbeef'
    from public.blog_posts limit 1 returning post_id, emoji` → succeeded, then
    `rollback` (0 rows persisted, verified).
  - The permissive policy `blog_reactions_insert` (`for insert … with check
    (true)`, roles `{public}`) is what lets it through.
- **Why it matters:** the brief's item-1 wording ("blog_views and blog_reactions
  grant exactly the column-level access the pages use and **nothing else**") is
  literally true for `blog_views` but **not** for `blog_reactions`: anon holds a
  table-level INSERT. The app's only writer is the server route
  `src/app/api/blog/react/route.ts:16,39`, which uses `createAdminClient()`
  (service_role — itself unchanged and still INSERT-capable), so no anon insert is
  needed. The practical effect is that anyone can POST directly to
  `/rest/v1/blog_reactions` with an attacker-chosen `user_id`/`ip_hash`,
  bypassing the route's one-per-IP-per-emoji dedup and inflating the reaction
  counts the blog page renders.
- **Why it is not a new defect:** this grant is the deliberate resolution of
  `db-2` ("blog_reactions INSERT grant left implicit → explicit grant/revoke
  pair", `bugreports/AGENT-AUDIT.md:35`). It is reported here only because item 1
  asked me to verify the "nothing else" claim, and the claim is one column of
  grant too strong. Nothing in this commit changed its reachability.
- **Confidence:** high (privilege + policy read, and a rolled-back insert that
  actually succeeded).
- **Fix direction:** drop the table-level `insert` grant; the route's service-role
  client needs nothing from anon. If an anon path were ever wanted, use
  `grant insert (post_id, emoji, created_at, user_id)` and keep `ip_hash` out of
  the grantable set. Otherwise leave as-is and record db-2 as "deliberately
  reachable".

### v28-02 — the atomic script's cleanup deletes a **range of the shared** `activity_events`, not just its own rows — low

- **Side:** scripts
- **File:** `scripts/verify-atomic-economy.ts:236-240`
  (`supabase.from("activity_events").delete().gt("id", eventHigh).select("id")`).
- **Evidence (code + measurement):** `eventHigh` is the global max `id` captured
  before the test (`:34-43`); the delete has **no `user_id` filter**. In this
  round's run the script's own output `feedRowsRemoved=6` matched the 6 rows the
  test itself created, and `activity_events` was 20→20 with no foreign row lost,
  because no other writer was active. Under concurrency it is not so: any real
  `award()`/activity row inserted between the snapshot and the delete carries
  `id > eventHigh` and is destroyed. The `user_achievements` delete on the next
  lines **is** scoped (`.eq("user_id", profile.id)`), so the omission is specific
  to `activity_events` — and `activity_events` is the public `/feed` source.
- **Why it is a bug:** the script's contract is "leaves no trace"; this makes it
  "leaves no trace of the test, and no trace of anyone else's activity either".
  It is a manual verification script, so the window is small, but it is run
  against the production database (the commit's own gate line is `atomicity 17/17
  exit 0`).
- **Confidence:** high (the missing predicate is plain in the code; the mechanism
  was confirmed by the clean 20→20 result and the `feedRowsRemoved` log).
- **Fix direction:** scope the delete by the events the test created — e.g.
  capture `eventHigh` and delete `.gt("id", eventHigh).eq("user_id", profile.id)`,
  or record the returned `activity_events` ids from each `award()` and delete only
  those. (The same is true of the `finally` restore: it writes the profile's whole
  row back from the snapshot, so genuine progress earned during the ~seconds the
  script runs is reverted; scoping cannot fix that, only shortening the window or
  running against a disposable profile can.)

### v28-03 — for a profile with no `user_progress` row the script **creates** one and never removes it — low (latent)

- **Side:** scripts / db
- **File:** `scripts/verify-atomic-economy.ts:33` (`const snapshot = await
  getProgress(profile.id)`) into `:231-234` (the `finally` only `update`s).
- **Evidence (code):** `getProgress` (`src/lib/gamification/xp.ts:99-117`)
  **upserts** `{ user_id }` and returns a zeroed row when none exists;
  `readProgress` (`:88-97`) exists precisely to avoid that. The `finally` restores
  by `update`, which cannot delete a row it created. So if the script picks a
  profile that has no progress row, it leaves a brand-new zero row behind — the
  opposite of "leaves no trace".
- **Why it matters:** the no-trace claim (the subject of item 4) is asserted
  unconditionally; this is the one branch where it fails by construction. On the
  live database there is exactly 1 profile and it already has a row, so the defect
  is unobserved in practice — reported as latent.
- **Why it is not covered by v27-06:** v27-06 was about `updated_at` being
  re-stamped; this is about a row being created where none existed. The commit
  fixed the former and did not touch the latter.
- **Confidence:** medium-high (mechanism certain from code; impact requires a
  profile without a progress row, which production does not currently have).
- **Fix direction:** snapshot with `readProgress` and, when it returns `null`,
  delete the zero row the test created in the `finally` (or skip the profile).

### v28-04 — the commit message and changelog row state "22/22" while the migration set is **23 files** — info (docs)

- **Side:** docs / commit record
- **File:** commit `486be34` body ("Replay verified by the agent: 22/22 from
  scratch … 21/21 for 0002-0022"); changelog row **330** ("von Grund auf 22/22 …
  0002-0022 … 21/21").
- **Evidence:** `readdirSync('supabase/migrations').filter(.sql).sort()` → **23**
  (`0001`–`0023`); my replay harness prints `migrations found: 23`. The commit
  added `0023` in the same breath, so the "from scratch" count should be 23/23 and
  the sub-set `0002`–`0023` is 22 files, not 21.
- **Why it matters:** round 27 already flagged an off-by-one count (v27-05), and
  the fix ("21 → 22") was applied to a set that had just become 23. A reader who
  counts files now sees 23 against a 22 claim. The verification result itself is
  correct; only the number is stale.
- **Confidence:** high.
- **Fix direction:** none in code; correct the narration if quoted.

### v28-05 — the grant-surface **class** the last three rounds chased still covers ~45 relations — info (unreachable)

- **Side:** db
- **File:** default Supabase table grants; the specific objects closed were
  `blog_views`/`blog_reactions` (`0011`, `0023`) and `follows` (`0022`). The rest
  of the surface was never touched.
- **Evidence:** the full enumeration is the table in "Grant surface" below.
  `TRUNCATE`, `REFERENCES`, `TRIGGER` and `MAINTAIN` are still granted to
  `anon`/`authenticated` on **20 tables**; **23 views** still carry the full
  `INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN` set; **11
  sequences** still carry `UPDATE` (i.e. `setval`/`nextval`); `public.
  supabase_migrations` still carries full CRUD to both roles.
- **Why it is not a live defect:** none of it is reachable.
  - `anon`/`authenticated` are `NOLOGIN` and PostgREST implements only
    `SELECT/INSERT/UPDATE/DELETE` — it has no verb for `TRUNCATE`, `REFERENCES`,
    `TRIGGER`, `MAINTAIN`, and sequences are not exposed.
  - The 23 views are **not auto-updatable** (`information_schema.views`:
    `is_updatable = NO`, `is_insertable_into = NO` for every one; they all use
    `GROUP BY`/joins/sub-selects), so their `INSERT/UPDATE/DELETE` grants fail
    with a "cannot insert into view" error rather than writing the base tables.
  - **RLS check:** a rolled-back `SET ROLE anon; insert into
    public.supabase_migrations` → `42501 new row violates row-level security
    policy` (RLS on, no policy = deny), and `update public.profiles` → 0 rows
    (self-only policy). Only `blog_reactions` (v28-01) answers a write.
- **Why it is worth recording:** 0023's own header says "a grant with no purpose
  is surface". That reasoning applies to the 45-odd relations 0023 did **not**
  name — so the class is closed for three objects and open for the rest. It is a
  one-migration sweep (`revoke truncate, references, trigger, maintain on <each>
  …`), not 45 hand-edits.
- **Confidence:** high (privilege catalogue + updatability + RLS probes).
- **Fix direction:** one follow-up migration — `revoke truncate, references,
  trigger, maintain on all tables/sequences in schema public from anon,
  authenticated` (and the same on the views), leaving `SELECT` and the three
  intentional write grants. Or accept it as inert and record the decision, as
  was done for the orphan RPCs.

---

## 1. Item 1 — `0023` against the live database

| Check | Method | Result |
| --- | --- | --- |
| No function executable by anon/authenticated/PUBLIC | `aclexplode(coalesce(proacl, acldefault('f',proowner)))` | **0** such grants across 32 EXECUTE grants; every function is `postgres` + `service_role` only |
| …cross-checked | `has_function_privilege('anon'/'authenticated', oid,'EXECUTE')` over all 16 public functions | **0** |
| `service_role` still has EXECUTE everywhere (RPCs must work) | `has_function_privilege('service_role', …)` | 16/16 yes |
| `blog_views` grants | `has_table_privilege` all 8 priv | anon/auth **all false**; column SELECT `post_id, created_at` true; `ip_hash` **false** |
| `blog_views` insert | rolled-back `SET ROLE anon; insert …` | **42501 permission denied for table blog_views** |
| `blog_reactions` grants | `has_table_privilege` all 8 priv | anon/auth: **INSERT true**, all others false; column SELECT `post_id, emoji, created_at`; `ip_hash` **false** |
| `ip_hash` unreadable | rolled-back `SET ROLE anon; select ip_hash …` | **42501 permission denied for table blog_reactions** |
| `blog_reactions` insert path (the route) | `has_table_privilege('service_role',…,'INSERT')` | **true** — the route (`createAdminClient`, `route.ts:16,39`) is unaffected by the revoke |
| `follows` grants | `has_table_privilege` | `authenticated`: **SELECT only**; `anon`: **none**; `INSERT/UPDATE/DELETE/…` all false |
| Re-granted columns == code selects | grep of the page's reads | `blog page.tsx:66` `blog_views.select("post_id")` → granted; `page.tsx:69` `blog_reactions.select("emoji")` → granted. `created_at` is granted on both but **not selected by the anon page** (benign over-grant; used by the service-role visit path) |

**Claim status:** "no function executable" — **verified true**. "blog_views … nothing
else" — **verified true**. "blog_reactions … nothing else" — **false for INSERT**
(v28-01, deliberate per db-2). "follows keeps only authenticated SELECT" —
**verified true**. "insert path still works" — **true** (service_role); the anon
insert grant is extra. "ip_hash remains unreadable" — **verified true**.

## 2. Item 2 — `0021`'s overload loop

Reasoned first, then exercised in a throwaway database `v28_probe3` (dropped):

- **Absent function is a no-op, not an error.** The loop iterates
  `select … from pg_proc where proname = 'protect_profile_columns'`; zero rows
  means the body never runs. Measured: running the block on an empty schema
  raised **no error**. (This is why it needs no `to_regprocedure` guard at all.)
- **Every overload is revoked.** Created three overloads
  (`()`, `(integer)`, `(text)`), granted EXECUTE to `anon`/`authenticated`,
  ran the block: all three → `anonEXEC=false, authEXEC=false`.
- **A signature change cannot be silently skipped.** This is the `v27-01` bug.
  With *only* `protect_profile_columns(text)` present and granted to `anon`,
  `to_regprocedure('public.protect_profile_columns()')` returned **`false`** —
  i.e. the pre-fix guard would have taken the `if … is not null` branch as false
  and **skipped the revoke** (fails OPEN, exactly as the commit says). The new
  loop, matching on `proname` only, revoked it: `anon` EXECUTE `true → false`.
- **No re-grant needed.** 0021 (and 0023) revoke only from
  `public, anon, authenticated`, so `service_role`'s existing EXECUTE is never
  removed — live ACL of `protect_profile_columns` is
  `{postgres=X/postgres, service_role=X/postgres}`, and the function is a
  `RETURNS trigger` function (direct calls fail `0A000` regardless).

**Result: `0021` is correct.** It cannot fail open and cannot miss an overload.

## 3. Item 3 — migration replay (throwaway database `v28_replay`, dropped)

Harness: `create database v28_replay` on the same cluster, bootstrap the
Supabase prerequisites a bare database lacks (`create extension pgcrypto`, schema
`auth`, a minimal `auth.users`, `auth.uid()`), then apply every file in
`readdirSync(...).sort()` order, **one transaction per file** (the same shape as
`scripts/db-apply.ts`), capturing the SQLSTATE of the first failure.

| Configuration | Result | First failing file |
| --- | --- | --- |
| **A** — `0001`–`0023` from scratch | **23/23 OK** | none |
| **B** — the whole set a second time on top of A (empty catalog) | **23/23 OK** | none |
| **B2** — the whole set a second time with one catalog row seeded (production-like) | stops at `0001`, then `0002`–`0023` **all OK** | `0001_init.sql` — `P0001` *"Refusing to re-apply 0001_init.sql: public.badges already holds 1 row(s). This migration DROPs the schema CASCADE and would destroy all user data."* |

The `0001` stop in B2 is the **documented, deliberate** guard
(`0001_init.sql:17-26` / line 19-25) and is **not** a defect. On a genuinely fresh
replay target `public.badges` stays empty (no migration seeds it), so even the
second pass re-runs `0001` cleanly — B is therefore clean. There is **no
undocumented first failure in any configuration**. The only surprise is the count:
the commit/changelog say 22 (v28-04); the set is 23.

## 4. Item 4 — `scripts/verify-atomic-economy.ts`

**No-trace, by measurement (my own full-table snapshot in `economy.mjs`):**

| Relation | Before | After | added / removed / changed |
| --- | --- | --- | --- |
| `user_progress` (the test row, **every** column incl. `updated_at`) | 1 row | 1 row | 0 / 0 / **0 changed columns** |
| `activity_events` (all rows, all columns) | 20 | 20 | 0 / 0 / 0 |
| `user_achievements` (all rows, all columns) | 13 | 13 | 0 / 0 / 0 |

Because I found **zero** drift, my own restore applied **0** operations and the
post-run state was byte-identical to the baseline. This confirms the `v27-06` fix:
`getProgress` uses `select("*")` (`xp.ts:103`), so `restorable` carries the
snapshot's `updated_at`; there is **no** `BEFORE UPDATE` trigger on
`user_progress` (live `pg_trigger` shows triggers only on `badges` and
`profiles`), so the re-written value survives. The `v27-06` caveat is closed.
The script's own line `feedRowsRemoved=6 achievementRowsRemoved=4` matches the
rows it created and deleted.

**Exit codes:**

- Real script → `ALL CHECKS PASSED`, 17 `PASS` / 0 `FAIL`, **exit 0**.
- Deliberately wrong copy (one expectation `3` → `999` on `single award xp`,
  built outside the repo and compiled against the repo tsconfig; no project file
  touched) → `FAIL single award xp (DELIBERATELY WRONG): got 3, expected 999`,
  `1 CHECK(S) FAILED`, **exit 1**.

So the gate is real: it exits 0 on success and non-zero on a failed check.

Not covered by this measurement, and reported above: the **unscoped**
`activity_events` delete (v28-02) and the **created-row** branch for a
progress-less profile (v28-03).

## 5. Item 5 — grant surface (whole schema)

Method: `aclexplode(coalesce(relacl, acldefault('r', relowner)))` over
`pg_class` (relkind `r`,`p`,`v`,`m`,`S`) in `public`, filtered to
`anon`/`authenticated`; plus `has_table_privilege`/`has_column_privilege` and
`information_schema.views` for updatability.

**Functions:** no function in `public` grants EXECUTE to `anon`, `authenticated`
or `PUBLIC` (32 grants, all `postgres`+`service_role`). `rls_auto_enable` is a
platform event-trigger function with `{postgres, service_role}` — not
anon-reachable. Nothing to report.

**Relations with anon/authenticated grants — 55 entries (21 tables incl. one
INSERT-only, 23 views, 11 sequences).** The pattern is uniform; `…` below stands
for `TRUNCATE,REFERENCES,TRIGGER,MAINTAIN`.

| Relation (kind) | anon / authenticated grants | Excess vs. app need | Reachable? |
| --- | --- | --- | --- |
| `activity_events` (r) | SELECT + `…` | `…` | no (no PostgREST verb) |
| `badge_events`, `badge_stats`, `badges`, `blog_posts`, `changelog`, `game_rounds`, `notifications`, `profile_visits`, `steal_attempts`, `system_heartbeats`, `turbo_wins`, `user_achievements`, `user_progress` (r) | SELECT + `…` | `…` | no |
| `profiles` (r) | UPDATE + `…` (SELECT is column-level, `0010`) | `…` | UPDATE is self-only RLS |
| `push_subscriptions` (r) | SELECT/INSERT/UPDATE/DELETE + `…` | `…` | INSERT intended (anon opt-in, policy `with check true`) |
| `user_inventory` (r) | SELECT/INSERT/UPDATE/DELETE + `…` | `…` | intended (self + `inventory_public`) |
| `user_sync_state` (r) | SELECT/INSERT/UPDATE/DELETE + `…` | `…` | intended (self-only policy) |
| **`supabase_migrations` (r)** | **SELECT/INSERT/UPDATE/DELETE + `…`** | **full CRUD + `…`** | **no — RLS on, no policy ⇒ `42501`** |
| **`blog_reactions` (r)** | **INSERT** | **INSERT (v28-01)** | **YES (policy `with check true`)** |
| `blog_views` (r) | — (column SELECT only) | none | — |
| `coin_rain_gate` (r) | — (no acl entries) | none | — |
| `follows` (r) | authenticated SELECT only | none | — |
| `badge_momentum`, `collector_stats`, `stats_achievements`, `stats_activity_kinds`, `stats_badge_claims`, `stats_biggest_wins`, `stats_catalog_categories`, `stats_catalog_rarity`, `stats_daily_activity`, `stats_daily_badges`, `stats_daily_users`, `stats_daily_xp`, `stats_games`, `stats_gamification`, `stats_levels`, `stats_steals`, `stats_system`, `stats_top_players`, `stats_traffic`, `stats_uptime_daily`, `stats_uptime_hourly`, `stats_uptime_sources`, `stats_wheel` (v) | SELECT/INSERT/UPDATE/DELETE + `…` | INSERT/UPDATE/DELETE + `…` | no — all `is_updatable=NO`, `is_insertable_into=NO` |
| `activity_events_id_seq`, `badge_events_id_seq`, `badge_stats_id_seq`, `blog_reactions_id_seq`, `changelog_id_seq`, `game_rounds_id_seq`, `notifications_id_seq`, `profile_visits_id_seq`, `steal_attempts_id_seq`, `system_heartbeats_id_seq`, `turbo_wins_id_seq` (S) | SELECT/UPDATE/USAGE | UPDATE (`setval`/`nextval`) | no — sequences not exposed |

**Bottom line for item 5:** the objects named in `0023` are closed, but the same
class (v28-05) is open on the other ~45 relations. **Exactly one** entry in the
whole table is reachable and not required: the `blog_reactions` table-level
INSERT (v28-01, deliberate per db-2). Everything else is inert surface.

## 6. Item 6 — economy scripts, numbers and exit codes

```
$ npx tsx scripts/verify-game-economy.ts
game          rounds  avg payout/bet  verdict
rps           200000          0.9664  ok
slots          40000          0.1361  ok
shoot         200000          0.8986  ok
memory        200000          0.8820  ok
quiz          200000          0.8021  ok
coinflip      200000          0.9688  ok
hilo          200000          0.9868  ok
roulette      200000          0.3714  ok
blackjack     200000          0.5846  ok
vault         200000          0.9015  ok
scratch       200000          0.9804  ok
tower         200000          0.9023  ok
catcher       200000          0.8596  ok
worst game: hilo at 0.9868        → 13/13 < 1.0   EXIT 0
```

```
$ npx tsx scripts/verify-atomic-economy.ts
test profile: band1to 43e5ee6d-…
17 PASS / 0 FAIL
  concurrent xp survives (3+11+13): got 27, expected 27
  concurrent coins survive (2+5+7): got 14, expected 14
  daily gate: exactly one winner (gate results: -1 / 1)
  game XP budget capped at 100 (granted: 80 + 20)
  achievements evaluated: 123 | unlocked for this profile: 4
restore: EXACT (xp 3610/3610, coins 1840/1840, level 11/11)
         feedRowsRemoved=6 achievementRowsRemoved=4
ALL CHECKS PASSED                                              EXIT 0
```

(The commit's "worst 0.9884" vs my 0.9868 is just RNG in the simulation;
`achievements evaluated: 123` vs `AGENTS.md`'s 125 is the known/deliberate
narration difference, not reported.)

## 7. Answer to item 7 — is any **live** defect left in this commit's scope?

**No reachable, unexplained live defect in the objects this commit changed.**
Every load-bearing claim of `486be34` was reproduced:

- the public function surface is genuinely closed (0 anon/authenticated/PUBLIC
  EXECUTE grants, two independent methods);
- `blog_views` and `follows` carry exactly the intended grant; `ip_hash` is
  unreadable (42501) and the reactions route still inserts (service_role);
- `0021`'s loop is correct — it revokes every overload, is a no-op when the
  function is absent, and provably cannot fail open on a signature change (the
  pre-fix guard returned `false` in exactly that case);
- the whole set replays (23/23 scratch, 23/23 second pass; only `0001` stops on a
  non-empty catalog, by design);
- the atomic script leaves no trace (every column of the test row identical,
  `activity_events`/`user_achievements` unchanged) and its exit code is a real
  gate (0 on success, 1 proven on a wrong expectation).

What remains is three **low/latent** items and two **info** items (v28-01…05):
`blog_reactions` still exposes a deliberate anon INSERT (reachable but intended
by db-2), the atomic script's `activity_events` cleanup is unscoped (latent
risk of deleting a concurrent user's feed row) and can leave a zero
`user_progress` row for a profile that had none, the migration count in the
narration is stale (22 vs 23), and the inert `TRUNCATE/REFERENCES/TRIGGER/
MAINTAIN` surface persists on ~45 relations. None of these is introduced by, or
a regression of, this commit; the only one that is *reachable* is the one the
project already decided to keep (db-2).

---

### Cleanup

`v28_replay`, `v28_probe2`, `v28_probe3` were each dropped (final
`select datname from pg_database where datname like 'v28%'` → **empty**).
Final production counts: `user_progress=1, activity_events=20,
user_achievements=13, blog_reactions=3, blog_views=21, profiles=1` — identical to
the baselines; the one probe row that inserted (`ip_hash='deadbeef'`) was rolled
back and re-verified absent (0 rows). All scratch files live outside the
repository (`C:\tmp\v28`).