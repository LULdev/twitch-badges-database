# Verification — Round 25

Scope: commit `2733467` ("finish the inventory gate, add the missing achievement
coverage, close the function surface") — migration `0020`, the profile-page
inventory gate, the `s_top_percent` coin floor, and the new
`evaluateAchievements` call in `scripts/verify-atomic-economy.ts`.

Read-only with respect to project files: nothing was edited, created or deleted;
the only new file is this report. `git status --porcelain` was empty before and
after (`bugreports/verify-round25.md` is the sole addition). Live DB work was
done through the session pooler (`5432`, no need for `6543`); every probe that
could mutate ran inside a transaction that was **rolled back** (roles, tables,
triggers, `drop function`, the full `0020` text, and all `set local role` calls).
The sanctioned `verify-atomic-economy.ts` run is the only production write and it
restored itself byte-for-byte (see the numbers below).

**Verdict up front.** Four of the six attack points are clean: the two orphans
really are orphans, the three trigger functions still fire (and revoking their
`PUBLIC` grant cannot break a trigger or a signup — proven against a role that has
no `EXECUTE` on the function at all), the inventory gate now covers every
inventory-derived number on the page, and the coin floor makes `s_top_percent`
honest. Two real defects remain, both **non-live**: migration `0020` is not
fresh-install-safe (it revokes on two objects it admits no migration creates), and
the sweep that claims to have closed the public function surface missed one of the
four trigger functions it was aiming at. No **live** defect is left in scope.

---

## Findings

### v25-01 — migration `0020` aborts on a fresh install because it revokes on two functions it does not create — high (reproducibility; not live)

- **Side:** DB / migrations
- **File:** `supabase/migrations/0020_close_orphan_function_surface.sql:22-28`
  (`revoke all on function public.latest_badge_stats(integer) …` and
  `revoke all on function public.get_own_profile_email() …`)
- **Evidence (live, rolled back):**
  - `revoke all on function public.definitely_absent_xyz(integer) from public;`
    → `ERROR 42883 function public.definitely_absent_xyz(integer) does not exist`
    (there is no `IF EXISTS` form of `REVOKE ... ON FUNCTION`).
  - Simulated fresh install inside one rolled-back transaction: `drop function
    public.get_own_profile_email(); drop function public.latest_badge_stats(integer);`
    then the full `0020` text → **`ERROR 42883 function
    public.latest_badge_stats(integer) does not exist`**.
  - The same full text re-run with the orphans present completes cleanly (`C` in
    probe, no error) — so the failure is exactly the absent-object case.
  - `scripts/db-apply.ts` runs every pending file in one transaction and inserts
    the ledger row only after the body succeeds; on the error the transaction
    rolls back and the process throws, so `0001…0020` would stop at `0020` and
    every later migration would never apply. `README.md:35` documents
    `npm run db:apply` as the fresh-install schema step, and the migration ledger
    shows `0020` applied at `2026-09-22T18:29:15.758Z` (production is past it).
- **Why it is a bug:** the migration's own header says the two RPCs are
  "leftovers from an earlier prototype: … so a fresh install does not have them"
  — and then the body unconditionally revokes on them. The stated premise
  guarantees the error it hits. A migration that cannot run on the install path
  the README prescribes is a hard break, even though production (already migrated)
  is unaffected.
- **Confidence:** high (both halves reproduced live, plus the `db-apply`
  source read).
- **Fix direction:** make the two revokes conditional —
  `do $$ begin if to_regprocedure('public.latest_badge_stats(integer)') is not null
  then execute 'revoke …'; … end if; end $$;` — or `drop function if exists` them.
  Guarding keeps production's closure and makes the file portable.

### v25-02 — the "close the function surface" sweep missed `protect_profile_columns()`, which is still `PUBLIC`/anon/authenticated-executable — low

- **Side:** DB / grants
- **File:** `supabase/migrations/0020_close_orphan_function_surface.sql:1-8` (the
  enumeration lists three trigger functions) and `:30-32` (the revokes) — the
  fourth trigger function is absent from both.
- **Evidence (live `pg_proc.proacl`):**
  `protect_profile_columns` = `{=X/postgres,postgres=X/postgres,service_role=X/postgres}`,
  `has_function_privilege('anon'|'authenticated', …, 'EXECUTE')` = **true** (via
  the `=X` PUBLIC entry). A real call as `anon` inside a rolled-back transaction
  passes the ACL check and only then fails with `0A000 trigger functions can only
  be called as triggers`, whereas the three functions `0020` did revoke return
  `42501 permission denied`. (`0008_grant_hardening.sql:17` had already tried to
  revoke this function from `anon, authenticated`, but that was a no-op: they never
  held a direct grant, only the default PUBLIC one.)
- **Why it is a bug:** the commit message asserts "nothing is anon-reachable", and
  item 1's own test is "NO function in `public` is executable by `anon`,
  `authenticated` or PUBLIC". One function still is. It is not exploitable — a
  trigger function cannot be invoked directly (`0A000`) — so this is a defence-in-depth
  consistency gap and a false claim in the commit narrative, not a live exposure.
- **Confidence:** high (live ACL + live anon call).
- **Fix direction:** add
  `revoke all on function public.protect_profile_columns() from public, anon, authenticated;`
  to `0020` (or a follow-up migration) so the sweep matches its own statement.

### v25-03 — the outer gate makes the hidden-inventory notice unreachable and orphans 11 translation keys — low

- **Side:** UI (server component)
- **File:** `src/app/[locale]/profile/[username]/page.tsx:571` (outer
  `{profile && inventoryVisible && (`) vs `:578-590` (inner
  `{inventoryVisible ? … : <div>{t("inventoryHidden")}</div>}`)
- **Evidence:** inside the outer condition `inventoryVisible` is always true, so
  the inner `else` (`inventoryHidden`, `:588`) is dead. Before this commit the
  outer condition was `{profile && (`, so a visitor of a member with a hidden
  inventory saw the card "This collector keeps their inventory private."
  (`messages/en.json:215`, present and identical in all 11 locale files). That
  card can no longer render for anyone; all 11 `inventoryHidden` keys are now
  unreachable, and the visitor gets no indication that an inventory exists but is
  private.
- **Why it is a bug:** the commit's goal (do not publish a false
  "0 owned / N missing / 0%") is achieved, but it also silently removed a truthful,
  translated user-facing message and left dead code plus 11 dead i18n keys behind.
  This is a behaviour regression, not a false claim.
