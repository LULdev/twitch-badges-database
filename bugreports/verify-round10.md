# Round-10 verification — defects in / around `49453c4`

Date: 2026-09-22. Adversarial read-only pass over the 33 fixes shipped in
`49453c4` ("low-findings round — 33 fixes from four scoped agents plus my own").
Working tree = `29d02dd` (docs-only commit on top; `git status` clean).

Nothing here repeats an item from the **Residual (documented, not fixed)** list
in `bugreports/AGENT-AUDIT.md:434-443` (coin-rain CAS RPC, `gam-7` daily-budget
refund, the 19 pre-fix `blog_views` rows, `fp-3`).

Gates re-run by me: `npm run typecheck` → exit 0, 0 diagnostics.
`npx tsx scripts/verify-atomic-economy.ts` → **16/16 PASSED**.
`npx tsx scripts/verify-game-economy.ts` → **13/13 below the stake** (worst hilo
0.9854), matching the commit's claim.

Convention per finding: ID · severity · side · file:line · evidence · why it is a
bug · confidence · fix direction. IDs are prefixed `v10-`.

---

## v10-1 — the coin-rain "once per profile per day" gate is inert for every logged-out visitor: unlimited +1 coin per HTTP request

- **Severity**: high (unbounded, unauthenticated coin creation)
- **Side**: server / economy
- **File:line**:
  - `src/lib/gamification/daily.ts:268` — the dedup read
  - `src/lib/gamification/daily.ts:280` — the row the read is supposed to find
  - `src/app/api/coinrain/route.ts:12` — the caller that always passes a key
- **Evidence**: the dedup compares the **visitor's salted IP hash** against a
  payload field that is never written with it:
  ```ts
  // read (line 261-269)
  .eq("kind","coin_rain").eq("user_id", profileOwnerId).gte("created_at", since)
  .contains("payload", { giver: giverId ?? anonymousKey ?? "anonymous" });
  if ((count ?? 0) > 0) return { ok: false, already: true };
  ...
  // write (line 275-281)
  await logActivity({ userId: profileOwnerId, kind: "coin_rain",
    payload: { role: "receiver", giver: giverId ?? "anonymous" } });   // never anonymousKey
  ```
  `ipHashFromRequest(request)` (`src/lib/gamification/session.ts:48-50`) always
  returns a 40-char sha256 slice, so for a logged-out giver `anonymousKey` is
  always defined and the query always searches for that hash — while the stored
  row says `"anonymous"`. The query can therefore **never** match for anonymous
  givers. (`logActivity` stores `payload` verbatim — `xp.ts:65-75`.)
  Live probe with the anon key: `activity_events?kind=eq.coin_rain` → **0 rows**,
  i.e. the gate has never blocked anything in production either.
- **Why it is a bug**: the `sec-2` / `fp-coinrain` fix ("the coin-rain gate used
  one shared `anonymous` key … now keyed by the visitor's salted IP hash",
  `AGENT-AUDIT.md:31`) does not work: for logged-out callers there is no gate at
  all. Each sequential `POST /api/coinrain {"profileId": "<any>"}` credits the
  target `+1` coin (`daily.ts:273`) plus a public feed row, with no auth, no
  rate limit and no dedup — an unbounded faucet any anonymous client can point
  at any profile. The signed-in path works (the uuid round-trips), which is why
  the bug survived review. This is a distinct defect from `ind-2` (which
  describes the read-then-write race and self-rain, both of which are correctly
  addressed here) — no concurrency is needed to hit this one.
  Provenance: the mismatch **predates** `49453c4` (the parent's `payload` line is
  byte-identical); this commit touched the function, added a comment asserting
  the read is a gate, and added the self-rain refusal *on top of* a gate that
  never fires. Reported here because it is a shipped fix that does not fix.
- **Confidence**: high (code path + live 0-row check; the only uncertainty is
  whether any anonymous giver ever used it).
- **Fix direction**: write the same key the read looks for — `giver: anonymousKey
  ?? giverId ?? "anonymous"` — or store two fields (`giverId` and
  `anonymousKey`) and match on the one that is set. A follow-up CAS/unique index
  is still needed for the concurrency half (already residual); without this one-line
  correction the residual's "the self-rain exploit itself is closed" is only
  true for signed-in users.

---

## v10-2 — `attemptSteal`: a counter error is thrown *after* the thief's coins have moved, producing a half-applied (non-zero-sum) transfer

- **Severity**: low (rare path, real corruption when it fires)
- **Side**: server / economy
- **File:line**: `src/lib/gamification/daily.ts:180-188` (thief) and `:195-200`
  (victim)
