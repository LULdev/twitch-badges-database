# Verification — Round 23

Scope: commit `710e139` ("fix(ui,economy): apply the profile settings, the
listbox a11y pattern and the XP-budget refund") — the XP budget
(`src/lib/gamification/xp.ts` + migrations 0017/0018), the language listbox
(`src/components/LanguageSwitcher.tsx`, cli-9) and the profile customizer
(`src/app/[locale]/profile/[username]/page.tsx`, fp-3).

Read-only. No project file was edited, created or deleted; `git status
--porcelain` is empty at the end of every probe. Live DB work was done in
transactions that were rolled back, plus one read-only ACL/policy query; the
single live `user_progress` row is byte-identical before and after every probe
(`xp 3610 / coins 1840 / game_xp_today 0 / game_xp_day null`).

**Note on HEAD:** the tree moved during this verification — HEAD is now
`2f43059` (an `achievements.ts` commit dated 19:50, after `710e139`'s 19:28).
That commit is outside the three changes under review; see `v23-07`. The two
economy scripts below were run against the current tree, so they include it.

**Verdict up front:** the XP-budget change is correct and live-verified end to
end (clamp, atomic xp+coins, granted amount propagated, rollback-clean, anon
blocked) — but its own migration 0018 silently **lost the grant hardening** of
0017 (`v23-01`, medium, the exact class of `agent-17 db-1`, live-confirmed). The
three fp-3 defects (`v23-02`, `v23-03`, `v23-04`) are latent — no member has any
customization data yet (the one live profile is `{}`) — but they are real code
paths. cli-9 is **clean**: every listed property holds and eslint reports
nothing for the file.

---

## Findings

### v23-01 — migration 0018 dropped `consume_and_apply_game_xp` and recreated it **without** re-applying 0017's revoke/grant — medium

- **Severity:** medium (security / grant hygiene — same class as `agent-17 db-1`,
  which 0008 fixed for the other seven economy RPCs)
- **Side:** server / DB
- **File:** `supabase/migrations/0018_fix_game_xp_output_names.sql:12-56`
  (the missing statements belong where 0017 had them:
  `supabase/migrations/0017_consume_and_apply_game_xp.sql:64-66`)
- **Evidence (live):** `pg_proc.proacl` read through the session pooler:

  | function | acl |
  |---|---|
  | `apply_xp_coins` | `{postgres=X/postgres,service_role=X/postgres}` |
  | `consume_game_xp` | `{postgres=X/postgres,service_role=X/postgres}` |
  | `consume_and_apply_game_xp` | `{=X/postgres, postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, service_role=X/postgres}` |

  `has_function_privilege('anon', …, 'EXECUTE')` = **true**, `authenticated` =
  **true**. `0018` contains no `revoke`/`grant` line at all (`grep -n
  "revoke\|grant" 0018…` → nothing), and the ledger shows it applied
  (`supabase_migrations`, `0018_fix_game_xp_output_names.sql`, 2026-09-22T17:27:29Z).
- **Why it is a bug:** `drop function` removes the function's ACL, and Supabase's
  install sets `alter default privileges in schema public grant all on functions
  to postgres, anon, authenticated, service_role`, so the recreated function gets
  an **explicit** EXECUTE grant to `anon`/`authenticated` (and the `=X/postgres`
  PUBLIC entry). 0017 had explicitly removed all three
  (`revoke … from public; revoke … from anon, authenticated; grant … to
  service_role`), and 0018 — whose whole purpose was to fix that function — threw
  the hardening away. The commit that added it therefore re-opened the reachability
  hole its own 0008 migration closed for every other economy RPC, so
  `POST /rest/v1/rpc/consume_and_apply_game_xp` is again callable by an anonymous
  client.
- **Exploitability — checked, and it is *not* currently exploitable.** The
  function is `security invoker`, and `anon`/`authenticated` hold **SELECT but no
  UPDATE** on `user_progress` (`has_table_privilege(…,'UPDATE')` = false; the only
  policy on the table is `progress_public_read`, SELECT, `qual = true`). A real
  anon call was executed inside a rolled-back transaction:
  `set local role anon; select * from consume_and_apply_game_xp(<uid>, current_date, 10, 1);`
  → **`42501 permission denied for table user_progress`**, and the row was
  unchanged afterwards. So this is a defense-in-depth regression, not mintable
  currency — but it is a **live** state deviation from the file's own stated
  contract ("Grant execute … to service_role").
- **Confidence:** high (live ACL + live anon call, both deterministic).
- **Fix direction:** add migration `0019` (0018 is already applied, so editing it
  would not re-run) with
  `revoke execute on function public.consume_and_apply_game_xp(uuid, date, int, bigint) from public, anon, authenticated;`
  then `grant execute … to service_role;` and `notify pgrst, 'reload schema';`.
  Better still: move the revoke/grant into a shared tail so a future
  drop-and-recreate cannot lose it again.

### v23-02 — `showInventory` hides the inventory from the profile owner as well — low

- **Severity:** low (self-inflicted UX regression + a false public statistic;
  latent — no member has settings yet)
- **Side:** UI (server component)
- **File:** `src/app/[locale]/profile/[username]/page.tsx:212`
  (`inventoryVisible = (profile.inventory_public || isOwn) && showInventory;`),
  consumed at `:215` (the `getInventory` call) and `:563` (`inventoryHidden`)
- **Evidence:** the pre-change expression was `profile.inventory_public || isOwn`
  — the `isOwn` disjunct exists precisely so the owner always sees their own
  inventory regardless of the privacy column (comment at `:86-89` relies on the
  same "owner sees more" rule for the visitor list). The new `&& showInventory`
  is applied *after* that disjunct, so `showInventory: false` wins for the owner
  too: the owner's own profile renders the `inventoryHidden` card instead of
  their badges. Second-order effect: `inventoryVisible === false` skips
  `getInventory`, so `ownedBadges` stays `[]` and — with `showStats` left at its
  default `true` — the public stat tiles publish **`owned 0`, `missing
  totalCatalog`, `completion 0%`** for a collector whose badges are merely
  hidden. (That zero-stat shape already existed for `inventory_public: false`, so
  only the newly reachable trigger is new.)
- **Why it is a bug:** the task's own requirement is that `showInventory` must
  not hide the owner's own view, and the customizer has **no preview** (it is a
  bare form — no `preview`/`Preview` identifier anywhere in
  `src/components/account/ProfileCustomizer.tsx`), so a member flipping "Show
  inventory" off has no way to learn that they have also hidden their own badges
  and published a 0-badge, 0% profile. Reachability today is zero (the single live
  profile is `customization = {}` → default `true`), which is why this is low.
- **Confidence:** high (code path read directly; the live data state was queried).
- **Fix direction:** make the owner an unconditional bypass, e.g.
  `inventoryVisible = isOwn || (profile.inventory_public && showInventory);`
  and either suppress the stat tiles' owned/completion pair when the inventory is
  hidden or keep computing `ownedBadges` for the tiles while hiding only the grid.

### v23-03 — `showCoins` cannot be honoured independently: it is nested inside the `showLevel` gate — low

- **Severity:** low
- **Side:** UI (server component)
- **File:** `src/app/[locale]/profile/[username]/page.tsx:328-345` — the coin
  balance at `:335` (`{progress && showCoins ? …`) sits inside the block opened
  by `{level && showLevel && (` at `:328`
- **Evidence:** `showLevel: false, showCoins: true` renders neither the level
  badge, nor the XP bar, nor the coin balance: the only render site for
  `progress.coins` is inside the `showLevel` block (the XP bar and the coin line
  share one `<p>`), and no other element on the page shows the balance.
- **Why it is a bug:** the commit claims "the five visibility toggles now work"
  and treats level and coins as independent switches (the customizer labels them
  separately: `showLevel` = "Show level bar", `showCoins` = "Show coin
  balance"). One toggle silently overrides the other, so a member who wants the
  balance without the level bar gets neither.
- **Confidence:** high.
- **Fix direction:** move the coin span out of the `showLevel` block into its own
  `{progress && showCoins && …}` line, or gate the whole block on
  `showLevel || showCoins` and hide each half independently.

### v23-04 — the page's `bannerOverlay` fallback (0) and the customizer's default (30) disagree, and the customizer writes every key on Save — low

- **Severity:** low (visual regression on a member's public banner, applied
  without their choice)
- **Side:** UI
- **File:** `src/app/[locale]/profile/[username]/page.tsx:204`
  (`number("bannerOverlay", 0)`) vs
  `src/components/account/ProfileCustomizer.tsx:57`
  (`bannerOverlay: 30` in `DEFAULTS`) and `:129`/`:142`
  (`useState({ ...DEFAULTS, ...initial })`, `customization: values`)
- **Evidence:** the customizer's state is `DEFAULTS` merged with the stored
  document and `save()` POSTs the whole object as `customization`, so **every**
  save persists `bannerOverlay: 30` unless the member deliberately moves the
  slider to 0. Before this commit the key did nothing; now the profile page
  renders a `bg-background` overlay at `opacity: 0.30` over the banner
  (`page.tsx:287-293`). Verified against live data: the one profile's
  `customization` is `{}`, so nothing is affected *today* — but the first save by
  any member (even one that only edits `displayName`) silently darkens their
  banner by 30%.
- **Why it is a bug:** the commit's stated rule is that an absent/default setting
  behaves as before, and the page's own fallback encodes that (0 = no overlay).
  The customizer's `30` is therefore a *different* default for the same setting,
  and because it is persisted it is not a fallback at all — it is a choice made
  on the member's behalf, with no preview to reveal it. (Whether the intent is
  "30% darkening by default" or "no overlay by default" is a design decision; the
  two files must agree either way.)
- **Confidence:** high.
- **Fix direction:** set `DEFAULTS.bannerOverlay` to `0` (matching the
  "behaves as before" rule), or — if 30 is intentional — state it in the commit
  and keep the page fallback at 0 so a member who never saved is unaffected.

### v23-05 — the verification ritual still exercises `consume_game_xp`, which the app no longer calls — info

- **Severity:** info (coverage gap, no behaviour change)
- **Side:** scripts / process
- **File:** `scripts/verify-atomic-economy.ts:181-188` (two `rpc("consume_game_xp", …)`
  calls) vs `src/lib/gamification/xp.ts:207` (`consume_and_apply_game_xp`)
- **Evidence:** `grep -rn consume_game_xp src/` returns nothing; the only
  remaining caller is the test at `:182/:187`. The test's "game XP budget capped
  at 100" check therefore proves the *old* function's clamp, not the one the game
  path uses. The new function's clamp/atomicity is verified only by the ad-hoc
  rolled-back transaction recorded in the round-23 audit and re-run here — not by
  any checked-in script, so `npm run`-able coverage of the live path is zero.
- **Why it is a bug:** the ritual is the project's evidence trail; it now passes
  16/16 while the function that actually spends the daily budget is untested by
  it. A future change to `consume_and_apply_game_xp` (or a dropped grant, as in
  `v23-01`) would not be caught.
- **Confidence:** high.
- **Fix direction:** point the check at `consume_and_apply_game_xp` (it returns a
  row, so read `granted` instead of the scalar) and assert xp **and** coins moved
  together, or keep both checks.

### v23-06 — stale invariant: "the level badge is ALWAYS visible" — info

- **Severity:** info (documentation drift)
- **Side:** code comments
- **File:** `src/app/[locale]/profile/[username]/page.tsx:244`
  (`// Gamification: level (badge ALWAYS visible), coins, achievements, visitors.`),
  and the comment at
  `src/app/[locale]/profile/[username]/page.tsx:264-266` ("the level badge is
  documented as ALWAYS visible, so fall back to the level-1 display instead of
  hiding it")
- **Evidence:** `showLevel` now gates both `LevelBadge` (`page.tsx:308`) and the
  XP bar (`:328`), so with `showLevel: false` the level badge is not visible. The
  round-23 audit's own summary repeats the stale claim ("the profile still renders
  the level badge … under the defaults" — true only because the *default* is
  `true`).
- **Why it is a bug:** it is not one — the fp-3 intent is that a member may hide
  their level. Recorded so the invariant is not re-asserted by the next audit as
  a contradiction.
- **Confidence:** high.
- **Fix direction:** reword to "level badge visible unless the member's
  `showLevel` is false; when no progress row exists, show level 1 rather than
  nothing".

### v23-07 — HEAD moved to `2f43059` during verification (out of scope) — info

- **Severity:** info (process)
- **Side:** repository
- **Evidence:** at the start of this round `73c54b5` was HEAD; HEAD is now
  `2f43059` ("fix(achievements): two specials now check what their descriptions
  say", 19:50, one file, `src/lib/gamification/achievements.ts`, +31/-4). It adds
  `AchStats.accountAgeDays` / `isTopCoinHolder` and a new `topCoinsRes` query
  inside `buildStats`.
- **Why it is a bug:** it is not one, and it is outside the three changes under
  review — but it lands in the `award()` → `evaluateAchievements()` path, so the
  script runs reported below were executed against a tree that includes it, and
  `710e139` alone can no longer be reproduced by checking out HEAD.
- **Confidence:** high.
- **Fix direction:** none for this round; if the achievements change is to be
  covered, it needs its own verification pass (its `buildStats` additions are
  read-only selects, and both callers of `evaluateAchievements` already `.catch()`
  the failure, so the blast radius is contained).

### v23-08 — the `Tab` dismissal relies on the browser's sequential-focus starting point and was not executed — info

- **Severity:** info (unverified sub-claim, not a demonstrated defect)
- **Side:** UI (client component)
- **File:** `src/components/LanguageSwitcher.tsx:161-164` (`else if (event.key ===
  "Tab") { setOpen(false); }`) with the panel's `tabIndex={-1}` at `:191`
- **Evidence (reasoned, not executed):** the `Tab` branch does not
  `preventDefault`, so the panel — the focused element — is unmounted by React's
  synchronous discrete-update flush *before* the browser's default action runs.
  In engines that implement the HTML "sequential focus navigation starting point"
  (Chromium, Gecko, WebKit), removing the focused node sets that starting point to
  the removed node's position, so `Tab` lands on the next focusable element after
  `.lang-switcher` (in the footer) — i.e. **not stranded**. An engine without that
  behaviour would fall back to `document.activeElement === body` and jump to the
  first focusable element of the document.
- **Why it is a bug:** it is not demonstrably one; it is the one item on the
  cli-9 checklist I could not execute (no browser session was started for this
  round — this is the honest limit of the verification, not a finding).
  `triggerRef.current?.focus()` before letting the default action proceed would
  make the outcome deterministic in every engine, at the cost of one extra
  `focus()` call.
- **Confidence:** medium (spec/engine reasoning only).
- **Fix direction:** if determinism is wanted, mirror the Escape branch:
  `setOpen(false); triggerRef.current?.focus();` — the subsequent `Tab` then moves
  from the trigger, which is unambiguous.

---

## Areas found clean

### 1. XP budget (`xp.ts` + 0017/0018) — all five required properties hold

| Check | Result | Evidence |
|---|---|---|
| (a) `consume_game_xp` no longer called in `src/` | **clean** | `grep -rn consume_game_xp src/` → no hit; the only caller left is `scripts/verify-atomic-economy.ts:182/187` (v23-05) |
| (b) game path uses `consume_and_apply_game_xp`, reads `out_xp`/`out_coins`/`granted` | **clean** | `xp.ts:207-223`; live `pg_get_function_result` = `TABLE(out_xp bigint, out_coins bigint, granted integer)` — exact name match (this is what 0018 fixed; the names are correct in the live DB) |
| (c) `xpAwarded` reassigned from `granted` | **clean** | `xp.ts:216` `xpAwarded = granted`; the feed reads it (`:316` `xpAmount: xpAwarded \|\| null`), the achievement pass reads DB state (`:334`, and `games.ts:194` re-evaluates from DB), and the returned `AwardResult.xpAwarded` is the same variable (`:340`). A clamped award therefore reports 20, not 50 |
| (d) non-game path unchanged (`apply_xp_coins`) | **clean** | `xp.ts:224-241` is byte-identical to the pre-commit block; live `apply_xp_coins` = `TABLE(xp bigint, coins bigint)`, and the code reads exactly `xp`/`coins` |
| (e) clamp and lock semantics match `consume_game_xp` | **clean** | both do `select case when game_xp_day = p_today then game_xp_today else 0 end … for update`, then `allowed := greatest(0, least(p_requested, 100 - spent))`, then write `game_xp_day = p_today, game_xp_today = spent + allowed`; the new one additionally moves `xp` and `coins` in the *same* UPDATE and returns them. No row → the new function returns **no rows** where the old returned `0`; `xp.ts:214-219` handles that (`row` undefined → `granted 0`, `out_xp` undefined → `current.xp + 0`), and it is unreachable anyway because `getProgress()` (`xp.ts:99-139`) guarantees the row |

**Independent live test, in a transaction that was rolled back** (row
`43e5ee6d-…`, base `xp 3610 / coins 1840 / game_xp_today 0 / game_xp_day null`):

| call | `granted` | `out_xp` | `out_coins` |
|---|---|---|---|
| `(uid, current_date, 80, 5)` | **80** | 3690 (+80) | 1845 (+5) |
| `(uid, current_date, 50, 3)` | **20** (clamp: 100−80) | 3710 (+20) | 1848 (+3) |
| `(uid, current_date, 10, 1)` | **0** (budget spent) | 3710 (+0) | 1849 (+1) |
| `(uid, current_date, 0, 2)` | **0** (early branch) | 3710 (+0) | 1851 (+2) |
| `('00000000-…-ff', current_date, 10, 1)` | — | **0 rows** (no progress row) | — |

`game_xp_today` lands on exactly **100**, never above; `game_xp_day` = today.
Post-rollback read: `xp 3610 / coins 1840 / game_xp_today 0 / game_xp_day null` —
identical to base. `set local role anon` → **`42501 permission denied for table
user_progress`** (no write; the row was unchanged after that rollback too). The
`p_requested <= 0` branch moves coins only and leaves `xp` alone, which is correct
for a coins-only award (the caller only reaches this branch with
`countsAsGameXp && xpAwarded > 0`, so it is not on the app path at all).

### 2. cli-9 (`LanguageSwitcher.tsx`) — clean

- **Attribute placement:** `aria-activedescendant` is on the `div` that carries
  `role="listbox"` (`:190-193`), not on the trigger. The trigger keeps
  `aria-haspopup="listbox"` / `aria-expanded` / `aria-controls="lang-listbox"`
  (`:175-179`), which is the correct split.
- **Referenced ids exist:** the value is `lang-opt-${routing.locales[highlighted]}`
  and every option renders `id={`lang-opt-${code}`}` (`:209`) for each locale in
  `routing.locales`. `highlighted` cannot go out of range: init
  `Math.max(0, routing.locales.indexOf(locale))` (`:89-91`, so `-1 → 0`), arrows
  use `(current + delta + last + 1) % (last + 1)` (`:154`), `Home`/`End` set
  `0`/`last` (`:157`).
- **No focus steal on mount:** the new effect (`:100-103`) returns immediately
  while `open` is false, and `panelRef` is only attached when the panel renders
  (`:188`), so it cannot run before the node exists.
- **No fight with the Escape handler:** the panel's `onKeyDown` has no `Escape`
  branch and never calls `preventDefault` for it, so the document listener
  (`:110-115`) closes and refocuses the trigger. The trigger's handler
  (`:138-146`) likewise ignores Escape. No path double-handles it.
- **Click still selects and closes:** `onClick={() => select(code)}` (`:217`) →
  `select()` (`:124-135`) closes, refocuses the trigger, and preserves
  `window.location.search` in the `router.replace`. The document `pointerdown`
  guard (`:108`) only fires for targets outside `rootRef`, and options are inside
  it, so the panel is not closed before the click lands.
- **Keyboard open still works:** `Enter`/`Space` on the trigger `preventDefault`
  and `setOpen(true)` (`:142-145`). The `preventDefault` is what prevents the
  button's synthesized click (and therefore the `onClick` toggle) from closing it
  again — so there is no open/close race. `ArrowUp`/`ArrowDown` open too.
- **Arrow keys do not scroll:** `ArrowDown`/`ArrowUp` (`:151-154`) and
  `Home`/`End` (`:155-157`) all `preventDefault` before moving the highlight.
- **`Tab`:** see `v23-08` — closes without `preventDefault`, relying on the
  browser's focus-navigation starting point; reasoned, not executed.
- **eslint:** `npx eslint src/components/LanguageSwitcher.tsx …` → **exit 0, no
  output**; project-wide `npx eslint` → **0 errors, 7 warnings** (all
  pre-existing `@typescript-eslint/no-unused-vars` in unrelated files). No a11y
  violation for the file. (`eslint-config-next/core-web-vitals` brings the
  jsx-a11y rules in, so the check is real.)

### 3. fp-3 (`profile/[username]/page.tsx`) — the six required properties

- **Defaults are the visible state:** `flag` → `true`, `number` → `0`, `text` →
  `""` (`:177-189`), so `{}`, `null` and any absent key produce exactly the
  pre-commit markup. **Live-confirmed:** the only profile in the database is
  `band1to` with `customization = {}`, so no production profile changes today.
- **`nameGradient` cannot be bypassed into arbitrary CSS:** the regex
  (`:199-203`) is anchored `^…$` and admits only `#`, `[0-9a-fA-F]`, `,` and `\s`
  inside a comma-separated list, so `url(…)`, `;`, `"`, `)` and `/` are all
  rejected. Independently, React assigns the value through CSSOM
  (`style.backgroundImage = …`, not the `style` attribute string), so even a
  hypothetical bypass could not start a new declaration. Clean.
- **`bannerOverlay` is clamped:** `Math.min(90, Math.max(0, number("bannerOverlay", 0)))`
  (`:204`) with `Number.isFinite` inside `number()` (`:185-189`), so negatives,
  `NaN`, `Infinity`, `1e9` and non-numbers all resolve into `[0, 90]`; the overlay
  is a single `opacity` on one `bg-background` span (`:287-293`). Clean (the
  *default* mismatch is `v23-04`, not a clamp failure).
- **`customization` null / array / string cannot throw:** `(profile?.customization
  ?? {}) as Record<string, unknown>` (`:176`) covers null/undefined, and
  `customization[key]` on an array, a string or a number yields `undefined` (no
  throw, no prototype access), which each helper turns into its fallback. The DB
  backstop from 0012 (`jsonb_typeof(customization) = 'object'`) means a non-object
  cannot even be stored. Clean.
- **Nothing regressed for a member with no settings:** with `bannerOverlay = 0`
  the banner `<div>` renders the same single element as before (the ternary
  yields `null`, so there is no extra child); the h1 gets `style={undefined}`;
  all five sections render as before. Clean.

---

## Item 4 — both economy scripts, exact numbers

**`npx tsx scripts/verify-atomic-economy.ts`** → **16/16 PASSED**, `ALL CHECKS
PASSED`, `restore: EXACT (xp 3610/3610, coins 1840/1840, level 11/11)
feedRowsRemoved=0 achievementRowsRemoved=0`:

```
PASS single award xp: got 3, expected 3
PASS single award coins: got 2, expected 2
PASS concurrent xp survives (3+11+13): got 27, expected 27
PASS concurrent coins survive (2+5+7): got 14, expected 14
PASS bumpCoins +7: got 7, expected 7
PASS bumpCoins round-trip returns to start: got 1854, expected 1854
PASS negative guard: got 0, expected 0
PASS 5 concurrent games_played bumps: got 5, expected 5
PASS 5 concurrent times_robbed bumps: got 5, expected 5
PASS daily gate: exactly one winner: got 1, expected 1     (gate results: 1 / -1)
PASS daily gate: winner got streak 1: got 1, expected 1
PASS daily gate: last_login_date stamped: got 1, expected 1
PASS daily gate: nobody wins twice: got 0, expected 0
PASS wheel gate: exactly one winner: got 1, expected 1
PASS game XP budget capped at 100: got 100, expected 100  (granted: 20 + 80)
```

**`npx tsx scripts/verify-game-economy.ts`** → **13/13 below the stake**, worst
game **hilo 0.9844** (the commit reported 0.9850 — simulation variance):

| game | rounds | avg payout/bet | win rate |
|---|---|---|---|
| rps | 200 000 | 0.9650 | 33.4% |
| slots | 40 000 | 0.1249 | 3.4% |
| shoot | 200 000 | 0.8986 | 44.9% |
| memory | 200 000 | 0.8853 | 44.3% |
| quiz | 200 000 | 0.7988 | 39.9% |
| coinflip | 200 000 | 0.9679 | 49.9% |
| hilo | 200 000 | **0.9844** | 49.9% |
| roulette | 200 000 | 0.3845 | 2.7% |
| blackjack | 200 000 | 0.5806 | 26.8% |
| vault | 200 000 | 0.9031 | 45.2% |
| scratch | 200 000 | 0.9823 | 24.6% |
| tower | 200 000 | 0.9030 | 74.0% |
| catcher | 200 000 | 0.8625 | 43.1% |

Other gates re-run for this round: `npx tsc --noEmit` → **exit 0**; `npx eslint`
→ **0 errors / 7 pre-existing warnings**; `git status --porcelain` → **empty**.

---

## Item 5 — does any **live** defect remain in these commits' scope?

**Yes — one, and it is not exploitable.** `v23-01` is a *live* state deviation:
the live database right now grants `EXECUTE` on `consume_and_apply_game_xp` to
`PUBLIC`, `anon` and `authenticated`, because 0018 dropped and recreated the
function without re-applying 0017's revoke/grant. A real anonymous call was
executed and returns `42501 permission denied for table user_progress` (anon holds
SELECT but no UPDATE on that table, and the table's only policy is a SELECT
one), so nothing can be minted or changed through it today; the defect is the
lost defense-in-depth layer, and it is the exact class 0008 fixed for the other
seven economy RPCs. Fix with a new migration (0018 is already applied).

The three fp-3 defects are **latent, not live**: `v23-02` and `v23-03` need a
member to set `showInventory`/`showLevel` in the customizer, and the only profile
in the database has `customization = {}`; `v23-04` needs any member to press Save
in the customizer at all, which has never happened. All three are one-line code
paths, so they become live the first time a member saves.

**The XP-budget change itself has no live defect**: the clamp, the row lock, the
joint xp+coin move, the `granted` propagation into the feed/`AwardResult` and the
anon rejection all reproduce exactly, in a rolled-back transaction, against the
live function. cli-9 has no live defect: every listed property holds, and the one
sub-claim I could not execute (`Tab`, `v23-08`) is a robustness note, not a
demonstrated fault.
