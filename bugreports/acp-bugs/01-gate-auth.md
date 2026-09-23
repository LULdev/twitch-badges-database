# Authentication, the bootstrap gate and the admin page shell

Audited: `src/lib/admin.ts`, `src/lib/admin-route.ts`,
`src/app/api/admin/auth/route.ts`, `src/app/api/admin/setup/route.ts`,
`src/components/admin/AdminGate.tsx`, `src/app/[locale]/admin/page.tsx`.
Read for context (not re-audited): `src/lib/gamification/session.ts`
(`authUserId`), `src/lib/settings.ts` (`readSetting`/`getAdminIdentity`),
`src/app/api/admin/settings/route.ts` (the `admin` grant writes),
`src/lib/cron-auth.ts`, `supabase/migrations/0025..0029`, `docs/ACP.md`,
`messages/*.json`.

Method:
- `npx eslint` on all six files → clean. `npx tsc --noEmit` → exit 0.
- `node` experiments: `crypto.timingSafeEqual` with equal-length strings of
  different byte length (throws `RangeError`); the `adminAction` 400/500 regex
  against every operator-facing error message in the admin libs; confirmed
  `PostgrestError extends Error` in `@supabase/postgrest-js@2.116.0` and that
  Next's cookie parser (`next/dist/compiled/@edge-runtime/cookies`) runs
  `decodeURIComponent` on cookie values.
- Read-only SQL against the app's project (`.env.local` `SUPABASE_DB_URL`,
  pooler user `postgres.uueughkvgmoljqhmbowm`, the same ref as
  `NEXT_PUBLIC_SUPABASE_URL`): `site_settings`, `profiles`, `admin_audit`,
  `pg_policies`, `pg_proc`, and the `supabase_migrations` ledger. No writes.
- Read-only PostgREST `GET`s: one with the service key (to fix the exact text of
  a Postgres error message) and three with the publishable key (to observe the
  live RLS policy on `site_settings`). No writes.
- Cross-checked the eleven `messages/*.json` for every key the gate and setup
  components render (all present, key-identical) and confirmed
  `admin.common.working` exists in all eleven (the component uses
  `t("common.working")` under the `admin` namespace — it resolves, no
  `MISSING_MESSAGE`).
- **Ledger state**: `supabase_migrations` lists `0001_init.sql` … `0028_extend_idea_categories.sql`;
  `0029_acp_security_hardening.sql` is written but **not applied** (its policy
  changes are absent from `pg_policies`, `vote_idea` is absent from `pg_proc`).
  B9 is about the consequence of applying it.

Not checked (other agents own these): the tab routes and panels, the
`admin` grant writes' own logic, maintenance mode, proxies/CSRF at the edge.

---

## B1 — `isBootstrapSession()` throws `RangeError` on a crafted cookie instead of returning `false`

- **Severity**: low (an unhandled exception and log noise; no escalation, no
  effect on any other visitor)
- **Confidence**: high (verified by running the two primitives; the cookie
  parser was read)
- **Where**: `src/lib/admin.ts:111-114` (the comparison), and the two
  unguarded callers `src/app/[locale]/admin/page.tsx:47` and
  `src/app/api/admin/setup/route.ts:29`
- **Code**:
  ```ts
  const expected = sign(payload);                       // 64 hex chars
  if (signature.length !== expected.length) return false;   // STRING length: 64 === 64 passes
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return false;
  }
  ```
- **Why it is wrong**: the guard compares the **character** length of the
  attacker-supplied signature against the 64-character expected hex digest, but
  `timingSafeEqual` requires equal **byte** length. A signature of exactly 64
  characters containing one non-ASCII character (63 ASCII + `é`, or the
  percent-encoded `%C3%A9`, which Next's cookie parser decodes —
  `decodeURIComponent` is present in
  `next/dist/compiled/@edge-runtime/cookies/index.js`) is 65 bytes, so the
  guard passes and `timingSafeEqual` throws
  `RangeError: Input buffers must have the same byte length`. Nothing in the
  function catches it. `isBootstrapSession()` is documented to *verify* and
  return a boolean; every caller treats it as total.
  Reached unauthenticated while bootstrap is open: `/admin` renders Next's error
  page instead of the gate, and `POST /api/admin/setup` answers `500
  {"error":"internal"}` (its own catch). `adminAction` cannot help either — the
  `RangeError` message matches none of its magic words (see B7).