- **Evidence**:
  ```ts
  const balance = await bumpCoins(thiefId, -settings.price + stolen);   // coin move
  const { error: thiefCounterError } = await supabase.rpc("bump_counters", {...});
  if (thiefCounterError) throw thiefCounterError;                       // <- throws here
  ...
  await bumpCoins(victimProfile.id, -stolen + settings.price);           // never reached
  ```
  The commit deliberately turned the previously-ignored counter errors into
  throws ("counter errors surfaced"), but placed the throw between the two coin
  moves. If `bump_counters` fails once, the thief's balance has changed and the
  victim's has not: `-price + stolen` is debited from the economy while the
  matching credit is skipped — the transfer is no longer zero-sum, and the
  `steal_attempts` row (inserted at `:139-150` and *not* deleted on this path)
  also trips the 5-minute pair flood check, so the caller cannot retry and the
  API answers 500 for a heist whose coins already moved. The counterpart
  `victimCounterError` throw (`:196-200`) fires after both moves, so it is
  zero-sum but still reports failure for a completed heist.
- **Why it is a bug**: the point of the fix was to stop the round "reporting
  success while the counter stayed behind"; instead a counter failure now
  reports failure while the *coins* stayed inconsistent. The safe ordering is to
  move nothing until every fallible statement has succeeded, or to log the
  counter error instead of throwing it.
- **Confidence**: medium-high on the mechanism (plain control flow); likelihood
  depends on `bump_counters` failing (only a transport/DB error — a missing
  `user_progress` row would be a silent 0-row UPDATE, not an error).
- **Fix direction**: either move both `bumpCoins` calls after the counter RPCs,
  or keep `console.warn` for the counters (they are display counters) so a
  counter failure cannot strand a coin transfer; and delete the attempt row on
  the throw path if the throw is kept.

---

## v10-3 — `playGame` race guard: every racer voids, and the compensating DELETE's error is discarded

- **Severity**: low
- **Side**: server / data-quality
- **File:line**: `src/lib/gamification/games.ts:140-157` (guard + delete),
  `:164-173` (counter throw)
- **Evidence**:
  ```ts
  const { data: newest } = await supabase.from("game_rounds")
    .select("created_at").eq("user_id", userId)
    .order("created_at", { ascending: false }).limit(2);
  if (newest && newest.length === 2 && (newest[0]-newest[1]) < 900) {
    if (round?.id != null) await supabase.from("game_rounds").delete().eq("id", round.id); // error ignored
    return fail("Slow down — one round per second.");
  }
  ```
  1. **Two racers both void.** In a 2-way burst A=(t0) and B=(t0+δ) both re-read
     the same top-2 `[B, A]` (δ≈0) and both delete their own row: the result is
     zero accepted rounds, not "every racer but the first" as the comment at
     `:136` claims. Nothing is charged (verified: `getProgress`, `resolveGame`,
     `currentStreakFlags` and the insert are all read-only before the guard), so
     this is a UX/limit-shape issue rather than an economy one — but a client
     that retries (or a double click) gets "Slow down" for the round it was
     entitled to make, and the pre-check at `:90-102` would already have caught
     most of these cases.
  2. **The delete is unchecked.** `game_rounds` is public-read and feeds the
     live activity feed, the per-game streaks (`:217-229`), `s_hattrick` and the
     new lifetime `maxBet` (`achievements.ts:463-470`). A failed DELETE (network
     error, instance recycle mid-request) leaves a row whose `won`/`payout`/`bet`
     are fully visible while no coins, counters or XP ever moved — the one
     dangling state the void path was designed to prevent.
  3. `if (counterError) throw counterError` (`:173`) fires with the round row
     already inserted and no settlement done — same class of half-applied record
     as v10-2, one layer down.
- **Why it is a bug**: the fix's stated invariant ("the losers undo their
  attempt before a single coin has moved") is upheld, but the undo is
  best-effort and its failure mode is exactly the inconsistent record the guard
  exists to avoid; and the documented winner-selection behaviour does not match
  the code.
- **Confidence**: high on (1) and (2) (pure control flow / ignored error),
  medium on how often a burst reaches the guard rather than the pre-check.
- **Fix direction**: check the delete result and, on failure, reap the phantom
  row on the next round (`DELETE ... WHERE user_id = ? AND id NOT IN (settled)`);
  or mark the round voided in-place (`voided boolean`) so a failed cleanup can
  never be counted; select *one* survivor deliberately (keep the row with the
  smaller id, delete the rest) instead of letting all racers void.

---

## v10-4 — the potat 50-page cap now aborts the whole sync, and the "caller catches it" half of the fix does not exist for the distribution feed

