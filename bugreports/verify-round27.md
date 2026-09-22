# Verification — Round 27

Scope: commit `d81ddef` ("my verification script could not fail; three migrations
were not replayable") — the exit-code fix in `scripts/verify-atomic-economy.ts`,
the idempotence guards added to `0011`/`0015`/`0017`, the rewritten overload loop
in `0020`, and the new `0022` (`public.follows`).

Read-only with respect to project files: nothing in the repository was edited,
created or deleted; this report is the only new file. `git status --porcelain` was
empty before the first probe and empty again before this file was written. Live DB
work used the session pooler (`5432`); direct reads on `6543` were available as
backup but not needed. No secret is printed anywhere below (URLs are reported by
host only).

**Method.** The writable probes ran in a throwaway database created with the
pooler's `CREATEDB` (`v27_scratch_throwaway`), shimmed the two Supabase primitives
the migrations need (`auth.users`, `auth.uid()`), and were **dropped afterwards** —
verified: `select datname from pg_database where datname like 'v27%'` → `[]`.
Cluster roles (`anon`, `authenticated`, `service_role`) and `pgcrypto` exist
cluster-wide, so they needed no shim. One caveat on the scratch ACLs: the scratch
database does not carry Supabase's `alter default privileges`, so table ACLs there
are *not* a faithful copy of production; every ACL/policy claim below was
re-checked against production directly. The only production writes are the two
sanctioned economy scripts (item 2/6); production row counts are byte-identical
before and after.

**Verdict up front.** No live defect remains in this commit's scope. All four
claims in the commit message are true and reproducible: the script now exits 1 on
a failing check and 0 otherwise, the three migrations are replayable and
behaviour-preserving on a first application, `0020`'s loop covers every overload
of every named function (the whole public function surface is now unreachable by
`anon`/`authenticated`/`PUBLIC`), and `public.follows` has lost every write grant
with `authenticated` keeping only SELECT. The findings below are residual
robustness/consistency items, all non-live.

---

## Findings

### v27-01 — `0021` still carries the signature-specific, fail-open guard that `0020` was fixed for — low, non-live

- **Side:** db / migration
- **File:** `supabase/migrations/0021_revoke_profile_column_guard.sql:16`
  (`if to_regprocedure('public.protect_profile_columns()') is not null then`),
  `:17` (single `revoke all on function public.protect_profile_columns()`)
- **Evidence:** `d81ddef` explicitly replaced this exact pattern in `0020`
  (`v26-02`: "signature-specific and fails open", loop over every overload), but
  `0021` — written one round earlier for the same sweep — was left as
  `to_regprocedure('public.protect_profile_columns()')`. If that function ever
  gains a parameter, the guard evaluates to `null`, the revoke is **skipped
  silently**, and `0021` reports success; the same silent skip covers any second
  overload, because the revoke names one signature only. I confirmed both modes
  experimentally in the scratch database: an ad-hoc overload of
  `latest_badge_stats(text)` was revoked by `0020`'s loop (anon EXECUTE `true` →
  `false`) while an equivalent single-signature revoke would not have matched it.
- **Why it is a bug:** it is the identical defect the commit fixed one file over,
  left in place — the next agent reading `0020` will reasonably assume the class is
  closed. Impact today is nil: `protect_profile_columns()` is a trigger function
  whose signature is pinned by its trigger, and production's live ACL for it is
  `{postgres=X/postgres,service_role=X/postgres}` with `anon`/`authenticated`/
  `PUBLIC` all false.
- **Confidence:** high (code is unambiguous; the fail-open behaviour was
  demonstrated on the same construct in `0020`).
- **Fix direction:** give `0021` the same `do $$ … foreach target … for sig in
  pg_proc where proname='protect_profile_columns'` loop as `0020`, or fold the
  name into `0020`'s array and delete the file's body (it would then be a no-op on
  an already-migrated database, which is fine).

### v27-02 — `0022`'s explicit privilege list omits `MAINTAIN`; `revoke all` would be PG17-proof — low, non-live