- **How to reproduce**: by inspection + verified primitives. With the door open,
  send `/admin` a `Cookie: acp_bootstrap=1.%C3%A9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`
  — the `%C3%A9` decodes to one 2-byte character, so the signature segment is
  exactly 64 **characters** (passing the string-length guard) but 65 **bytes**
  → 500 instead of the passcode form.
  `digestMatches` (admin.ts:56-64) is correct here — it compares `Buffer`
  lengths, not string lengths — so this is only the cookie path.
- **Suspected cause**: a string-length guard standing in for a byte-length one.

---

## B2 — The bootstrap throttle is a non-atomic read-modify-write, so concurrent wrong guesses multiply the limit

- **Severity**: high
- **Confidence**: high (by inspection; the live counter row confirms the shape)
- **Where**: `src/app/api/admin/auth/route.ts:20-38` (`attemptsExceeded`) and
  `:40-61` (`recordAttempt`), called at `:76` and `:86`
- **Code**:
  ```ts
  async function recordAttempt(): Promise<void> {
    const { data } = await supabase.from("site_settings").select("value").eq("key", "acp_gate_state").maybeSingle();
    const state = (data?.value ?? { count: 0, windowStartedAt: 0 }) as { count?: number; windowStartedAt?: number };
    const started = Number(state.windowStartedAt ?? 0);
    const fresh = Date.now() - started > WINDOW_MS;
    const next = fresh
      ? { count: 1, windowStartedAt: Date.now() }
      : { count: Number(state.count ?? 0) + 1, windowStartedAt: started };
    await setSetting("acp_gate_state", next);      // whole-document upsert
  }
  ```
- **Why it is wrong**: `attemptsExceeded()` is a separate SELECT and
  `recordAttempt()` is a SELECT-then-blind-UPSERT with no atomic increment, no
  compare-and-set and no row lock. N requests that overlap read the same
  `count`, all compute `count + 1`, and all write that same value — so N wrong
  guesses cost **one** increment. The guard is `count >= MAX_ATTEMPTS` (5), so
  the effective budget per 15-minute window is roughly `5 × concurrency`
  instead of 5: a batch of 100 parallel POSTs (a serverless handler each doing
  an async read, so the interleaving is the normal case) yields ~100 guesses and
  leaves `count = 1`. Repeated five times per window that is a few hundred
  guesses and `count = 5`; the passcode's whole space is 100,000
  (`docs/ACP.md`: a five-digit code), so online guessing becomes a ~day-scale
  exercise instead of the multi-year one the 5/15-min limit intends. A correct
  passcode answers `200` immediately, so the attacker does not need to guess
  whether a batch "worked".
  The same helper also fails **open** if the write ever fails: `recordAttempt`
  swallows the throw from `setSetting` (`:58-60`) and only logs, and
  `attemptsExceeded` returns `false` on any error (`:35-37`) — a `site_settings`
  outage disables the throttle entirely rather than refusing entry.
- **How to reproduce**: by inspection. Fire six or more concurrent
  `POST /api/admin/auth {"passcode":"000000"}` requests while the counter is
  below 5 and re-read `site_settings.acp_gate_state`: `count` is not 6.
- **Suspected cause**: read-modify-write over a JSON document instead of an
  atomic counter/`where count < max` upsert. One sentence of direction: make the
  increment a single conditional statement (SQL function or `update ... set
  value = ... where (value->>'count')::int < 5 and window is fresh`).

---

## B3 — Cookie forgery is trivial whenever `CRON_SECRET` is unset, contradicting the documented claim