- **Severity**: low (loud-failure regression, availability of the 15-min cron)
- **Side**: server / operations
- **File:line**: `src/lib/syncs/potat.ts:45-50`, `src/lib/twitch/potat.ts:89-93`
- **Evidence**:
  ```ts
  const [distribution, ownersResult] = await Promise.all([
    fetchAllDistribution(),                       // no .catch()
    fetchAllOwners()
      .then((rows) => ({ ok: true as const, rows }))
      .catch(() => ({ ok: false as const, rows: [] })),
  ]);
  ```
  The new throw at `twitch/potat.ts:93` was added to both paginators, but only
  `fetchAllOwners` is wrapped. A still-pending cursor on the distribution loop
  propagates out of `runPotatSync` → `/api/cron/potat` returns **500** with an
  error heartbeat (`src/app/api/cron/potat/route.ts:19-33`) and *all* of the
  run's remaining work is skipped — owner counts, `badge_stats` points, the
  status sweep and the rarity recompute. Before the change the same condition
  produced a truncated-but-completing sync.
  The commit message states "the 50-page paginator throws instead of silently
  truncating; the caller catches it, keeps existing counts and reports
  `ownersFeedOk=false`", and `AGENT-AUDIT.md:414` repeats that the throw "is
  caught by the caller" — that is only true for the owners feed. The
  `fix-a-syncs.md:27-46` rationale is honest about the difference ("*now* fails
  the run loudly"), so this is a message/mitigation mismatch rather than a
  hidden defect.
- **Why it is a bug**: if the distribution feed ever exceeds 200×50 = 10 000
  rows, the potat sync stops updating anything at all — every badge's rarity
  index and status countdown freezes while the change looks like a healthy
  deploy. A partial-but-explicit failure (`distributionFeedOk: false`, keep
  existing counts, still sweep statuses) is strictly better than a total outage.
  I could not measure the live page count: outbound access to `api.potat.app` is
  blocked from this sandbox (the probe hangs and is killed), so reachability is
  unproven either way.
- **Confidence**: high on the missing catch (code reading); low on whether the
  cap is reachable today.
- **Fix direction**: mirror the owners pattern — `.then/catch` around
  `fetchAllDistribution()` returning `{ ok: false, rows: [] }` and carry
  `distributionFeedOk` into the summary/heartbeat; or raise the cap and keep the
  truncation signal non-fatal.

---

## v10-5 — migration 0012 validates the new CHECKs against pre-existing rows: a legacy array / >16 KB blob makes the whole migration set unapplicable

- **Severity**: low (deploy-blocking only if bad data already exists)
- **Side**: database / operations
- **File:line**: `supabase/migrations/0012_customization_bounds.sql:13-23`
- **Evidence**:
  ```sql
  alter table public.profiles
    add constraint profiles_customization_object
    check (jsonb_typeof(customization) = 'object');
  ...
  alter table public.profiles
    add constraint profiles_customization_size
    check (octet_length(customization::text) <= 16384);
  ```
  `ADD CONSTRAINT ... CHECK` validates every existing row. The write path this
  constraint backstops previously accepted **arrays** (`Array.isArray` was not
  checked; `typeof [] === "object"` passed the old guard in
  `src/app/api/account/route.ts`) and had no size bound at all — so the precise
  rows the migration is aimed at (an array, or a blob that grew past 16 KB
  during the unbounded window) are the rows that make the constraint fail.
  `scripts/db-apply.ts:51-54` runs each file and its ledger row in one
  transaction, so 0012 rolls back cleanly — but every later migration then stops
  being applied until the row is hand-fixed, and the failure message names the
  constraint, not the offending profile.
  Live check (anon key): `profiles?select=id,customization` → **1 row**, value
  `{}`, max serialized length 2 → applies cleanly today. The `octet_length`
  headroom is correct (a 4096-UTF-16-code-unit doc is ≤ 12 288 bytes in UTF-8,
  the worst 4-byte-emoji case lands under 16 384), so there is **no** false
  rejection of documents the new write path would accept.
- **Why it is a bug**: the intended fix can fail on exactly the data it exists
  to constrain, and the failure blocks unrelated migrations.
- **Confidence**: high on the mechanism; the trigger depends on a legacy row
  that does not exist in this project today.
- **Fix direction**: normalise before validating —
  `update public.profiles set customization = '{}'::jsonb where jsonb_typeof(customization) <> 'object' or octet_length(customization::text) > 16384;`
  (or add the constraint `not valid` and then `validate constraint` after a
  repair step), and record the count of normalised rows in the changelog entry.

---

## v10-6 — `recordBlogView`'s failed-read branch silently drops views, and `recordProfileVisit` now under-reports after a successful insert

- **Severity**: low (observability / counter accuracy)
- **Side**: server / data-quality
- **File:line**: `src/lib/gamification/visits.ts:57-71` (blog), `:40-43` (profile)
- **Evidence**: the blog fix (`R8-2`) is correct on the primary point — `blog_views`
  really has no `id` (`0003_gamification.sql:111-115`, confirmed by the 42703 in
  `verify-round8.md:47-52`), so counting `post_id` makes the 5-minute dedup
  engage for the first time. But the new early return
  ```ts
  if (error) return false;   // failed dedup read
  ```
  means a *persistent* read error (un-migrated DB, revoked grant, PostgREST
  hiccup) silently drops **every** view — no row, no log, and the boolean is
  discarded by the only caller (`src/app/[locale]/blog/[slug]/page.tsx:59`), so
  the failure is invisible. The prompt's "neither silently counts nor silently
  drops every view" is therefore half true: it cannot inflate, but it can drop
  everything silently. Same shape in `recordProfileVisit`, where the new
  `return !bumpError` reports "not counted" *after* the `profile_visits` row was
  already inserted (`:24-27`) — a disagreement between the row and the return
  value that nothing observes (the caller `.catch(() => false)`s it).
  Neither is a regression in stored data (refusing to count > inflating), and
  the `bump_view_count` error surfacing is a genuine improvement.
- **Why it is a bug**: a wrong counter is now indistinguishable from a working
  one under a read failure; the fix's own rationale ("a failed dedup read must
  not be read as 'no recent view'") is honoured only in the conservative
  direction.
- **Confidence**: confirmed (control flow); impact low because the value is
  display-only.
- **Fix direction**: `console.warn` (or `logChange`-style telemetry) on the
  error branch, and in `recordProfileVisit` return `true` when the visit row was
  inserted regardless of the counter RPC (the counter is a separate concern).

---

## Areas checked and found clean

- **`src/proxy.ts` (highest risk, verified by reading; not exercised live).**
  (a) Both paths keep the refreshed cookies: `setAll` collects into `refreshed`
  during the awaited `getUser()` (`:26-48`) and the copy loop (`:61-63`) runs
  after `NextResponse.next({ request })` / `handleI18nRouting(request)` is
  built, so `/api` and page requests both get `Set-Cookie`. (b) A next-intl
  **redirect** (unprefixed path such as `/badges` with a stale `sb-` cookie, and
  incidentally the `/auth/callback` rewrite) still carries them — cookies set on
  a returned redirect response are honoured. (c) No double refresh: the response
  is constructed *after* `request.cookies.set` mutated the cookie header, so the
  forwarded headers (`x-middleware-request-cookie`) carry the new token into the
  same request's RSC render; `src/lib/supabase/server.ts:17`'s no-op `setAll`
  means any second rotation would have been dropped (the original `auth-1`
  logout), and a fresh token is outside the refresh margin, so `getUser()` in
  the layout does not rotate again. (d) Login cannot loop: `hasSessionCookie` is
  a pure read of the incoming cookies, no redirect is emitted by the refresh
  branch, and the refresh only runs when an `sb-` cookie is present (cron,
  health and anonymous reads still skip the round trip). Cookie deletion
  (`value: ""` + `maxAge: 0`) survives the Map round-trip verbatim.
- **`src/lib/gamification/games.ts` economy.** The guard sits strictly between the
  insert and the first mutation — verified statement by statement: `lastRound`
  read, `getProgress`, `resolveGame` (reads only), `currentStreakFlags` (read),
  INSERT, guard, `bump_counters`, `bumpCoins`. A voided round therefore moves no
  coins, no counters and no XP; `newest.length === 2` protects the very first
  round; `RATE_RACE_MS = 900` compares two DB-written timestamps, so it cannot
  void a 1 Hz player on app-clock skew. `verify-game-economy.ts` reproduces
  13/13 below the stake.
- **`daily.ts` steal zero-sum arithmetic.** Thief `-price + stolen`, victim
  `-stolen + price` → exactly 0; the deflationary leak the commit names (the
  `price` leaving the economy on every successful heist) is genuinely closed.
  `verify-atomic-economy.ts` 16/16.
- **`daily.ts` / `wheel.ts` `ensureProgress`.** `upsert(..., ignoreDuplicates)`
  creates the row before `claim_daily_gate` / `claim_wheel_gate` (both UPDATE-only),
  so a first-ever daily claim / spin is no longer told "already claimed"; the
  gates still admit exactly one winner per day (16/16 script).
- **`visits.ts` blog dedup (the primary fix).** `select("post_id", {head:true})`
  is a real column; the dedup now engages and the insert is only reached once per
  (post, ip) per 5 minutes.
- **`src/app/[locale]/error.tsx`.** Renders in all 11 locales: it sits inside
  `[locale]/layout.tsx`'s `NextIntlClientProvider` (which inherits the server
  messages), and all four keys it uses — `common.errorTitle`, `errorBody`,
  `errorRetry`, `backHome` — exist in all 11 message files (checked key by key).
  It cannot itself throw on the error object (`error.digest ?? ""`,
  `error.message` are safe for a non-Error too), and `reset`/`Link` are the
  standard client-boundary affordances. (Caveat, not a defect: there is still no
  root/`global-error.tsx`, so an error thrown by `[locale]/layout.tsx` itself
  escapes to the framework screen — the layout's Supabase call is already in a
  `try/catch`.)