- **Confidence:** high (deterministic read of the two conditions; key present in
  every locale).
- **Fix direction:** if the notice is wanted, render it under its own condition
  (`profile && !inventoryVisible && showInventory && !isOwn`); if not, delete the
  branch and the 11 keys so the i18n audit stays honest.

### v25-04 — the new "achievement evaluation returns a list" check is a tautology; the failure path exists but the check asserts nothing about the outcome — info

- **Side:** scripts / test coverage
- **File:** `scripts/verify-atomic-economy.ts:205-208` (and `:44` for
  `achievementHigh`, `:16` for the import)
- **Evidence:** the added check is
  `check("achievement evaluation returns a list", Array.isArray(unlocked) ? 1 : 0, 1)`.
  `evaluateAchievements` returns `Promise<string[]>` or throws
  (`src/lib/gamification/achievements.ts:294-376`), so `Array.isArray` is true for
  any successful call — the assertion cannot fail for a wrong result. A throw does
  fail the run, but by stack propagation: there is no `catch`, so the rejection
  leaves the `try/finally` and reaches `main().catch(… process.exit(1))`
  (`:230-233`). Live run confirms the coverage is real (123 evaluated, 4 unlocked)
  and the envelope is complete (below).
- **Why it is worth recording:** the commit's own correction ("the new signals had
  no coverage") is now half-addressed — the two new signal branches are *executed*
  (so `accountAgeDays` / `topCoinsRes` cannot throw unnoticed), but nothing asserts
  that any of them is still able to unlock. A regression that silently made every
  `check()` return false would still print `17/17 PASSED`. Not a live defect.
- **Confidence:** high (source read + live run).
- **Fix direction:** assert an expected unlock count for a known fixture, or at
  least `unlocked.length >= 1` on a profile that should qualify, instead of
  `Array.isArray`.

---

## Areas found clean

### 1. The three trigger functions still fire, and revoking `PUBLIC` cannot break them (item 1) — clean

Confirmed first that the objects exist and are wired:
`auth.users` → `on_auth_user_created` → `handle_new_user()`;
`profiles` → `profiles_touch_updated` → `touch_updated_at()`,
`profiles_protect_columns` → `protect_profile_columns()`;
`blog_posts` → `blog_posts_touch_updated` → `touch_updated_at()`;
`badges` → `badges_touch_updated` → `touch_badges_updated_at()`.

Trigger semantics, all in rolled-back transactions, with `updated_at` pre-aged to
`2000-01-01` so a constant `now()` cannot mask the answer:

| test | result |
|---|---|
| `badges` `last_seen_at`-only update | `updated_at` **kept** at 2000 (0016 behaviour) |
| `badges` no-op update (same values) | `updated_at` **kept** at 2000 |
| `badges` real change (`title` a→b) | `updated_at` **moved** to now |
| `profiles` no-op update | `updated_at` **moved** to now (unconditional, as documented) |