- **Severity**: medium (latent; the defect is the silent fallback, not a live
  break — the variable is present in the linked project's `.env.local`, and
  `AGENTS.md`/`cron-auth.ts` both assume it is configured everywhere)
- **Confidence**: high for the mechanism; the *deployment* state is unverified
  (I only confirmed the key name exists locally, and could not read Vercel's
  production values)
- **Where**: `src/lib/admin.ts:45-49`
- **Code**:
  ```ts
  function cookieSecret(): string {
    // The signing key is the digest itself plus a server-side secret when one
    // exists, so a leaked digest alone cannot forge the cookie.
    return `${BOOTSTRAP_DIGEST}:${process.env.CRON_SECRET ?? ""}`;
  }
  ```
- **Why it is wrong**: `docs/ACP.md` states "*`CRON_SECRET` also salts the
  bootstrap cookie signature, so a leaked digest alone cannot forge a session*"
  — and the comment says the same. With `CRON_SECRET` unset the HMAC key
  degrades to `"<digest>:"`, and `BOOTSTRAP_DIGEST` is checked into the
  repository (`admin.ts:39-40`). Anyone holding the source can then compute
  `sign(String(expires))` and mint a valid `acp_bootstrap` cookie for any
  `expires` — instantly, no brute force — and the self-asserted payload is not
  bounded by `COOKIE_TTL_MS` (`isBootstrapSession` only checks
  `expires > Date.now()`, so an attacker minting a cookie can make it
  effectively eternal). While the door is open, a forged cookie opens
  `POST /api/admin/setup` and registers the forger's own profile as **owner** —
  a full installation takeover, not just a session.
  The rest of this codebase treats a missing `CRON_SECRET` as "refuse":
  `src/lib/cron-auth.ts:14-16` returns `false` when the secret is absent, and
  `envOrNull` says so explicitly. This path silently downgrades instead.
- **How to reproduce**: by inspection — unset `CRON_SECRET` (or run a build
  where it is missing), start with no owner, then
  `value = expires + "." + createHmac("sha256", BOOTSTRAP_DIGEST + ":").update(String(expires)).digest("hex")`
  and send it as `acp_bootstrap` to `POST /api/admin/setup`.
- **Suspected cause**: `?? ""` on a security-critical secret.

---

## B4 — The door's state is derived from one mutable field of a document that other paths replace wholesale, so it can reopen

- **Severity**: medium
- **Confidence**: medium (door logic and the writes are certain by reading; the
  reopening needs one of the failure modes below, which I could not trigger)
- **Where**: `src/lib/admin.ts:75-84` (the derivation) with the writers
  `src/app/api/admin/setup/route.ts:79-83` and
  `src/app/api/admin/settings/route.ts:100` / `:121-124`
- **Code**:
  ```ts
  export async function bootstrapAvailable(): Promise<boolean> {
    const { data } = await supabase.from("site_settings").select("value").eq("key", "admin").maybeSingle();
    const value = data?.value as { profileId?: string } | null | undefined;
    return !value?.profileId;          // "no owner" === "no profileId field"
  }
  ```
  ```ts
  // settings/route.ts, "add" (the same shape at "remove"):
  const identity = await getAdminIdentity();                       // readSetting("admin", {})
  await setSetting("admin", { ...identity, grants: [...rest, grant] });
  ```