- **Side:** db / migration
- **File:** `supabase/migrations/0022_close_orphan_follows_grants.sql:18-23`
- **Evidence:** the revoke enumerates `insert, update, delete, truncate,
  references, trigger`. PostgreSQL 17 added the `MAINTAIN` table privilege
  (VACUUM/ANALYZE/REINDEX/CLUSTER/LOCK TABLE). Production reports
  `server_version` **17.6**, and the live `relacl` of `public.follows` is
  `{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,authenticated=r/postgres}`
  — note the `m`: Supabase's default grant *does* include `MAINTAIN` for
  `service_role`, and it was present on `authenticated` only up to its own
  explicit list. `has_table_privilege('authenticated','public.follows','MAINTAIN')`
  and the same for `anon` are both **false**, so nothing is exposed today; the
  omission is latent.
- **Why it is a bug:** the file's stated goal is "an authenticated client could
  write rows into a table nothing reads" — a future re-grant that lands `MAINTAIN`
  (a plain `grant all`, or a replayed default-privileges setup) would survive the
  revoke while the file still claims the write surface is closed.
- **Confidence:** high for the omission; the exposure is currently absent
  (verified via `has_table_privilege`, not via `information_schema`, which does not
  list `MAINTAIN`).
- **Fix direction:** `revoke all on public.follows from anon, authenticated;` then
  `grant select on public.follows to authenticated;` — the same shape `0022`
  already uses for the read path.

### v27-03 — `0011` closed only SELECT; `anon`/`authenticated` still hold `TRUNCATE`/`REFERENCES`/`TRIGGER`/`MAINTAIN` on both blog tables — low, not remotely reachable

- **Side:** db / migration
- **File:** `supabase/migrations/0011_public_read_blog_engagement.sql:26-30`
- **Evidence:** production `relacl` is
  `blog_views = {…,anon=Dxtm/postgres,authenticated=Dxtm/postgres,…}` and
  `blog_reactions = {…,anon=aDxtm/postgres,authenticated=adDxtm/postgres,…}`
  (`D`=TRUNCATE, `x`=REFERENCES, `t`=TRIGGER, `m`=MAINTAIN). `0011` revoked only
  table-level SELECT and replaced it with column grants, so the remaining
  privileges are untouched — exactly the class `0022` was written to close for
  `follows` (it revokes `truncate, references, trigger` there).
- **Why it is a bug:** `TRUNCATE` bypasses RLS and would let whichever role holds
  it wipe both engagement tables. It is **not** exploitable from the public API:
  `pg_roles` shows `anon.rolcanlogin = false` and `authenticated.rolcanlogin =
  false`, so neither can open a database session, and PostgREST exposes no
  TRUNCATE verb. This is a defence-in-depth gap and a documented-pattern
  inconsistency, not a live vuln.
- **Confidence:** high on the ACL facts; high that it is unreachable today (two
  independent reasons above).
- **Fix direction:** add `revoke truncate, references, trigger, maintain on
  public.blog_views, public.blog_reactions from anon, authenticated;` in a new
  migration (do not retrofit `0011` — it is already applied in production).

### v27-04 — `0020`'s loop errors hard on a PROCEDURE of a swept name (fails closed, aborts the file) — info

- **Side:** db / migration
- **File:** `supabase/migrations/0020_close_orphan_function_surface.sql:37-57`
  (`foreach target … for sig in … execute format` at `:52`, `:55`)
- **Evidence:** with a procedure created as `touch_updated_at(integer)`, the loop's
  `revoke all on function public.touch_updated_at(integer) …` raised
  **`42809` "touch_updated_at(integer) is not a function"** and aborted the file
  (rolled back). The loop selects from `pg_proc` without filtering `prokind`, and
  `proname` matches a procedure. Conversely an *aggregate* of the same name was
  handled correctly (`prokind='a'`, anon EXECUTE revoked), as was an ad-hoc
  function overload.
- **Why it is a bug:** it cannot *miss* a grant (it fails closed), so it is not a
  security defect — but a future procedure sharing one of the six names would
  abort `0020` and therefore every later migration in a lost-ledger replay, with an
  error that does not name the actual conflict.
- **Confidence:** high (reproduced).
- **Fix direction:** add `and p.prokind in ('f','a','w')` to the loop's select, or
  branch on `prokind` to emit `revoke … on procedure …` for `'p'`. Not urgent: no
  procedure exists in production (all six rows are `prokind='f'`).

### v27-05 — the commit message's migration count is wrong (22 files, not 21) — info

