# Verification — Round 26

Scope: commit `3e0fdbe` ("my migration would have blocked a fresh install") —
guarded revokes in `0020`, new migration `0021`, the profile-page inventory
section, and the rewritten check in `scripts/verify-atomic-economy.ts` — plus the
**portability class** the round-25 agent found one instance of.

Read-only with respect to project files: nothing in the repository was edited,
created or deleted; this report is the only new file. `git status --porcelain` was
empty before the first probe and empty again before this file was written.

Live DB work used the session pooler (`5432`). Every probe that could mutate was
rolled back or ran in a throwaway database: I created `zbr26_replay` via
`create database` (the pooler user has `CREATEDB`), shimmed the Supabase
primitives (`auth.users`, `auth.uid()`, `extensions`), replayed the migrations
there, and **dropped it again** — verified after the fact: `select datname from
pg_database where datname like 'zbr26%'` → `[]`. The sanctioned
`verify-atomic-economy.ts` run is the only production write and it restored
itself exactly (numbers below); production state re-read afterwards is identical
to the values the script reports as its baseline.

**Verdict up front.** The portability fix works: a real replay of all 21
migrations into an empty database completes with **0 failures**, and the same
replay of the *pre-fix* `0020` body fails exactly as reported (`42883`). Static
analysis of all 160 object-referencing statements finds **no unguarded reference
to anything an earlier migration does not create**. Four of the five attack points
are clean; the four new findings are all non-live (one test-harness gap, one
residual of the guard's design, one unrelated drift object, one idempotence gap).

---

## Findings

### v26-01 — a failing `check()` does not fail the run; the commit's "fails the run" claim is now inaccurate — low, without a CI consumer

- **Side:** scripts / test harness
- **File:** `scripts/verify-atomic-economy.ts:46-50` (`failures` counter),
  `:208` (the new assertion), `:256` (final print), `:259-262` (`main().catch`)
- **Evidence:** `check()` only does `if (!ok) failures += 1` and the last statement
  of `main()` is `console.log(failures === 0 ? "ALL CHECKS PASSED" : \`${failures}
  CHECK(S) FAILED\`)`. The only `process.exit(1)` is inside `main().catch(...)`,
  i.e. it fires on a **rejection**, not on a mismatch. So an assertion that fires
  prints `N CHECK(S) FAILED` and the process still exits **0**.
  Demonstrated that the new assertion is a real predicate (not a tautology) against
  the real module: `ACHIEVEMENTS=125 ACTIVE=123 ACH_BY_ID=125`,
  `["c_first_login","c_ach_10"] -> unknown=[] -> PASS`,
  `["c_first_login","totally_bogus_achievement_id"] -> unknown=["totally_bogus_achievement_id"] -> FAIL`,
  `[] -> unknown=[] -> PASS`. Live run today: `PASS every unlocked id resolves to a
  known achievement: got 0, expected 0`.
- **Why it is a bug:** the change is a strict improvement over the tautology it
  replaced (it can now *detect* an unrenderable id), but the commit message's
  "so an evaluation that produces something unrenderable **fails the run**" is not
  what happens: the mismatch is reported in text and the exit code stays 0. No CI
  workflow runs this script (`.github/workflows/` has only `potat-sync.yml`, and
  the script is referenced only in prose in `FIXES.md`/`bugreports/`), so nothing
  breaks today — this is a latent "the guard is not a gate" gap, the same shape as
  v25-04 but one level up. Note every one of the 17 checks shares it; the new
  assertion is simply the one whose purpose is to catch a regression a human would
  otherwise have to read for.
- **Confidence:** high (deterministic source read + an executed demonstration of
  the predicate + confirmation no workflow consumes the exit code).
- **Fix direction:** end `main()` with `process.exit(failures === 0 ? 0 : 1)`
  (or `if (failures) throw new Error(...)`), so `npm run` and any future CI step
  actually fail on a mismatch.

### v26-02 — the `to_regprocedure` guard is signature-specific and therefore fails **open** — info

- **Side:** DB / migrations (design residual of the v25-01 fix)
- **File:** `supabase/migrations/0020_close_orphan_function_surface.sql:23,28,39,43,47,53`
  (seven `to_regprocedure('<name>(<args>)') is not null` predicates)
- **Evidence (live, read-only):**
  `to_regprocedure('public.latest_badge_stats(integer)')` → **found**,
  `to_regprocedure('public.latest_badge_stats(bigint)')` → **null**,
  `to_regprocedure('public.latest_badge_stats(int)')` → found (`int` is the same
  type as `integer`; only a genuinely different signature misses).
- **Why it is worth recording:** the guard trades a loud failure (42883, which
  blocked a fresh install) for a silent skip (the revoke simply does not run). On
  any install where the object exists under a different signature — or in a
  different schema — `0020`/`0021` would complete "successfully" while leaving the
  function PUBLIC-executable, which is exactly the state the file exists to
  prevent. It is not a live defect: production's orphans are `(integer)` and `()`,
  both matched, and both are revoked (verified live, below).
- **Confidence:** high for the mechanism (probe above); the failure mode is
  hypothetical for this database.
- **Fix direction:** key the guard on the name, not the signature — e.g.
  `if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='latest_badge_stats') then execute
  'revoke all on function public.latest_badge_stats(integer) from public, anon,
  authenticated'; end if;` — still a no-op where the function is absent, but no
  longer blind to a changed signature.

### v26-03 — production carries a `follows` table (4 policies, anon-readable) that no migration creates and no code uses — info (same class as v25-01)

- **Side:** DB / drift
- **File:** none in the repository — that is the finding. Closest reference:
  `supabase/migrations/0020_close_orphan_function_surface.sql` (the file that
  documented the previous instance of this class).
- **Evidence (live, read-only):** diffing production's `public` schema against the
  schema the 21 migrations actually produce in an empty database:
  - relations in production but not produced by the set: `follows`, `supabase_migrations`
  - relations produced by the set but absent in production: **none**
  - `follows`: `owner=postgres`, `relrowsecurity=true`, `count(*) = 0`, four
    policies — `follows select public` (SELECT, roles `{anon,authenticated}`),
    `follows insert own`, `follows update own`, `follows delete own`
    (`{authenticated}`).
  - `supabase_migrations` is expected drift: `scripts/db-apply.ts:29-32` creates it.
    The third production-only function, `rls_auto_enable()`, is Supabase-managed
    (created by the dashboard's "enable RLS" helper).
  - No statement in `supabase/migrations/*.sql` names `follows`; neither does any
    file under `src/` or `scripts/` (every textual hit is the English word
    "follows" in prose).
- **Why it is worth recording:** this is the portability class *identified, not
  fixed*: an object of unknown provenance that exists only in production. Today it
  is inert — empty, unreferenced — but it is an anon-readable table in the public
  schema, and the next migration that writes a naive `revoke`/`grant`/`alter table`
  against it would reproduce v25-01 exactly. Listing it is what stops the class
  recurring.
- **Confidence:** high (live inventory diff, live policy read, repo-wide grep).
- **Fix direction:** either drop it in a migration (`drop table if exists
  public.follows cascade;`) if it is unwanted, or create it explicitly in a
  migration if it is wanted; whichever, the repo should stop differing from the
  database. Any future statement touching it must be guarded as `0020` now is.

### v26-04 — three migrations cannot be re-applied, so a lost ledger on a schema-applied database cannot be replayed past `0011` — low

- **Side:** DB / migrations (idempotence)
- **File:** `supabase/migrations/0011_public_read_blog_engagement.sql:15,18`;
  `supabase/migrations/0015_pair_deltas_and_gate_bounds.sql:46-47`;
  `supabase/migrations/0017_consume_and_apply_game_xp.sql:15`
- **Evidence (replay, throwaway DB):** applying all 21 files a **second** time
  (ledger ignored — the lost-ledger scenario the guards in `0001` exist for):
  - `0001` → refused with `P0001 ... public.badges already holds 1 row(s)` and the
    row was preserved — the guard works (tested in isolation: insert one badge,
    re-apply → refused, `badges` still `1`).
  - `0011` → `42710 policy "blog_views_public_read" for table "blog_views" already exists`
  - `0015` → `42710 constraint "coin_rain_gate_giver_key_len" for relation "coin_rain_gate" already exists`
  - `0017` → `42P13 cannot change return type of existing function`
  - everything else → OK.
  Why those three and not their neighbours: `0003`/`0004` were written defensively
  (`create table if not exists`, `drop policy if exists` — 11 such guards in
  `0003`), and `0001` deliberately refuses on data. `0011` creates its two policies
  unguarded, `0015` adds its constraint unguarded, and `0017`'s function is
  re-declared by `0018` with different OUT names, so `0017`'s own
  `create or replace` can never succeed a second time.
- **Why it is a bug:** narrow but real. With a **populated** catalog the replay
  stops at `0001` with a clear, actionable refusal — that path is fine. With an
  *empty* catalog (a staging/self-host copy that applied the schema but never ran
  the sync) `0001` proceeds, wipes and rebuilds only the tables it owns, and then
  `0011` aborts `db:apply`: the documented recovery-by-replay path cannot complete,
  which is the same outcome v25-01 had. Not live (the ledger has all 21 rows in
  production), and not reachable through `db:apply` while the ledger exists.
- **Confidence:** high (reproduced twice, in two independently configured
  throwaway databases, with the failing statements named).
- **Fix direction:** bring the three files in line with `0003`'s style —
  `drop policy if exists "blog_views_public_read" on public.blog_views;` before
  each `create policy` in `0011`, `alter table public.coin_rain_gate drop
  constraint if exists coin_rain_gate_giver_key_len;` before the `add constraint`
  in `0015`, and a `drop function if exists
  public.consume_and_apply_game_xp(uuid, date, int, bigint);` before the
  definition in `0017` (as `0018` already does).

---

## Item 1 — replay every migration from scratch: **no file fails**

Replayed into a freshly created database `zbr26_replay` (Supabase `auth`/`extensions`
shimmed, no orphans present), applying each file in filename order inside its own
transaction, ledger row inserted with the body — the same protocol as
`scripts/db-apply.ts:44-58`. Two configurations, because the first attempt lacked
Supabase's default privileges:

| configuration | result |
|---|---|
| minimal shim (pgcrypto, `auth.users`, `auth.uid()`) | **21/21 OK, 0 failures** |
| + Supabase-style defaults (`alter default privileges in schema public grant all on tables / execute on functions to anon, authenticated`) | **21/21 OK, 0 failures** |

`OK 0001_init.sql` … `OK 0021_revoke_profile_column_guard.sql`. **The first — and
only — file that fails is none.** Proof that this is the fix and not luck:
the *pre-fix* `0020` body, taken verbatim from `git show
2733467:supabase/migrations/0020_close_orphan_function_surface.sql` and run in the
same fresh schema, fails immediately with
`[42883] function public.latest_badge_stats(integer) does not exist` — the
round-25 finding, reproduced independently.

Two further checks from the same replay:

- **The surface is closed on a fresh install too.** After the full set in the
  Supabase-defaults configuration, `public` holds **13 functions and 0 of them are
  executable by `anon` or `authenticated`** — the revokes in `0006`/`0007`/`0008`/
  `0020`/`0021` override even a default that grants everything new. (Production's
  16 = those 13 + the two orphans + Supabase's `rls_auto_enable`.)
- **A harness artefact worth naming**, so the number is not read as a finding: my
  first shim ran `create extension pgcrypto` without a schema, so ~33 pgcrypto
  functions landed in `public` and the count read "49 functions, 36 anon-reachable".
  Installing pgcrypto into `extensions` (as Supabase does) gives the 13/0 above.
  The 36 was my shim, not the migrations.

Script identity is complete: 21 files on disk, 21 distinct ledger rows.

## Item 2 — static reference audit: every reference resolves

Parsed all 21 files; classified every `revoke`/`grant` on a function or table,
`alter table`, guarded `drop policy`, and `insert into`; built the creation map
(`create table/view/function/policy`, with file and line) and required the creator
to be **earlier in filename order, or earlier in the same file**.

- statements examined: **160** object references (172 with `notify pgrst`)
- resolved to an earlier migration or to an earlier line in the same file: 156
- **unguarded references to an object no earlier migration creates: 0**
- references to an object no migration creates at all: **4**, all inside
  `0020`'s `if to_regprocedure(...)` guards (below)

All 39 cross-file references, with their creators:

| reference | creator |
|---|---|
| `0008:10-16` revoke `fn` ×7 | `0006:47,66,80` / `0007:21,46,81,106` |
| `0008:20-26` grant `fn` ×7 | same |
| `0008:22-26` grant `fn` (`bump_view_count`,`bump_counters`,`claim_daily_gate`,`claim_wheel_gate`,`consume_game_xp`) | `0006:47`, `0007:21,46,81,106` |
| `0008:31,32` revoke/grant tbl `blog_reactions` | `0003:120` |
| `0009:8,29,34` alter tbl `user_progress`,`profiles`,`badges` | `0003:7`, `0001:138,59` |
| `0009:55` revoke tbl `profiles` | `0001:138` |
| `0010:9` grant tbl `profiles` | `0001:138` |
| `0011:23,24,26,27` revoke/grant tbl `blog_views`,`blog_reactions` | `0003:111,120` |
| `0012:14`, `0015:46`, `0019:12,14` | `0001:138`, `0014:18`, `0017:15` |
| `0020:42,45,48,54` revoke `fn` | `0001:156,289`, `0016:12`, `0006:22` |
| `0021:17` revoke `fn` `protect_profile_columns` | `0006:22` |
| `0005,0006…0021` `insert into changelog` (one per file) | `0001:245` |

The four with **no creator anywhere in the set** — all guarded, and the objects
they name are exactly the two orphans v25-01 is about:

```
0020:30  revoke all on function public.latest_badge_stats(integer) from public, anon, authenticated;
0020:31  grant execute on function public.latest_badge_stats(integer) to service_role;
0020:35  revoke all on function public.get_own_profile_email() from public, anon, authenticated;
0020:36  grant execute on function public.get_own_profile_email() to service_role;
```

Guarded, so on a fresh install they are skipped rather than fatal — confirmed by
the clean replay. And where the objects **do** exist they still close them: in a
rolled-back transaction against production, re-granting EXECUTE to `anon` on both
orphans and on `protect_profile_columns`, then running the current `0020` text,
turned all three back to `false`. So the guard is a no-op only where there is
nothing to close.

Live surface after `0020`/`0021`, with the corrected ACL predicate (a bare
`=X/` match hits the owner grant `postgres=X/postgres` present in every ACL — the
round-25 methodological error — so this query counts `anon=`/`authenticated=`
entries or a NULL ACL): **0 of 16 functions reachable**;
`protect_profile_columns` → `anon=false, authenticated=false`, and both orphans
already `false`.

## Item 3 — ordering

Self-consistent in filename order, and no later file depends on anything `0001`
creates *conditionally* — `0001` creates unconditionally and its one conditional
branch **raises** (`0001:17-26`) rather than skipping, so there is no silent
half-created state for a later file to trip over. The two order-sensitive pairs are
correct: `0015` alters `coin_rain_gate` (created `0014`), and `0019`'s
revoke/grant names the signature `0018` re-created (the replay proves the
signature matches — it applied cleanly). `0018`'s `drop function if exists`
followed by its `create or replace` is what keeps `(xp, coins, granted)` →
new-OUT-names legal.

## Item 4 — idempotence

| file | re-runnable? | why |
|---|---|---|
| `0001` | **no, by design** | refuses with `P0001` once `public.badges` holds a row (verified: 1 row inserted → refused → row preserved); proceeds only when the catalog is empty |
| `0003`, `0004`, `0008` | yes | `create table if not exists`, `drop policy if exists` (11 guards in `0003` alone) |
| `0002`, `0005`–`0007`, `0009`, `0010`, `0012`–`0016`, `0018`–`0021` | yes | `create or replace` / `if not exists` / `if exists` / re-runnable DML |
| `0011`, `0015`, `0017` | **no** | see v26-04 (`42710`, `42710`, `42P13`) |

Consequence for the lost-ledger scenario the `0001` guard exists for: on a populated
database the replay halts at `0001` with an actionable refusal (data safe); on a
database that applied the schema but never synced the catalog it gets past `0001`
and halts at `0011`. Either way `db:apply` cannot silently destroy or silently
half-apply — the failure is loud, not corrupting.

## Item 5 — the four fixes, each verified

1. **`to_regprocedure` guards make `0020` a no-op without the orphans — confirmed.**
   Fresh replay in both configurations: `0020` applied with no error (and the
   pre-fix body failed `42883` in the same schema). Precisely: the *orphan block* is
   a no-op; the file as a whole is not — it still revokes the four trigger functions
   that `0001`/`0006`/`0016` do create, and still writes its changelog row and
   `notify pgrst`. Where the orphans exist, the guarded revokes fire (rolled-back
   live probe above). Residual of the guard's signature-specificity: v26-02.
2. **`protect_profile_columns()` is now revoked, with the correct ACL query.**
   Live: `acl = postgres=X/postgres | service_role=X/postgres`,
   `has_function_privilege('anon'|'authenticated', …, 'EXECUTE')` = **false**;
   `0 of 16` public functions reachable. `0021` is in the ledger
   (`2026-09-22T19:01:08.358Z`) and its changelog row is `317`. The corrected query
   is the fix: my own first pass and round 25's both matched the owner grant.
3. **The inventory section renders "hidden" for a visitor of a member with
   `inventory_public: false`, showing no count — confirmed by the source, latent on
   live data.** `page.tsx:214` `inventoryVisible = isOwn || (profile.inventory_public
   && showInventory)`, `isOwn = Boolean(viewer && profile && viewer.id === profile.id)`
   (`:80`, so a logged-out visitor is never the owner). The section is now gated only
   by `{profile && (` (`:573`), so for `inventory_public: false` the visitor takes
   the `else` branch at `:590-594` → `t("inventoryHidden")`, and the heading at
   `:576-580` renders `t("owned")` **without** a count (the count path is the
   `inventoryVisible` arm). Every other inventory-derived number stays behind
   `inventoryVisible`: `ownedBadges.length` at `:405`/`:409` and `percent` at `:413`
   are inside `{inventoryVisible && (` (`:402`), and `getInventory` is not even
   called when hidden (`:217`). The 11 `inventoryHidden` keys exist in all 11 locale
   files. It is latent, not observable: the single live profile is `inventory_public
   = true` with 0 inventory rows, so no visitor currently sees the hidden branch.
4. **The new check fails when an unknown id is returned — demonstrated, not read.**
   Against the real module: `ACH_BY_ID` has 125 entries (123 active + the 5 meta
   ids, which *are* defined — as enum members at `achievements.ts:141-145`), and the
   predicate `unlocked.filter(id => !ACH_BY_ID.has(id))` yields `0` for resolvable
   ids and `1` for `["c_first_login","totally_bogus_achievement_id"]`. `check()` with
   `actual=1, expected=0` increments `failures`. The remaining gap is that the
   process still exits 0 — v26-01.

## Item 6 — both economy scripts, exact numbers

**`npx tsx scripts/verify-atomic-economy.ts` → 17/17 PASSED, `ALL CHECKS PASSED`,
exit 0.** `restore: EXACT (xp 3610/3610, coins 1840/1840, level 11/11)
feedRowsRemoved=6 achievementRowsRemoved=4`; `PASS every unlocked id resolves to a
known achievement: got 0, expected 0`; `achievements evaluated: 123 | unlocked for
this profile: 4`. Production re-read after the run: `user_progress` xp 3610 /
coins 1840 / level 11, `user_achievements = 13`, `activity_events = 20`,
`user_inventory = 0`, `changelog = 318` rows (the commit's own entry is row **318**,
`0021`'s is row **317**, so the UI and test changes *are* logged in the changelog as
`AGENTS.md` requires), ledger 21 rows / 21 distinct.

**`npx tsx scripts/verify-game-economy.ts` → 13/13 ok, exit 0**, worst game
**hilo 0.9869** (commit reports 0.9851; Monte-Carlo variance, same verdict — no game
returns more than the stake). No DB writes (the script stubs `supabase`).

| game | avg payout/bet | | game | avg payout/bet |
|---|---|---|---|---|
| rps | 0.9661 | | roulette | 0.3755 |
| slots | 0.1306 | | blackjack | 0.5834 |
| shoot | 0.8972 | | vault | 0.9041 |
| memory | 0.8832 | | scratch | 0.9824 |
| quiz | 0.8017 | | tower | 0.9032 |
| coinflip | 0.9690 | | catcher | 0.8622 |
| hilo | **0.9869** | | | |

## Item 7 — is any **live** defect left in this commit's scope?

**No.** Everything this commit changes in production is verified correct on
production: `0 of 16` public functions are `anon`/`authenticated`-executable,
`protect_profile_columns` included; the guarded `0020` still closes both orphans
where they exist (rolled-back probe); the three revoked trigger functions remain
wired and fire (round 25's table stands — PostgreSQL does not check `EXECUTE` on
trigger functions); the inventory section's only live-reachable change is a heading
that now omits its count when the inventory is not visible to the viewer, and the
sole live profile is `inventory_public = true`, so even that is not observable; the
economy RPCs and both cash games are unchanged and re-verified.

The commit's own headline defect — `0020` aborting a fresh install — is **fixed**,
proven by a real replay rather than by reasoning: 21/21 in a blank database, in two
configurations, against a pre-fix control that fails `42883`.

What is left is non-live and small: `v26-01` (a failing check still exits 0),
`v26-02` (the guard's signature-specificity fails open), `v26-03` (`follows` drift,
inert but in the same class), `v26-04` (three files are not re-runnable, so a
lost-ledger replay stops at `0011` only when the catalog is empty). None of them
affects the running site.

## Residuals already on record (not re-reported)

`v24-03`'s missing `topCoinsRes` tie-break, `v24-04`'s unindexed scan per
evaluation, and `v24-05`'s Supabase `alter default privileges` re-granting new
`public` functions stand unchanged; they are listed as open in earlier rounds and
are not part of this commit.