- **Why it is wrong**: "an owner exists" is inferred from the presence of
  `profileId` in a JSON document, and every subsequent writer rebuilds that
  document from whatever it read. `getAdminIdentity` is
  `readSetting<AdminIdentity>("admin", {})`, and `readSetting`
  (`src/lib/settings.ts:118-137`) returns the `{}` fallback both when the row is
  missing **and** when the read throws (its `catch` is silent) — and it reads
  through the *anon* client, so any RLS/policy/transient failure yields `{}`
  with no error anywhere. `{ ...{} , grants: [...] }` then writes a document
  **without** `profileId`; `bootstrapAvailable()` immediately reports `true`, and
  the passcode door silently reopens on an installation that already has an
  owner: `/[locale]/admin` shows the passcode form to anonymous visitors again,
  `POST /api/admin/auth` accepts the (short) passcode again, and
  `POST /api/admin/setup` will promote a **second** profile to owner because its
  only precondition is `bootstrapAvailable() && isBootstrapSession()`.
  The setup route has the mirror-image defect at `:73-87`: it promotes the
  profile (`:73-77`), then writes the door-closing settings row (`:79-83`), then
  drops the cookie — three statements with no transaction. If `setSetting`
  throws (it re-throws, `admin.ts:249`) the route answers 500 but the target is
  already `role='owner'` while `bootstrapAvailable()` is still `true`, so anyone
  holding the passcode can register an additional owner afterwards. That write
  also replaces the document rather than merging it, dropping any `grants`
  recorded under `admin` (the array migration 0026 documents as the staff
  record).
- **How to reproduce**: by inspection. Path A: make `getAdminIdentity()` return
  `{}` (delete the `admin` row, or make the anon read fail), then add a grant
  from the Settings tab → `select value from site_settings where key='admin'`
  has no `profileId` → `/admin` shows the passcode form. Path B: interrupt
  `setup` between the `profiles` update and `setSetting` → owner exists, door
  still open. Path A is not hypothetical once migration 0029 is applied — see
  **B9**, which makes the anon read of this key fail by design.
- **Suspected cause**: a two-source-of-truth door (profile role vs. settings
  field) with a document-replacement write and no transactional coupling.

---

## B5 — The throttle is global, not per-caller, so a stranger can lock the operator out of the only owner-registration path

- **Severity**: medium
- **Confidence**: high
- **Where**: `src/app/api/admin/auth/route.ts:17-38`
- **Code**:
  ```ts
  const WINDOW_MS = 15 * 60 * 1000;
  const MAX_ATTEMPTS = 5;
  ...
  return Number(state.count ?? 0) >= MAX_ATTEMPTS;   // one counter for the whole site
  ```