- **Side:** docs / commit record
- **File:** commit `d81ddef` body ("a full replay of all 21 migrations … 21/21 OK in
  two configurations") vs `supabase/migrations/` (22 files, `0001`–`0022`) and
  production's `supabase_migrations` ledger (22 rows, `0011` applied
  `2026-09-22T07:02:11Z` … `0022` at `20:00:40Z`).
- **Evidence:** `readdirSync('supabase/migrations').filter(.sql).sort()` → 22;
  my replay harness confirms `fileCount = 22`.
- **Why it is a bug:** the number is the load-bearing claim of the commit; a reader
  who trusts "21" and later counts 22 cannot tell whether a file was added after
  verification. The verification itself (and the two-configuration result) is
  correct — only the count is off by one.
- **Confidence:** high.
- **Fix direction:** none needed in code; correct the count if the message is ever
  quoted in a report.

### v27-06 — the atomic script's self-restore refreshes `updated_at` on the test profile — info

- **Side:** scripts / test harness
- **File:** `scripts/verify-atomic-economy.ts:217` (the `finally` restore),
  `:228` (`updated_at: new Date().toISOString()` overwriting the snapshot value)
- **Evidence:** the restore writes the snapshot back column-for-column but then
  overwrites `updated_at` with "now", so "no trace" is exact for every numeric
  column and for row counts (verified) but not for that one timestamp on the one
  test row. Pre-existing behaviour, not introduced by `d81ddef`, and no user-visible
  surface reads `user_progress.updated_at`.
- **Why it is a bug:** it is the only way the script's "leaves no trace" claim is
  not literally true, so it is worth recording rather than rediscovering.
- **Confidence:** high (code + the profile's `updated_at` is the only column the
  snapshot cannot preserve).
- **Fix direction:** drop `updated_at` from the update payload, or restore the
  snapshot's own `updated_at`.

---

## 1. Migration replay

Harness: files applied in `readdirSync(...).sort()` order, one transaction per file
(the same shape as `scripts/db-apply.ts`), exceptions recorded with their SQLSTATE.
Throwaway database dropped at the end.

| Configuration | Result | First failure |
| --- | --- | --- |
| **A** — all 22 files from scratch | **22/22 OK** | none |
| **B** — the whole set a second time on top of A (empty catalog) | **22/22 OK** | none |
| **B′** — `0002`..`0022` again on an *intact* post-A schema (0001 skipped) | **21/21 OK** | none |
| **B″** — the whole set again with one catalog row present | stops at `0001` | `0001_init.sql` — `P0001` "Refusing to re-apply 0001_init.sql: public.badges already holds 1 row(s)…", **documented intentional** in the file's own guard (`0001_init.sql:17-26`) |

B′ is the meaningful form of (b): the documented lost-ledger scenario is "the
schema is intact, the ledger is gone", and in that configuration every file after
`0001` replays cleanly. The only way the set stops is `0001` refusing to destroy a
non-empty catalog, which is deliberate and self-documenting. There is therefore
**no undocumented first failure in either configuration**.

