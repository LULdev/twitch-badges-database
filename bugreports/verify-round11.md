# Round-11 verification — `098ce06` (round-10 fixes) and its successors

Date: 2026-09-22. Adversarial read-only pass over the coin-rain gate commit
`098ce06`, the route-honesty commit `e003082`, and the two commits that landed
on top of them (`8b5a5e6` docs, `2350cbf` stats labels). Working tree =
`2350cbf`, `git status` clean.

Scope: the five areas named in the brief — migration `0014` + `coinRain`,
the steal settlement reorder, `syncs/potat.ts`, `visits.ts`, and
`/api/coinrain`. Nothing here repeats an item recorded as fixed in
`bugreports/AGENT-AUDIT.md` or `bugreports/verify-round10.md`; the coin-rain
CAS (`v10-1`) and the counter-throw-between-coin-moves (`v10-2`) are the two
items this round re-verifies and (for the listed paths) confirms fixed.

No High and no Medium defect was found. Three Low and three informational
items follow.

Method: code read plus live probes against production with the anon key
(`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) and a direct `SUPABASE_DB_URL`
connection used **read-only**. Every constraint probe ran inside a
transaction that ended in `ROLLBACK`; the row count after each run was
re-checked and is quoted in the evidence. No project file was written except
this report.

---

## v11-1 — `coinRain` consumes the daily gate before it knows the award landed, so a later request answers `already: true` for a coin that was never granted

- **Severity**: low (economy honesty; fail-closed, never double-pays)
- **Side**: server / economy + API body
- **File:line**:
  - `src/lib/gamification/daily.ts:278-285` — the gate INSERT
  - `src/lib/gamification/daily.ts:289` — the award, the only coin write
  - `src/lib/gamification/xp.ts:327-335` — `bumpCoins`, which cannot fail on a missing row
  - `src/app/api/coinrain/route.ts:17-19` — the honest-reporting path this defeats
- **Evidence**: the gate row is inserted first and the award comes after:
  ```ts
  const { error: gateError } = await supabase
    .from("coin_rain_gate")
    .insert({ owner_id: profileOwnerId, giver_key: giverKey, day });   // :278-280
  if (gateError) { if (gateError.code === "23505") return { ok: false, already: true }; throw gateError; }
  await bumpCoins(profileOwnerId, 1);                                  // :289
  ```
  `bumpCoins` calls `add_coins`, which is
  `update public.user_progress set coins = greatest(0, coins + $2) where user_id = $1 returning coins`
  (`supabase/migrations/0006_hardening_atomic_counters.sql:56-65`). With no
  `user_progress` row for the owner it matches 0 rows, returns `null` and raises
  **no error**. Proven live, in a rolled-back transaction:
  ```
  select public.add_coins('00000000-…-0000000000aa', 1)  ->  [{"coins":null}]
  rows created for that user in user_progress            ->  0
  ```
  `bumpCoins` therefore returns `Number(null ?? 0) === 0` and does not throw
  (`xp.ts:333`), so `coinRain` returns `{ ok: true }` (`daily.ts:308`) for an
  award that did not happen — and the gate row, already committed, blocks the
  giver's next attempt for the rest of the UTC day with `{ ok: false, already: true }`.
  The client maps `ok` to `"done"` and `already` to `"again"`, and both render
  `<Coin/> ✓` with the button disabled (`src/components/CoinRainButton.tsx:24-28,56-60`).
  So the user is told the coin was sent twice over, for a coin that was never
  credited. `coinRain` never calls `ensureProgress`/`getProgress` — only
  `bumpCoins` — which is what makes this reachable.
  Reachability: the owner's `user_progress` row is normally created by the
  profile page render (`src/app/[locale]/profile/[username]/page.tsx:217`, via
  `getProgress`), but that call is wrapped in `.catch(() => null)`, so a failed
  render still serves the page and its rain button. A direct
  `POST /api/coinrain {"profileId": X}` against a profile no page has rendered
  hits it too. A transient transport/DB failure of the single `add_coins` call
  after a successful gate INSERT reaches the same state.
- **Why it is a bug**: this is the third variant of the class `e003082` set out
  to close ("report only what the gate did"). The gate *did* decide — it decided
  this giver may not rain again today — but it decided it on a request whose
  payload never moved, and the retry reports that decision as a success. The
  ordering is the safe one for double-award (nothing can be paid twice), so the
  defect is under-payment plus a false confirmation, not inflation.
- **Confidence**: high on the mechanism (both halves proven: the transaction
  probe above and the client rendering, read). Low on frequency — it needs the
  owner to have no `user_progress` row or a transient RPC failure.
- **Fix direction**: make the gate compensatable. Award first is wrong (it
  re-opens double-award under concurrency). Instead wrap the award and roll the
  gate back when it cannot be shown to have landed — e.g. delete the gate row
  (`delete().eq("owner_id", …).eq("giver_key", …).eq("day", day)`) and rethrow
  when `bumpCoins` throws or returns no movement for a missing row; or call
  `ensureProgress(profileOwnerId)` before the INSERT so the `add_coins` no-op
  cannot occur. A one-line `ensureProgress` is the minimum.

---

## v11-2 — the steal's zero-sum property is intact on success/defended/raced-void, but the two `bumpCoins` RPCs are still the only fallible statements between the two coin moves

- **Severity**: low (residual; not introduced by `098ce06`)
- **Side**: server / economy
- **File:line**: `src/lib/gamification/daily.ts:188` (thief debit),
  `:195` (victim credit), `:202-220` (counters, now after both moves)
- **Evidence**:
  ```ts
  const balance = await bumpCoins(thiefId, -settings.price + stolen);      // :188
  await bumpCoins(victimProfile.id, -stolen + settings.price);             // :195
  const [thiefCounter, victimCounter] = await Promise.all([…]);            // :202-214
  ```
  `bumpCoins` is `await supabase.rpc("add_coins", …)` and **throws** on a
  transport/DB error (`xp.ts:333-334`). If the second call rejects, `:195` is
  skipped while `:188` has committed: the thief is debited `price - stolen`, the
  victim is credited nothing, and the sum of the two accounts changed — the
  transfer is no longer zero-sum. The `steal_attempts` row (`:139-150`) also
  survives, so the 5-minute pair flood check arms (`:110-118`) and the caller
  gets a 500 for a heist that moved coins and cannot be retried.
  `098ce06` fixed the *counter* half of exactly this (`v10-2`: the throw used to
  sit between the moves) and left the coin half, which is now strictly narrower
  but not gone. `getProgress` at `:103` and `:129` has already upserted both
  `user_progress` rows, so the silent-no-op form of v11-1 does **not** apply
  here: the only failure mode is a real RPC error.
- **Why it is a bug**: the arithmetic the brief asks about holds on every
  *logic* path (`-price+stolen` and `-stolen+price` sum to 0 on both settlement
  outcomes; nothing is read back and rewritten), but a mid-transfer RPC failure
  still strands a half-applied move with no compensating action.
- **Confidence**: medium-high on the mechanism (plain control flow; `add_coins`
  is a single non-transactional statement). Likelihood depends on a DB/transport
  error between two RPCs milliseconds apart.
- **Fix direction**: one SQL `transfer_coins(from_id, to_id, amount)` that
  performs both updates in one statement (or `add_coins` called once per
  participant inside a single `BEGIN`), or a compensating `bumpCoins` on the
  throw path plus a delete of the attempt row. Same fix direction as the
  documented residual list, now narrowed to `:188`/`:195`.

---

## v11-3 — `2350cbf` stopped publishing heartbeat *ids* on `/stats`, but the message column beside them still prints `potat.app …`, `badgebase …`, `ivr.fi …` on a public page

- **Severity**: low (public vendor-name exposure; latent, 0 rows today)
- **Side**: UI / SEO (public surface)
- **File:line**: `src/app/[locale]/stats/page.tsx:1049-1057` (raw message),
  `:336` (the label lookup that *was* fixed)
- **Evidence**: the label column now goes through `sourceLabel(source.source)`,
  which falls back to a generic localized string rather than the internal id:
  ```tsx
  const sourceLabel = (id: string) => SOURCE_LABELS[id] ?? t("sourceOther");   // :336
  …
  {source.last_message ? (
    <span className="ms-2 text-[11px] text-danger" title={source.last_message}>
      {source.last_message.slice(0, 40)}
    </span>
  ) : null}                                                                     // :1049-1057
  ```
  `last_message` is `system_heartbeats.message` (`src/lib/stats.ts:175`), the
  table is public-read (`supabase/migrations/0004_stats_uptime.sql:29-31`, policy
  `heartbeats_public_read`), and the messages that land in it are the sync
  errors verbatim: `throw new Error(\`potat.app ${path} failed: ${res.status} …\`)`
  (`src/lib/twitch/potat.ts:62`), `badgebase ${path} failed: …`
  (`src/lib/twitch/badgebase.ts:23`), `ivr.fi /global failed: …`
  (`src/lib/twitch/ivr.ts:35`), `badges.blog ranking failed: …`
  (`potat.ts:187`), plus `Twitch token endpoint failed: …`
  (`helix.ts:39`). `cron/global` and `cron/potat` write
  `message: error.message` straight through
  (`src/app/api/cron/potat/route.ts:25`; `health.ts:68` in `withHeartbeat`).
  So the first failed sync publishes a provider name, 40 characters of it inline
  and the full text in the `title` attribute, on a page that is in every
  locale's sitemap.
  Live check today: `select count(*) from system_heartbeats where message ilike
  '%potat.app%' or message ilike '%badgebase%' or message ilike '%ivr.fi%'` →
  **0**, because the table was pruned and every recent run was healthy. It is a
  latent exposure, not a currently visible one.
- **Why it is a bug**: `2350cbf`'s stated goal was "stop publishing provider
  names" and it closed the id column and the 11 locale bundles. The message
  column is on the same public table and is the one place free-form provider
  text is still rendered; the commit's own verification note ("no provider name
  remains in any of the 11 locale files, and the only other hit in src is a JSX
  comment") scopes the check to static strings, so the runtime channel was not
  looked at.
- **Confidence**: high on the rendering and on the message content (both read);
  the judgement that this is undesirable is mine — an operator does want the real
  error, and the argument for keeping it is legitimate.
- **Fix direction**: if the exposure matters, do not render
  `last_message` raw — either drop it from the public table (keep it in the
  admin/`/api/health` view) or map known providers to neutral text the way
  `sourceLabel` now does, e.g. truncate at the first non-localized token. If the
  intent is to keep raw provider errors public, say so in the report so the next
  round does not re-flag it.

---

## v11-4 — `coin_rain_gate` has no retention path and `created_at` is never read; only rows with `day = current_date` can ever matter

- **Severity**: informational
- **Side**: DB / operations
- **File:line**: `supabase/migrations/0014_coin_rain_gate.sql:21-27`;
  `src/lib/gamification/daily.ts:276-280` (the only reader)
- **Evidence**: the table is `(owner_id, giver_key, day, created_at)` with the
  PK on `(owner_id, giver_key, day)`. The only query in the codebase is the
  INSERT; nothing ever SELECTs, and `created_at` (`0014:25`) is never read by any
  code path. The gate only ever asks "does today's row exist", so every row with
  `day < current_date` is dead weight. Verified live: the migration is recorded
  once (`public.supabase_migrations` → `0014_coin_rain_gate.sql`) and the
  changelog row exists exactly once (`changelog` id 257, 2026-09-22T09:13Z), so
  the table is not being re-seeded; row count today is **0**.
  There is no prune for it: the only retention job in the tree is
  `pruneHeartbeats(90)` (`src/lib/health.ts:75-92`), called from
  `src/app/api/cron/global/route.ts:26,54`. `activity_events` has the same
  unbounded shape and the same absence of a prune, so this matches existing
  practice rather than breaking it — but the gate table is new and trivially
  prunable.
- **Why it is worth recording**: growth is one row per *awarded* coin plus one
  per request from a caller rotating source IPs (the anonymous key is the IP
  hash, a limitation already recorded in `agent-18-security.md:68`), and the rows
  can never be read again after their UTC day ends. `on delete cascade` handles
  profile deletion, so the only unbounded axis is time.
- **Confidence**: high (schema + grep + live counts).
- **Fix direction**: add one statement to the daily housekeeping in
  `/api/cron/global`, beside `pruneHeartbeats(90)`:
  `delete from public.coin_rain_gate where day < current_date - 1`
  (the `- 1` keeps yesterday for any in-flight request across midnight UTC).
  Cheap, and it cannot affect correctness because no code reads a past day.

---

## v11-5 — nothing in the schema enforces the `giver_key` invariant the whole gate depends on

- **Severity**: informational (hardening)
- **Side**: DB
- **File:line**: `supabase/migrations/0014_coin_rain_gate.sql:22`
  (`giver_key text not null`), `src/lib/gamification/daily.ts:277`
- **Evidence**: the app builds the key as
  `const giverKey = giverId ?? anonymousKey ?? "anonymous";` (`daily.ts:277`),
  where `anonymousKey` is `ipHashFromRequest(request)` →
  `hashIp(clientIp(...))` → a 40-char sha256 slice, or `hashIp("unknown")` when
  neither `x-real-ip` nor `x-forwarded-for` is present
  (`src/lib/gamification/session.ts:23-50`). So the app never produces an empty
  key, and the two namespaces (a profile UUID for a signed-in giver, a 40-char
  hash for an anonymous one) cannot collide. What the schema allows, proven live
  per-probe in rolled-back transactions:
  ```
  unknown profile FK   -> 23503  coin_rain_gate_owner_id_fkey   (good: item 1(a))
  null giver_key       -> 23502  not-null constraint            (good)
  null day             -> 23502  not-null constraint            (good)
  empty giver_key      -> ACCEPTED
  giver_key of 10 000 chars -> ACCEPTED
  ```
  So the database will happily store `''`, which collapses every anonymous
  visitor onto one key — precisely the v10-1 failure shape — and the only thing
  preventing it is a caller always passing a non-empty string. The
  `clientIp` → `"unknown"` fallback is the other single-key path; it needs both
  IP headers absent, which `agent-18-security.md:26` established Vercel prevents,
  so it is not reachable on this deployment (already refuted; not re-reported).
- **Why it is worth recording**: the gate's correctness is a property of the
  *key*, and the one constraint that makes it atomic (the PK) says nothing about
  the key's content. A future caller that omits the third argument, or a change
  of ingress that stops setting both IP headers, silently reverts to a
  single-slot gate and nothing fails loudly.
- **Confidence**: high (constraint probe; code read).
- **Fix direction**: `alter table public.coin_rain_gate add constraint
  coin_rain_gate_giver_key_len check (length(giver_key) between 8 and 128);` —
  the app's keys are 36 or 40 chars, so the bound cannot reject a legitimate
  caller and turns a silent collapse into a 23514.

---

## v11-6 — the comment above `coinRain`'s profile check still describes a `getProgress()` call that the function does not make, and that stale comment is what hides v11-1

- **Severity**: informational
- **Side**: server / readability
- **File:line**: `src/lib/gamification/daily.ts:254-256` (comment),
  `:291-306` (the writes it describes)
- **Evidence**:
  ```
  254  // The id arrives from the client — verify it is a real profile before it
  255  // reaches getProgress(), which would try to upsert user_progress against the
  256  // foreign key and turn a bad request into a 500.
  ```
  `coinRain` (`:242-309`) contains no `getProgress` call — not now, and not in
  `098ce06^`'s version either (checked with `git show 098ce06^:…`). The comment
  survived the v10 rewrite and asserts a call whose *effect* (an upserted
  `user_progress` row) is exactly what v11-1 needs and does not get.
  The same drift appears at `:186-187` ("Their errors are inspected: the round
  used to report success while games_won/coins_won or the counter stayed behind"),
  which was accurate when the counters threw and now describes logging only
  (`:215-220`).
- **Why it is worth recording**: a comment that names a non-existent call is how
  the next reader concludes the award is guaranteed to land on an existing row.
- **Confidence**: high.
- **Fix direction**: replace `:254-256` with what the check actually does (reject
  an id that would fail the FK on the `coin_rain_gate` INSERT or the later
  `add_coins`), and note that `add_coins` is a silent no-op without a
  `user_progress` row; reword `:186-187`.

---

## Areas checked and found clean

1. **`coin_rain_gate` as a compare-and-set — verified working.**
   Live `pg_constraint`: `coin_rain_gate_pkey PRIMARY KEY (owner_id, giver_key, day)`
   and `coin_rain_gate_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES profiles(id) ON DELETE CASCADE`
   — one pkey and one fkey, so `23505` can only mean "this giver already rained
   on this owner today", and nothing else in the table can raise it. Transactional
   probe: first identical INSERT → 1 row; second identical INSERT →
   `23505 duplicate key value violates unique constraint "coin_rain_gate_pkey"`;
   row count after `ROLLBACK` → 0. `098ce06`'s claim is accurate.
2. **Brief 1(a) — an unknown profile cannot create a gate row.** Two
   independent guards: the `profiles` existence check returns `{ok:false}`
   before any INSERT (`daily.ts:257-262`), and the FK backstops it —
   probe with `owner_id = 00000000-…` → `23503 coin_rain_gate_owner_id_fkey`.
   (Residual, negligible: a profile deleted between the check and the INSERT
   converts to a `23503` → 500 rather than to `already`; the FK's
   `ON DELETE CASCADE` keeps the table consistent.)
3. **Brief 1(b) — the app's `giver_key` can never be empty and cannot collapse
   two givers.** `ipHashFromRequest` returns a 40-char hex digest
   (`session.ts:36-50`); a signed-in giver's key is a UUID
   (`daily.ts:277`). Different lengths and different alphabets, so no collision
   between the anonymous and the authenticated namespace. The schema-level gap is
   v11-5, not an app defect.
4. **Brief 1(c) — the UTC day cannot be gamed by the client.** `day` is
   `new Date().toISOString().slice(0, 10)` computed in Node from the server clock
   (`daily.ts:276`); no request field, header or cookie reaches it, and Postgres'
   `now()` is not involved. Sending one request either side of midnight UTC buys
   exactly one extra coin — the documented, deliberate widening from a rolling
   24 h window to a calendar day (`0014`'s changelog row) — and nothing more.
   The same server-clock pattern is used by `claimDaily` (`:13`).
5. **Brief 1(d) — gate-before-award is the correct ordering for the invariant it
   protects.** Inserting the gate first is what makes the CAS sound: an award-first
   order would allow every racer to pay before any of them lost the gate, so the
   ordering is right and the defect is the missing compensation, reported as
   v11-1 rather than as an argument to reorder.
6. **Brief 1(e) — the FK is the only retention the table has, and profile
   deletion is covered.** `ON DELETE CASCADE` is real (live constraint def above).
   Absence of a time-based prune is v11-4.
7. **`0014` is applied exactly once and did not duplicate its changelog row.**
   `public.supabase_migrations` lists all 14 files through `0014_coin_rain_gate.sql`;
   `changelog` has exactly one coin-rain title (id 257). `db-apply.ts` writes the
   migration and its ledger row in one transaction (`scripts/db-apply.ts:51-54`),
   and every statement in `0014` is idempotent except the changelog INSERT, which
   the ledger prevents from re-running.
8. **RLS on `coin_rain_gate` — verified unreadable and unwritable by the public
   roles.** Live: `relrowsecurity = true`, `relforcerowsecurity = false`,
   `pg_policy` → **no policies**, `information_schema.role_table_grants` →
   only `postgres` and `service_role`; `anon`/`authenticated` have
   `rolbypassrls = false` and no grants. `anon` REST read →
   `401 {"code":"42501","message":"permission denied for table coin_rain_gate"}`.
   The IP hash therefore stays out of the public-read `activity_events`
   (`daily.ts:296` still writes `giver: giverId ?? "anonymous"`), which was the
   second half of the v10-1 fix.
9. **Brief 2 — the steal's zero-sum holds on all three named paths, and the
   raced-void path cannot leave coins moved.** Thief `-price + stolen`
   (`:188`), victim `-stolen + price` (`:195`): the sum is 0 by construction for
   both `success = true` (stolen > 0) and `success = false` (`stolen = 0`, so
   `-price` and `+price`). The race guard and its compensating DELETE are at
   `:157-181` and `return` there, while both coin moves are at `:188`/`:195` —
   strictly after — so the void branch executes with nothing moved; the only
   statement before it that touches the DB is the `steal_attempts` INSERT
   (`:139-150`). The reorder is real: `:202-220` runs both `bump_counters` calls
   only after both moves, and a counter error is `console.warn`ed, not thrown —
   `v10-2` is fixed for the counter half. The removed `thiefProfile` query
   (`098ce06^` `daily.ts:196-201`) was genuinely dead: nothing from `:222`
   onwards reads it, and `logActivity` resolves its own username (`xp.ts:56-64`).
   Residual is v11-2.
10. **Brief 3 — `syncs/potat.ts` throws before any write.** `runPotatSync`'s
    first statement is the `Promise.all` of the two fetches (`:45-52`); the
    distribution failure throws at `:60-68`; the first write in the function is
    the `badges` upsert at `:220-225`, and nothing between `:69` and `:219`
    touches the DB (reads of `badges` `:78-98` and `badge_momentum` `:109-111`,
    then pure computation). So "a failed or truncated distribution feed cannot
    reach the writes" is accurate. The only rows written on this path are the
    `sync/potat` heartbeat from `withHeartbeat` (`health.ts:63-70`) and the
    `cron/potat` error heartbeat (`cron/potat/route.ts:21-26`) — the
    observability path, by design.
11. **Brief 3 — the potat error message carries no secret and no internal URL.**
    Every throw reachable from `fetchAllDistribution` interpolates only `path`
    (always `/twitch/badges?first=…[&after=<cursor>]`, built locally) and an HTTP
    status: `potat.ts:53-55`, `:59`, `:62`, `:93`. `POTAT_API_URL` is read once
    (`potat.ts:34`) and never appears in a message. Grep over every
    `throw new Error(\`…\`)` in `src/lib/twitch/*.ts` and `src/lib/syncs/*.ts`
    found no env-derived URL in any of them. A `.json()` parse failure or a
    timeout/`fetch failed` produces a message with no URL either. The message
    *is* public via `system_heartbeats` and `/stats:1049-1057` — that exposure is
    recorded as v11-3, and it is about vendor names, not credentials.
12. **Brief 3 — nothing separate is lost by aborting early.** The status sweep is
    not a separate pass: `statusSweeps` is incremented inside the distribution
    loop (`:163-196`) from `resolveStatus`, so a distribution outage cannot
    suppress a sweep that would otherwise have run. Likewise the owners-feed
    failure path is unchanged and still preserves existing counts
    (`:139-141`, plus the log body at `:237`).
13. **Brief 4 — `visits.ts`: the removed lookup was not the guard, and the dedup
    semantics are unchanged.** The guard is the FK on `profile_visits`, proven
    live per-probe in rolled-back transactions:
    `profile_id = 00000000-…` → `23503 profile_visits_profile_id_fkey`;
    `visitor_id = 00000000-…` → `23503 profile_visits_visitor_id_fkey`. The DDL
    is `profile_id uuid not null references public.profiles (id) on delete cascade`
    (`0003_gamification.sql:98-101`), so a successful INSERT is a proof of
    existence and the deleted `profiles` lookup could only ever have produced a
    contradictory answer. Dedup is byte-identical: the same three predicates
    (`profile_id`, `ip_hash`, `created_at >= now-5min`) and the same
    `count > 0 → false` early return (`visits.ts:16-28`); a probe inserting two
    rows for the same (profile, ip) inside the window returns count 2, so a
    legitimate repeat visitor is still rejected for five minutes exactly as
    before. The new `error → warn + false` branch is a strict improvement (a
    failed read no longer reads as "no recent visit"); the bump failure now
    warns and returns `false` with the row already inserted, which is the same
    observable semantics as before (`window armed, counter not bumped`).
14. **Brief 5 — `/api/coinrain` can no longer claim `already: true` for a case
    the gate did not decide, and no path answers 200 with a body the gate did
    not earn — with the single exception of v11-1.** `already` is set in exactly
    one place, `daily.ts:283`, on `gateError.code === "23505"`, and `23505` can
    only come from `coin_rain_gate_pkey` (proof in item 1). The unknown-profile
    branch (`:262`) and the self-rain branch (`:267`) return `{ok:false}` with no
    `already`, so the route's `result.already === true` yields
    `{"ok":false,"already":false}` — verified by reading both sides. A non-23505
    gate error rethrows (`:284`) out of the handler, so it becomes a 5xx, not a
    200. On the client, `already:false` now resets the button to `idle` instead
    of latching `✓` (`CoinRainButton.tsx:27-28`), which closes the
    `agent-06-profile-steal.md:64` complaint for this endpoint. The one remaining
    200-with-a-misleading-body path is v11-1 (a `23505` produced by a request
    whose award never landed).
15. **Nothing else in the two commits is unverified.** `098ce06` also touched
    `games.ts` (`v10-3`: the compensating `game_rounds` DELETE now checks its
    error and the comment was corrected) — read, consistent, and out of the
    named scope. `e003082` touched only `src/app/api/coinrain/route.ts` and
    `bugreports/AGENT-AUDIT.md`. `8b5a5e6` is docs-only. `2350cbf` is the stats
    label fix reported as v11-3.

## Residuals re-stated (already known, not re-reported)

- IP-rotation still defeats an IP-keyed anonymous gate (one coin per rotating
  IP), recorded in `agent-18-security.md:68`; the 0014 gate removes the
  *repeat-from-one-IP* half only.
- `/api/coinrain` answers 200 for every failure, so abuse is invisible to
  status-code watchers (`agent-18-security.md:67`) — the client depends on that
  shape to tell `already` from a transient failure.
- A logged-in giver can rain twice per profile per day (once as their UUID, once
  as their IP hash) because the two keys live in different namespaces. Pre-existing
  design, noted for completeness.
- No prune exists for `activity_events` either; v11-4 asks only for the new
  table's.