The load-bearing new fact: a fresh role was created with **no** `EXECUTE` on
`touch_updated_at` (`has_function_privilege` = false), a table owned by `postgres`
with that trigger attached was updated *as that role*, and the update succeeded
with the trigger ran (`updated_at` moved). PostgreSQL does not check `EXECUTE` on
trigger functions, so `0020`'s revokes neither stop the triggers nor break
`handle_new_user` for `supabase_auth_admin` (which only ever held `PUBLIC`), nor
the `profiles_self_update` path for an authenticated user. `handle_new_user` still
exists for the auth trigger.

### 2. The two orphan RPCs really are orphans (item 2) — clean

- A repo-wide search (excluding `node_modules`/`.next`/`.git`) finds
  `latest_badge_stats` / `get_own_profile_email` **only** in
  `supabase/migrations/0020_…sql` and in the `bugreports/` prose. No `src/` file,
  no `scripts/` file, no other migration, and no README reference.
- They are not views (`pg_views` on `public` has neither name), and each name
  exists as exactly one function in exactly one schema (`public`). No
  `create function` / `create or replace function` of either name exists anywhere
  in `supabase/`.
- What would break on a fresh install: **nothing depends on them**, so their
  absence breaks nothing by itself — the only thing that breaks is `0020` itself
  (`v25-01`).
- Revoke vs drop: revoking is the right *stance* — nothing in the repo references
  them, but they were not created by any migration, so deleting an object of
  unknown provenance is the irreversible choice while revoking is reversible and
  closes the exposure. The mistake is not the choice, it is doing it
  **unconditionally** on objects the file itself says are absent from a fresh
  install. The correct form is the guarded revoke in `v25-01`; dropping is
  unnecessary.

### 3. The inventory gate (item 3) — clean

With `inventoryVisible = isOwn || (profile.inventory_public && showInventory)`
(`page.tsx:214`):

- **Visitor of `inventory_public: false`:** `getInventory` is skipped (`:217`),
  `ownedBadges` stays `[]`, and every place that would print it is now inside the
  gate. Grep of the whole page: `ownedBadges.length` appears at `:405`, `:575`,
  `:579`; `percent` only at `:413` (computed `:241-243`); `totalCatalog` only at
  `:409` (computed `:219`). All three sites are inside `{inventoryVisible && (…)}`
  (`:402-417`) or `{profile && inventoryVisible && (…)}` (`:571`). No
  `owned`/`missing`/`completion` claim survives; `generateMetadata` publishes no
  inventory number; the only other `owned` heading (`:599`) is the `!profile`
  branch over the global `liveBadges` list, which is not inventory-derived
  (`showcaseBadges` comes from `profile.showcase_slots`, also not inventory).
- **Owner still sees everything:** `isOwn` is the first disjunct, so
  `inventory_public: false` and `showInventory: false` both leave the owner's tiles,
  heading and grid rendered.
- **`inventory_public: true` + `showInventory: false`:** a visitor evaluates
  `false || (true && false)` = `false` → tiles, heading and section all hidden;
  the owner evaluates `true || …` = `true` → fully visible. Correct.
- Residual: the now-unreachable `inventoryHidden` branch — `v25-03`.

### 4. `s_top_percent`'s coin floor (item 5) — verified

The predicate was executed directly against the real exported check
(`npx tsx -e`, synthetic `AchStats`, no DB write):

```
coins=0, isTopCoinHolder=true,  userCount=25 -> false
coins=5, isTopCoinHolder=true,  userCount=25 -> true
coins=5, isTopCoinHolder=false, userCount=25 -> false
coins=5, isTopCoinHolder=true,  userCount=19 -> false
```

`isTopCoinHolder` is `topCoinsRes`'s user-id set membership
(`achievements.ts:452-459`, `:603-608`), so the live query — one `user_progress`
row, the single member at `coins 1840`, `userCount = 1` — yields
`isTopCoinHolder = true` but the `userCount >= 20` term keeps it locked; it is
absent from the live `user_achievements` set (13 rows, no `s_top_percent`). A
0-coin member cannot unlock it, and a genuine top-3 holder with a non-zero balance
can once the site passes 20 members.

### 5. Migration `0020` conventions and re-run (item 1) — clean