Controls confirming the guards are what makes A/B/B′ possible (pre-`d81ddef`
bodies, re-applied on the existing objects): `0011` → `42710` ("policy
blog_views_public_read … already exists"), `0015` → `42710` ("constraint
coin_rain_gate_giver_key_len … already exists"), `0017` → `42P13` ("cannot change
return type of existing function"). That matches the commit message exactly.

Two properties of the replay target were checked because they could have made a
guard fail on *production* even though the empty scratch database passed:
`public.coin_rain_gate` holds **0 rows** and 0 rows violating the 8..128 CHECK, so
`0015`'s drop-and-re-add of a *validated* constraint cannot fail; and
`pg_depend` reports **no non-internal dependents** on
`consume_and_apply_game_xp(uuid,date,integer,bigint)` or
`apply_pair_deltas(uuid,bigint,uuid,bigint)`, so `0017`'s `drop function` cannot be
blocked.

## 2. `scripts/verify-atomic-economy.ts`

- **Real script:** exit **0**, `ALL CHECKS PASSED`, 17 `PASS` lines, 0 `FAIL`.
  Restore: `EXACT (xp 3610/3610, coins 1840/1840, level 11/11)
  feedRowsRemoved=6 achievementRowsRemoved=4`.
- **Deliberately wrong expectation (by construction):** a copy of the script with
  the single expectation `3` → `999` on the `single award xp` check (run from
  outside the repository, compiled against the repo tsconfig; no project file was
  written) printed `FAIL single award xp: got 3, expected 999` and
  `1 CHECK(S) FAILED`, and exited **1**. The check is now a gate, not a report.
- **`process.exitCode` is not reset:** `grep -n "process.exit\|exitCode"` over both
  economy scripts finds **no `process.exit(0)` anywhere** — the only `process.exit`
  calls are the two `process.exit(1)` in the `main().catch` handlers. The final
  `return` after `process.exitCode = 1` falls out of `main()`, the `.catch` never
  fires on the success path, and Node honours the assigned code. Confirmed by the
  observed exit 1.
- **No trace:** production row counts identical before and after both scripts —
  `activity_events=20, user_achievements=13, user_progress=1, notifications=1,
  changelog=319, push_subscriptions=0, badges=476, blog_posts=26, max_event_id=20`.
  (See v27-06 for the one caveat: `user_progress.updated_at` is refreshed on the
  test row.)

## 3. The three idempotence guards (`0011`, `0015`, `0017`)

- **Applied twice in one transaction:** all three clean (as are `0020`, `0021`,
  `0022`). Nothing aborted, nothing left half-applied.
- **First application unchanged:** the checks are purely additive — the diffs
  against `d81ddef^` are `drop policy if exists` ×2 (`0011:15,20`), `drop constraint
  if exists` (`0015:48`), `drop function if exists` (`0017:18`). I verified this
  behaviourally, not by reading: on a state where the object does **not** exist, the
  guarded and pre-guard bodies were each applied in a rolled-back transaction and
  the resulting state was captured as JSON and compared — policies + column
  privileges + table privileges for `0011`; `coin_rain_gate` constraints + the
  `apply_pair_deltas` definition and ACL for `0015`; the definitions/ACLs of
  `consume_and_apply_game_xp`/`consume_game_xp`/`apply_xp_coins` for `0017`. In all
  three cases **guarded state == pre-guard state**. The guards change only what
  happens when the object already exists.
- **Intended end state confirmed in production:** `0011` — `blog_views` anon/auth
  hold column SELECT on `(post_id, created_at)` and **no** table-level SELECT;
  `blog_reactions` on `(post_id, emoji, created_at)`; `ip_hash` is not grantable for
  either role, and the blog page's two anon reads (`.select("post_id")`,
  `.select("emoji")`) are exactly covered. `0015` — `coin_rain_gate_giver_key_len`
  = `CHECK (length(giver_key) >= 8 AND length(giver_key) <= 128)`. `0017`/`0018` —
  `consume_and_apply_game_xp(uuid,date,integer,bigint)` returns
  `TABLE(out_xp bigint, out_coins bigint, granted integer)`, ACL
  `{postgres=X/postgres,service_role=X/postgres}`.

## 4. `0020`'s overload loop

- **Live ACLs, all six names (production):**
  `latest_badge_stats(integer)`, `get_own_profile_email()`, `handle_new_user()`,
  `touch_updated_at()`, `touch_badges_updated_at()`, `protect_profile_columns()`
  each report `acl = {postgres=X/postgres,service_role=X/postgres}` with
  `has_function_privilege` for `anon` = false, for `authenticated` = false, for
  `public`/`PUBLIC` = false, and `service_role` = true.
- **The sweep actually closed the surface, not just the six names:** enumerating
  every `public` function for which `anon`, `authenticated` **or** `PUBLIC` holds
  EXECUTE returns **`[]`** — there is no reachable function left to miss. No
  function with one of the six names exists outside `public`.
- **Can the loop miss an overload?** No. It selects `pg_proc` by `proname` and
  namespace, so every overload is a row. Verified empirically: an ad-hoc
  `latest_badge_stats(text)` overload granted to `anon` had anon EXECUTE revoked by
  running the file (`true` → `false`), and an *aggregate* of the same name
  (`prokind='a'`) was revoked too. `regprocedure` renders a fully-qualified
  signature, so `execute format` is unambiguous per overload.