- **Why it is wrong**: the counter is a single `site_settings` row with no
  caller dimension (no IP, no cookie, nothing). Five wrong passcodes from
  *anywhere* answer `429` to everyone for fifteen minutes, and repeating the five
  every fifteen minutes keeps it latched — while `recordAttempt` keeps the
  window anchored to its own start, so the attacker controls the lock. This is
  the one and only way to bootstrap an installation (`docs/ACP.md`: "Register the
  owner as soon as the panel is deployed"), the door cannot be opened by any
  other means, and the lock persists across cold starts by construction. The
  legitimate operator, whose only alternative is hand-written SQL, is denied.
  (The reverse direction, too *little* throttling, is B2; this is too *much*.)
- **How to reproduce**: by inspection — `POST /api/admin/auth` with five wrong
  passcodes from an unrelated network, then attempt the correct one → `429`.
  The live row already shows the counter in use
  (`acp_gate_state = {"count":1,"windowStartedAt":1790123525232}`).
- **Suspected cause**: one global counter where the threat model needs a
  per-source limiter (or a delay that does not consume a shared budget).

---

## B6 — `audit()` can never observe a failed write: the `catch` is dead code and audit loss is silent

- **Severity**: low
- **Confidence**: high
- **Where**: `src/lib/admin.ts:199-217`
- **Code**:
  ```ts
  export async function audit(ctx: AdminContext, action: string, target: string, payload?: Record<string, unknown>): Promise<void> {
    try {
      const supabase = createAdminClient();
      await supabase.from("admin_audit").insert({ actor_id: ctx.profileId, actor: ctx.actor, action, target, payload: payload ?? null });
    } catch {
      console.warn("[admin] audit write failed");
    }
  }
  ```
- **Why it is wrong**: supabase-js resolves with `{ error }` rather than
  throwing, so the insert's `error` is neither read nor logged — the `catch`
  (and its `console.warn`) only fires on a thrown exception, which a rejected
  insert is not. A failing audit write is therefore completely invisible: no
  warning, no log line, no counter, and the mutation it describes still reports
  success. The comment "failures never break the mutation itself" is the right
  policy; losing the trail with no signal at all is not, and the neighbouring
  `setSetting` (admin.ts:243-249) does check `error`, so the convention in this
  same module is the opposite.
  The same dead-catch pattern is in `attemptsExceeded`/`recordAttempt`
  (`auth/route.ts:35-37`, `:58-60`) where it matters less because both re-read
  the row, and in `getSetting`/`isUserBanned` where the fallback is deliberate.
- **How to reproduce**: by inspection — `if (error) console.warn(...)` never
  appears; `admin_audit` is currently empty in the linked project, so no
  counter-evidence exists to notice an outage by.
- **Suspected cause**: `try { await supabase... } catch` used as if PostgREST
  errors were exceptions.

---

## B7 — A raw database error message is echoed to the client as a 400 when its text matches the classifier regex

- **Severity**: low (internal text disclosure; wrong error class for an
  internal failure)
- **Confidence**: high (the exact live message and the regex match were both
  verified)
- **Where**: `src/lib/admin-route.ts:32-42`
- **Code**:
  ```ts
  } catch (error) {
    if (error instanceof Error && !("status" in error)) {
      if (error.message && /required|already|cannot|only |reserved|unknown|missing|invalid|needs/i.test(error.message)) {
        return Response.json({ error: error.message }, { status: 400 });
      }
      console.error("[admin-route]", error);
      return Response.json({ error: "internal" }, { status: 500 });
    }
    return gateResponse(error);
  }
  ```
- **Why it is wrong**: `@supabase/postgrest-js@2.116.0` defines
  `PostgrestError = class extends Error`, so the libs' `if (error) throw error`
  (e.g. `admin-brainstorm.ts:94`, `admin-content.ts:98`) lands in this branch
  carrying the **Postgres message verbatim**. The classifier is a substring
  search for nine English words, so any internal error whose text contains one
  of them is reported to the client as a 400 with the database's own words.
  Verified live: `GET /rest/v1/brainstorm_ideas?select=votes&id=eq.NaN` answers
  `400 {"code":"22P02","message":"invalid input syntax for type bigint: \"NaN\""}`
  — that message matches `invalid`, so
  `POST /api/admin/ideas {"action":"vote","id":"abc"}` (the NaN id path already
  accepted by that route) returns the raw Postgres text in a 400 to the caller
  instead of a 500, i.e. an infrastructure fault is dressed as a client error
  and its internals are handed out.
  This is the opposite branch of the same heuristic that
  `bugreports/acp-bugs/06-newsletter-ideas-audit.md` B12 already reports (there:
  an operator-facing validation error becomes a 500); the two are distinct
  outcomes and the over-broad regex causes both. The comment above the code
  ("a plain Error becomes 400 with its message, because these errors are written
  for the operator") is exactly what the implementation cannot distinguish.
- **How to reproduce**: `POST /api/admin/ideas {"action":"vote","id":"abc"}`
  as an admin → `400 {"error":"invalid input syntax for type bigint: \"NaN\""}`
  (by inspection; the REST message text above was fetched live).
- **Suspected cause**: classifying a thrown error by matching substrings of its
  message instead of using a typed error for operator-facing validation.

---

## B8 — Live state, not a code defect: the passcode door is open in the linked project and no owner has ever been registered

- **Severity**: medium (it is the enabling condition that makes B2/B3/B5 bite)
- **Confidence**: high (read-only SELECT; the pooler user
  `postgres.uueughkvgmoljqhmbowm` carries the same project ref as
  `NEXT_PUBLIC_SUPABASE_URL` in this `.env.local`, so it is the project the app
  talks to. I could not confirm that this `.env.local` matches the values
  configured on the Vercel project for the production domain.)
- **Where**: `site_settings.admin` in the linked database
- **Code** (query output, not source):
  ```
  site_settings: [{ key:"admin", value:{ "grants": [] }, updated_at:"2026-09-22T23:51:30Z" },
                  { key:"acp_gate_state", value:{ "count":1, "windowStartedAt":1790123525232 }, ... }]
  profiles:      [{ role:"user", n:1 }]
  admin_audit:   []            (no "owner.registered" row has ever been written)
  ```
- **Why it is wrong**: `bootstrapAvailable()` returns `true`, so the passcode
  form is served to anonymous visitors on the live installation and
  `POST /api/admin/auth` accepts attempts. Per `docs/ACP.md` the digest is
  brute-forceable offline by anyone with the repository, which is precisely why
  that document says "Register the owner as soon as the panel is deployed; after
  that the digest is inert" — that step has not happened, and the empty audit
  table shows it never has. Nothing here is a bug in the code; it is a live
  exposure worth closing (register the owner, then re-check
  `site_settings.admin` for a `profileId`). I am reporting it because every other
  finding in this file is only reachable *while the door is open*.
- **How to reproduce**: `select key, value from site_settings where key = 'admin'`
  → no `profileId`; `select count(*) from admin_audit` → 0.
- **Suspected cause**: the owner-registration step of the documented deployment
  procedure has not been performed.

---

## B9 — The pending migration 0029 denies the `admin` key to the public roles, but the only reader of that key uses the anon client — so after `db:apply` the owner identity silently reads as `{}` and the bootstrap door reopens

- **Severity**: high (it reopens the passcode door on an installation that has an
  owner, which is the one state `docs/ACP.md` calls safe; the trigger is one
  ordinary Settings action, not an error)
- **Confidence**: high (both halves verified: the policy is in
  `supabase/migrations/0029_acp_security_hardening.sql`, the reader is
  `src/lib/settings.ts:118-137`; and the ledger check below shows 0029 is
  **not yet applied**, so the current behaviour still reads the row)
- **Where**: `supabase/migrations/0029_acp_security_hardening.sql:52-54` (policy)
  with `src/lib/settings.ts:126-127` (`createClient`, the anon server client) and
  `src/app/api/admin/settings/route.ts:71` + `:100` (the write that consumes it);
  the consequence lands on `src/lib/admin.ts:75-84`
- **Code**:
  ```sql
  -- 0029_acp_security_hardening.sql
  drop policy if exists "settings_public_read" on public.site_settings;
  create policy "settings_public_read" on public.site_settings
    for select using (key not in ('admin', 'acp_gate_state'));
  ```
  ```ts
  // settings.ts:126 — the reader that now gets nothing
  const supabase = await createClient();        // anon/publishable key, RLS applies
  const { data } = await supabase.from("site_settings").select("value").eq("key", key).maybeSingle();
  const value = (data?.value as T | undefined) ?? fallback;   // fallback = {}
  ```
  ```ts
  // settings/route.ts:71,100
  const identity = await getAdminIdentity();                                  // -> {}
  await setSetting("admin", { ...identity, grants: [...rest, grant] });        // no profileId
  ```
- **Why it is wrong**: the new policy has no `to` clause, so it applies to
  `anon` **and** `authenticated`; a policy `using` expression filters rows out
  without erroring, so RLS turns the `admin` row into "no row" for every
  non-service role. The panel's only accessor for that key,
  `getAdminIdentity()` → `readSetting`, reads through the *anon* server client
  (the comment there explains why: "these values are read from public pages") and
  falls back to `{}` on a missing row, silently — its `catch` is not even
  involved. From the moment 0029 is applied, then:
  - **`bootstrapAvailable()` flips back to `true` as soon as any grant is added
    from the Settings tab**: `{ ...{}, grants: [...] }` is written over the
    document, destroying `profileId`. `/[locale]/admin` serves the passcode form
    to anonymous visitors again, `POST /api/admin/auth` accepts the short
    passcode again, and `POST /api/admin/setup` registers a **second owner** for
    whoever supplies it (its only precondition is
    `bootstrapAvailable() && isBootstrapSession()`). A private repository with a
    public deployment makes the digest recoverable offline
    (`docs/ACP.md`), so this is a takeover path, not a nuisance.
  - the staff roster the Settings tab renders (`settings/route.ts:28`) is
    permanently empty, "remove grant" always answers "that profile is not in the
    list" (line 116), and the owner-protection check
    `identity.profileId === profileId` (line 118) can never match.
  Migration 0029 is the right fix for 04-B7 (the world-readable settings keys);
  it is the reader that has to move to the service role with it, or the key has
  to be added to the panel's own read path.
- **How to reproduce**: read-only verification performed —
  `select name from supabase_migrations` lists `0001…0028` and **not** 0029, and
  `pg_policies` still shows `settings_public_read` with `qual = true`, so the
  live project still serves the row today; a `GET /rest/v1/site_settings?key=eq.admin`
  with the publishable key currently returns `{"grants": []}` and
  `?key=eq.acp_gate_state` returns the counter. Apply 0029 and the same two reads
  return `[]` while `getAdminIdentity()` returns `{}`.
- **Suspected cause**: the hardening migration was written against the table's
  policies without moving `readSetting` off the anon client.

---

## Checked and deliberately not reported

- **i18n**: all 23 keys the gate/setup/forbidden screens use exist in all eleven
  `messages/*.json` with identical key sets, and `admin.common.working` exists in
  every locale — the `t("common.working")` call inside the `admin` namespace
  resolves. No broken keys, no placeholder mismatch.
- **`AllowBootstrap` reachability**: no caller passes `allowBootstrap: true`
  (`requireAdmin` is called with no arguments everywhere, and
  `/api/admin/setup` uses `bootstrapAvailable()`/`isBootstrapSession()` directly),
  so the restriction cannot be bypassed — the bootstrap branch is dead code today.
  A bootstrap cookie is refused with 403 by `/api/admin/users`,
  `/api/admin/users/achievements`, `adminAction`'s `requireAdmin()` and the page.
- **Cookie flags**: `httpOnly`, `sameSite:"strict"`, `secure`, `path:"/"`,
  `maxAge` consistent with the payload — no finding. Forgery/replay is B3/B1.
- **Role model**: `viewerRole`/`requireAdmin` admit `moderator`, `admin` and
  `owner` alike. That is documented behaviour (`docs/ACP.md`: the panel is
  reachable by all three, "three roles, not per-action capability flags"), so the
  moderator's reach is not reported here; the rank checks that *are* missing live
  in the users and settings routes and are already reported (02-B1/B2, 04-B9).
- **Status codes on the gate paths**: auth → 410 (closed), 429 (throttled), 401
  (bad passcode), 400 (bad body), 200; setup → 409 (owner exists), 401 (no
  session), 400 (bad username), 404 (no profile), 500 (internal); `adminAction`
  → 403/401 via `AdminGateError` and `gateResponse`. All correct except the two
  classifier outcomes in B7/06-B12.
- **`adminOrNull`** (admin.ts:182-188) has no callers.
- **`ADMIN_LOGINS`** is documented in `README.md:59` as the login allowlist that
  may manage content but is referenced nowhere in `src/` or `scripts/` — a stale
  doc line, not a code defect. Mentioned only so it is not re-grepped.
- **`settings_public_read` exposing `acp_gate_state` and the `admin` roster** to
  the anon key is already reported as 04-B7; not repeated here. Current live
  state (read-only probe): the policy is still `qual = true`, so with the
  publishable key `GET /rest/v1/site_settings?key=eq.admin` returns
  `{"grants": []}` and `?key=eq.acp_gate_state` returns the counter — the
  exposure is still live because migration 0029 is not applied. B9 is what
  applying it costs if `readSetting` is not moved off the anon client with it.