- **`src/app/api/og/profile/route.tsx`.** The gate cannot be turned into an
  unbounded cache: the `Map` is capped at 32 entries with insertion-order
  eviction and every entry is a promise that always resolves (`null` on any
  failure), so worst case is a few MB and one failed request degrades to
  `fonts: undefined` + `fontFamily: "sans-serif"` (the graceful path). The
  subset text covers every string the card draws (name, `@username`, count,
  both labels), the regex only accepts `format('truetype'|'opentype')` (a
  woff2-class response yields `null` → graceful), and the input is not
  attacker-controlled text (it comes from the perfil lookup for a
  `^[a-z0-9_]{3,25}$` username).
- **Migration `0001` guard.** Cannot block a legitimate fresh install:
  `to_regclass('public.badges')` is NULL before the first apply, and the guard
  only raises when the table exists *and* holds a row; the ledger
  (`scripts/db-apply.ts:29-43`) already skips applied files, so the guard only
  fires on a genuine replay against live data — the intended behaviour. Duplicate
  or unrelated tables are untouched.
- **Migration `0003` drop+recreate.** Cannot leave a table without a policy:
  every `drop policy if exists … on public.X` is immediately followed by the
  matching `create policy` for the same table, the tables are created earlier in
  the same file with `if not exists`, `db-apply` wraps each file in one
  transaction (`db-apply.ts:51-54`), and no later migration drops any policy
  this file recreates (checked all `drop policy` statements, migrations
  0004-0013), so a replay cannot resurrect a policy that was later removed. The
  seed insert is properly guarded by `where not exists`, and the changelog row is
  not duplicated on replay.