- **No-op on a database without them:** verified — with all four existing swept
  functions dropped, `0020` completes cleanly (the loop's SELECT simply returns no
  rows), and it is a genuine no-op on the fresh scratch install, which never has
  `latest_badge_stats`/`get_own_profile_email`. The only failure mode is a
  same-named PROCEDURE, which errors rather than skipping (v27-04).

## 5. `public.follows`

- **Write grants gone:** production `relacl` for `authenticated` is `r` (SELECT)
  and nothing else; `anon` holds **no** privilege at all. `has_table_privilege`
  returns false for `anon`/`authenticated` on INSERT, UPDATE, DELETE, TRUNCATE,
  REFERENCES, TRIGGER and MAINTAIN. `service_role` keeps `arwdDxtm` (server-only,
  bypasses RLS, and the file's revoke was explicitly scoped to
  `anon, authenticated`).
- **`authenticated` kept only SELECT:** confirmed at table level (`r`) and at
  column level (SELECT on `created_at, followed_id, user_id`). The row policy
  `follows select public` still lists `{anon, authenticated}`, but `anon` has no
  table-level SELECT, so a policy alone grants it nothing — `anon` cannot read.
- **Nothing depends on it:** `count(*)` = 0; no `pg_constraint` has
  `confrelid = 'public.follows'::regclass` (no FK points at it); no `pg_rewrite`
  entry references it (no view depends on it); the only `pg_depend` rows are its own
  policies, type, constraints, index and column default. `grep -rn "follows"` over
  `src`, `scripts` and `supabase` finds only prose ("follows the same philosophy")
  and `0022` itself — **no code and no migration reads or writes the table**.
  A future `drop table public.follows` would therefore be safe to propose; nothing
  in the repo would break, only whatever unknown external client the file chose not
  to risk.

## 6. Economy scripts — numbers and exit codes

```
npx tsx scripts/verify-atomic-economy.ts   → exit 0, 17 PASS / 0 FAIL,
   restore EXACT (xp 3610/3610, coins 1840/1840, level 11/11,
   feedRowsRemoved=6 achievementRowsRemoved=4), achievements evaluated 123
copy with expectation 3 → 999              → exit 1, "FAIL single award xp: got 3,
                                              expected 999", "1 CHECK(S) FAILED"
npx tsx scripts/verify-game-economy.ts     → exit 0, 13/13 games ok
   rps .9691  slots .1326  shoot .9027  memory .8883  quiz .7966  coinflip .9695
   hilo .9824  roulette .3830  blackjack .5852  vault .8987  scratch .9884
   tower .9021  catcher .8550
   worst: scratch at 0.9884 — no game returns more than the stake
```

Row counts (production) are identical before and after: `activity_events=20,
user_achievements=13, user_progress=1, notifications=1, changelog=319,
push_subscriptions=0, badges=476, blog_posts=26, max_event_id=20`. The
`verify-game-economy` worst ratio moves between runs (the commit recorded 0.9886,
this run 0.9884) — Monte-Carlo variance over 200k rounds, still `< 1.0`.

## 7. Is any live defect left in this commit's scope?

**No.** Every claim in `d81ddef` reproduces: the script fails when a check fails
and passes when they all pass; the three guarded migrations replay cleanly and
produce exactly the pre-guard state on a first application; `0020`'s loop revokes
every overload of every named function and leaves the public function surface
unreachable by `anon`/`authenticated`/`PUBLIC`; `public.follows` has lost its write
grants and `anon`'s read. Both replay configurations complete, and the only
stopping point (`0001` on a non-empty catalog) is intentional and self-documented.
The five substantive findings are residual: three are the *same class* the commit
fixed, left unapplied one file or one privilege over (v27-01, v27-02, v27-03), and
two are record-keeping/harness caveats (v27-04, v27-05, v27-06). None is
exploitable today: `anon` and `authenticated` are `NOLOGIN`, PostgREST exposes no
TRUNCATE verb, and the residual `MAINTAIN`/`TRUNCATE` grants and the trigger
function `protect_profile_columns()` are all confirmed absent or unreachable by
live `has_*_privilege`/`pg_roles` queries.

---

## Cleanup

- `select datname from pg_database where datname like 'v27%'` → `[]` (scratch
  database dropped).
- `git status --porcelain` → empty (this report excepted; it is the only file added).
- Production row counts re-read after every write and identical to the pre-run
  values above.