Matches `0011-0019`: leading narrative comment (no `-- vNN-NN:` tag, same as
`0018`), the `revoke … from public; revoke … from anon, authenticated; grant … to
service_role` trio for the RPCs, a
`insert into public.changelog (kind, title, body, payload)` row (`id 314`, live,
`2026-09-22T18:29:15.758Z`), and a trailing `notify pgrst, 'reload schema';` with
**no** trailing newline (byte-checked: ends `…schema';`). Re-run against live (both
orphans present) completes with no SQL error; the only non-idempotent statement is
the changelog insert, which is true of `0011-0019` too and unreachable via
`db:apply` (one-shot ledger).

### 6. Live ACL surface after `0020` — 15 of 16 functions now non-reachable

| function | anon EXECUTE | authenticated EXECUTE |
|---|---|---|
| all 10 economy RPCs / `rls_auto_enable` | no | no |
| `latest_badge_stats(int)` | no (`42501` live) | no (`42501`) |
| `get_own_profile_email()` | no (`42501`) | no (`42501`) |
| `handle_new_user()` | no (`42501`) | no |
| `touch_updated_at()` | no | no (`42501`) |
| `touch_badges_updated_at()` | no (`42501`) | no |
| `protect_profile_columns()` | **yes** (`0A000`) | **yes** (`0A000`) → `v25-02` |

---

## Item 6 — both economy scripts, exact numbers

**`npx tsx scripts/verify-atomic-economy.ts`** → **17/17 PASSED**, `ALL CHECKS
PASSED` (16 original + the new evaluation check):

```
restore: EXACT (xp 3610/3610, coins 1840/1840, level 11/11)
feedRowsRemoved=6 achievementRowsRemoved=4
PASS achievement evaluation returns a list: got 1, expected 1
achievements evaluated: 123 | unlocked for this profile: 4
```

The envelope covers `evaluateAchievements` — row counts compared immediately
before and after:

| table | before | after |
|---|---|---|
| `profiles` | 1 | 1 |
| `user_progress` | 1 | 1 |
| `user_achievements` | 13 | 13 |
| `activity_events` (max id) | 20 | 20 |
| `changelog` | 314 | 314 |
| `badges` | 476 | 476 |

The 13 stored achievement ids are byte-identical before and after
(`c_first_login…c_ach_10`), so the **4** rows the evaluation created were removed
and the **6** feed rows it wrote (inserts, meta-unlock logging, level-up) were
removed by `id > eventHigh`; the `achievements_points` bump is covered by the full
progress-row restore (`30` before and after). The only column that moved is
`user_progress.updated_at` (`18:30:40.024Z` → `18:49:37.732Z`), which the script
re-stamps by design (already recorded in `verify-round24.md`); `xp 3610 / coins
1840 / level 11 / login_streak 1 / last_login_date 2026-09-22 / game_xp_today 0 /
game_xp_day null` are unchanged. Restore is exact.

**`npx tsx scripts/verify-game-economy.ts`** → **13/13 ok**, worst game **hilo
0.9844** (below the commit's report of 0.9851 — Monte-Carlo variance, same
verdict). No DB writes (the script stubs `supabase`).

| game | avg payout/bet | | game | avg payout/bet |
|---|---|---|---|---|
| rps | 0.9665 | | roulette | 0.3685 |
| slots | 0.1332 | | blackjack | 0.5808 |
| shoot | 0.9020 | | vault | 0.8972 |
| memory | 0.8844 | | scratch | 0.9803 |
| quiz | 0.8004 | | tower | 0.9024 |
| coinflip | 0.9692 | | catcher | 0.8577 |
| hilo | **0.9844** | | | |

---

## Residuals already on record (not re-reported)

- `verify-round24.md` **v24-03**'s second half is still open: the `topCoinsRes`
  ordering has no tie-break (`order("coins", {ascending:false}).limit(3)`), so
  equal holders at rank 3 are chosen arbitrarily. The coin floor is what this
  commit added; the tie-break was not.
- **v24-04** (unindexed `Seq Scan` per evaluation) and **v24-05** (Supabase's
  `alter default privileges` re-granting anon/authenticated on every new
  `public` function) stand unchanged.

---

## Item 7 — is any **live** defect left in this commit's scope?

**No.** The two state changes this commit makes to production are both live-verified
correct: no function in `public` is reachable by `anon`/`authenticated` except
`protect_profile_columns` (trigger-only, `0A000`, not an exposure), and the three
revoked triggers still fire. Every UI/economy change is latent behind data the
live site does not have (`customization = {}`, `inventory_public = true`,
`userCount = 1`). The one hard defect, `v25-01`, is a **fresh-install** break
(`0020` cannot run on an empty schema) — production is already past `0020` in the
ledger, so it is not live. `v25-02` and `v25-03` are latent consistency/copy gaps;
`v25-04` is coverage quality.