- **`/api/account` customization bound (0012's code half).** No false rejection in
  practice: the ProfileCustomizer document has 39 keys and every text input is
  `maxLength={120}`, so a full document serialises to ≈1.5 KB against the 4096
  cap; the DB cap (16 384 bytes) has correct headroom for multi-byte content. The
  two clients that post `customization` always send an object
  (`ProfileCustomizer.tsx:144`), so the new "must be an object" 400 is not on any
  live path.
- **`/api/feed` limit default, `/api/inventory/sync` degraded flag,
  `inventory.ts` field-preserving patches, achievements (`showcaseSlots`,
  `maxBet`, `s_hattrick` window, meta-count fix, insert-not-upsert),
  `xp.ts` level-write tolerance, locale-aware formatters (all call sites pass
  `locale`), `FeedList` mount-time clock / 500-entry seen-set / hidden-tab poll,
  `PushToggle` service-worker timeout + local unsubscribe, `GameIcon` neutral
  fallback, RTL sheen, `Header` `scope: "local"`, the five `BadgeImage alt=""`
  sites (this completes `R8-1`).** Read through and found consistent with their
  stated intent; no defect found.
- **Cosmetic only, not counted as findings**: `src/app/[locale]/error.tsx` and
  `src/app/api/og/profile/route.tsx` lost their trailing newline ("\ No newline
  at end of file"); `lint` passes.

## Summary

1 high, 0 medium, 5 low. The only issue with real economic impact is `v10-1`
(an unauthenticated, unlimited coin faucet), and it is a pre-existing
implementation detail of an earlier fix rather than a regression introduced by
`49453c4`; `v10-2`/`v10-3` are error-path placements introduced here; `v10-4` is
a mitigation the commit message overstates; `v10-5` is a deploy-time mechanism
risk with no live trigger; `v10-6` is a silent-drop direction in the `R8-2` fix.
The four restructuring areas named as highest risk — the proxy refresh, the game
race guard, the steal transfer, the OG font cache and the new error boundary —
are otherwise sound.