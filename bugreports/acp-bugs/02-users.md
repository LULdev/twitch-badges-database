# User management & ban enforcement

Audited:
- `src/lib/admin-users.ts` (list/search, detail, profile update, progress, role, ban/unban, delete, achievement grant/revoke)
- `src/app/api/admin/users/route.ts`
- `src/app/api/admin/users/achievements/route.ts`
- `src/components/admin/UsersPanel.tsx`
- `src/lib/admin.ts` (gate + `isUserBanned` + `playerGate`)
- `src/lib/admin-route.ts` (the `adminAction` wrapper this route does not use)
- All `playerGate`/`isUserBanned` call sites: `api/account`, `api/blog/react`, `api/coinrain`, `api/daily/claim`, `api/games/play`, `api/inventory/sync`, `api/steal`, `api/wheel/spin`, `api/push/subscribe`, `api/track`
- `supabase/migrations/0001..0028` (schema, FK delete actions, `profiles.role` constraint)
- `src/components/admin/AdminShell.tsx`, `src/app/[locale]/admin/page.tsx`, `docs/ACP.md`
- `messages/*.json` (all 11 locales) for the `admin.users.*` namespace

Method: grep sweeps for gate usage and mutating exports; read every route/handler in scope plus the schema migrations. Ran a Node script comparing the `admin.users.*` key tree across all 11 locale files (result: identical — no key/placeholder drift). Could **not** run the app or hit the DB (no `psql`, no live session); all findings below are by inspection, with the schema and library internals (`node_modules/@supabase/postgrest-js`) read to confirm behaviour. `npx tsc --noEmit` / eslint were not needed to establish any of these.

---

## B1 — Privilege escalation: any moderator/admin can promote themselves (or anyone) to `owner`
- **Severity**: critical
- **Confidence**: high (verified by reading)
- **Where**: `src/app/api/admin/users/route.ts:97-110` (the `role` case); gate at `src/lib/admin.ts:145-179`
- **Code**:
  ```ts
  case "role": {
    const role = String(body.role ?? "");
    if (role !== "user" && !isAdminRole(role)) {
      return Response.json({ error: "invalid role" }, { status: 400 });
    }
    if (self && role === "user") {
      return Response.json({ error: "cannot demote yourself" }, { status: 409 });
    }
    if (ownerProtected) {
      return Response.json({ error: "owner role is protected" }, { status: 409 });
    }
    await setUserRole(ctx, userId, role as AdminRole | "user");
  ```
- **Why it is wrong**: `isAdminRole` accepts `"owner"`, and the only rails are (a) you may not demote *yourself to `user`* and (b) a non-owner may not act on a target whose **current** role is `owner`. Nothing checks the role being *assigned* against the actor's role, and nothing checks the actor outranks the target. A caller whose `profiles.role` is `moderator` — which `requireAdmin` accepts and the admin page renders in full, `AdminShell` shows every tab — can POST `{action:"role", userId:"<own id>", role:"owner"}`: `self` is true but `role !== "user"`, and `targetRole` is `"moderator"` so `ownerProtected` is false. The call succeeds and the moderator becomes `owner`. The same call lets a moderator mint a *new* owner out of any ordinary member, or promote a peer to `admin`. This directly contradicts the documented model: `docs/ACP.md:37` ("The owner grants further moderators and admins in the Settings tab") and `api/admin/settings/route.ts:77-79`, where the grant path explicitly refuses anything but `moderator`/`admin` (`"holders can only be moderators or admins"`) and reserves `owner` for the one-time bootstrap flow.
- **How to reproduce**: by inspection — log in as a `moderator`, `POST /api/admin/users` with `{action:"role", userId:<self>, role:"owner"}`, then call any previously owner-only action (e.g. `POST /api/admin/settings` section `admins`). The route returns `{ok:true}` and `profiles.role` is now `owner`.
- **Suspected cause**: the role action validates the *value* but never compares it to `ctx.role`, so the role hierarchy is unenforced in the only route that writes `profiles.role`.

---

## B2 — No downward rail: a moderator can demote, ban or delete an `admin`
- **Severity**: medium
- **Confidence**: high (verified by reading)
- **Where**: `src/app/api/admin/users/route.ts:82-134` (same `ownerProtected` value reused by the `role`, `ban` and `delete` cases)
- **Code**:
  ```ts
  const ownerProtected = targetRole === "owner" && ctx.role !== "owner";
  // ...
  case "delete":
    if (self) return Response.json({ error: "cannot delete yourself" }, { status: 409 });
    if (ownerProtected) {
      return Response.json({ error: "owner is protected" }, { status: 409 });
    }
    await deleteUser(ctx, userId);
  ```
- **Why it is wrong**: `ownerProtected` has no notion of rank — it protects exactly the role `owner` and nothing else. A `moderator` targeting an `admin` gets `ownerProtected === false`, `self === false`, so the role case will demote the admin to `user` (`role:"user"` passes both rails), the ban case will ban them, and the delete case will delete them. A moderator therefore has strictly more power over an admin than the reverse is intended to allow; a single compromised moderator account can remove every admin. `docs/ACP.md:79-81` states the intended rails as "An admin cannot demote, ban or delete themselves; a non-owner cannot touch an owner account" — the peer/administrator case is simply absent.
- **How to reproduce**: by inspection — as a `moderator`, `POST /api/admin/users` with `{action:"delete", userId:"<an admin's id>"}` → `{ok:true}`, admin's profile gone.
- **Suspected cause**: the protection predicate is role-equality against a single literal instead of an ordering comparison between `ctx.role` and `targetRole`.

---

## B3 — A malformed or absurd `days` on a ban throws `RangeError` and returns 500 (ban silently not applied)
- **Severity**: medium
- **Confidence**: high (verified by reading)
- **Where**: `src/app/api/admin/users/route.ts:116-122`
- **Code**:
  ```ts
  const days = body.days;
  const until =
    days === null || days === undefined || Number(days) <= 0
      ? null
      : new Date(Date.now() + Number(days) * 86_400_000);
  await banUser(ctx, userId, String(body.reason ?? ""), until);
  ```
- **Why it is wrong**: `body.days` is typed `number | null` but is unvalidated JSON. When it is a non-numeric string (`"abc"`), `NaN`, or a very large finite number (`days: 1e308`), `Number(days) <= 0` is `false`, so the `else` branch runs: `new Date(Date.now() + NaN)` / `new Date(<8.64e313 ms>)` is an **Invalid Date**, and `Invalid Date.toISOString()` throws `RangeError: Invalid time value`. The throw happens before `banUser`, is not an `AdminGateError`, and `gateResponse` (`src/lib/admin.ts:191-196`) turns it into `{"error":"internal"}` with **500**. A malformed duration therefore never applies the ban and reports an internal server error, rather than either a permanent ban or a 400.
- **How to reproduce**: `POST /api/admin/users` with `{action:"ban", userId:"<id>", reason:"x", days:"abc"}` → HTTP 500, no row written to `bans`.
- **Suspected cause**: `Number(days)` is never checked with `Number.isFinite` (and the resulting `Date` never with `Number.isNaN(until.getTime())`) before `toISOString()`.

---

## B4 — Non-finite `limit`/`offset` produce a `NaN` PostgREST range and a 500
- **Severity**: medium
- **Confidence**: high (verified by reading; `postgrest-js` `.range()` internals read)
- **Where**: `src/app/api/admin/users/route.ts:31-32` → `src/lib/admin-users.ts:66-73`
- **Code**:
  ```ts
  // route.ts
  limit: Number(url.searchParams.get("limit") ?? 25),
  offset: Number(url.searchParams.get("offset") ?? 0),
  ```
  ```ts
  // admin-users.ts
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);
  // ...
  .range(offset, offset + limit - 1);
  ```
- **Why it is wrong**: `Number("abc")` is `NaN`, and `Math.max(NaN, 1)` / `Math.min(NaN, 100)` propagate `NaN` (they do not clamp it away). `postgrest-js`'s setter is literal — `this.url.searchParams.set("limit", \`${to}\`)` — so the request goes out as `?limit=NaN&offset=NaN`. PostgREST rejects a non-integer `limit`, the Supabase call returns an `error`, `if (error) throw error` rethrows, and `gateResponse` answers 500. Any caller sending `?limit=abc` (or `?offset=x`) gets an internal error instead of the intended default or a 400, and the panel's own list request looks like a server fault.
- **How to reproduce**: `GET /api/admin/users?limit=abc` as an admin → HTTP 500. By inspection for the exact status (could not hit the live API).
- **Suspected cause**: `Number()` coercion at the route boundary with no `Number.isFinite` guard before the clamp.

---

## B5 — This route bypasses `adminAction`, so deliberate validation errors surface as 500 instead of 400
- **Severity**: medium
- **Confidence**: high (verified by reading)
- **Where**: `src/app/api/admin/users/route.ts:145-147`; the throwing sites are `src/lib/admin-users.ts:182-184` and `219-221`
- **Code**:
  ```ts
  // admin-users.ts
  if (Object.keys(allowed).length === 0) {
    throw new Error("no editable fields supplied");
  }
  // ...
  if (Object.keys(update).length === 1) {
    throw new Error("no progress fields supplied");
  }
  ```
  ```ts
  // route.ts — every admin sibling route uses adminAction() instead of this
  } catch (error) {
    return gateResponse(error);
  }
  ```
- **Why it is wrong**: `src/lib/admin-route.ts:32-42` is the shared admin error mapper: it maps a plain `Error` whose message matches `required|already|cannot|only |reserved|unknown|missing|invalid|needs` to **400**, and only falls through to 500 otherwise. This route does not use `adminAction`; its catch calls `gateResponse`, which returns 500 for anything that is not an `AdminGateError`. So `POST {action:"update", userId, patch:{}}` and `POST {action:"progress", userId}` (and a `role`/`ban` targeting a non-existent profile, which fails the FK) all return `{"error":"internal"}` 500 instead of the operator-facing 400 the message text was written for. The error contract is inconsistent with every other admin endpoint.
- **How to reproduce**: `POST /api/admin/users` with `{action:"update", userId:"<id>", patch:{}}` → HTTP 500.
- **Suspected cause**: `route.ts` reimplements the try/catch instead of delegating to `adminAction`, losing the validation-error → 400 mapping.

---

## B6 — `bannedOnly` is applied after pagination and reports the unfiltered `total`
- **Severity**: medium
- **Confidence**: high (verified by reading)
- **Where**: `src/lib/admin-users.ts:69-73, 84-88, 137-140`
- **Code**:
  ```ts
  let builder = supabase
    .from("profiles")
    .select(PROFILE_SELECT, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  // ... server applies no banned filter; then:
  let filtered = users;
  if (options.bannedOnly) filtered = filtered.filter((u) => u.banned);
  return { users: filtered, total: count ?? filtered.length };
  ```
- **Why it is wrong**: the `bans` join is done in JS *after* the DB already paginated to 25 rows. Selecting "Banned only" therefore filters only the current page, so a banned member who is not among the newest 25 is never shown — the list can read "No members match this search" while banned accounts exist. Worse, `total` is the exact count of the **unfiltered** query, so the header renders e.g. "137 members" above two rows. (There is also no way to page to the banned ones, since the filter is invisible to the query.)
- **How to reproduce**: by inspection — with >25 profiles and any banned profile older than the newest 25, tick "Banned only": the banned row is absent and the count is unchanged.
- **Suspected cause**: `banned` is derived from a second query in JS rather than an inner join / `!inner` filter on `bans` in the main paginated query.

---

## B7 — An expired ban still renders as an active ban in the detail drawer
- **Severity**: low
- **Confidence**: high (verified by reading)
- **Where**: `src/lib/admin-users.ts:158` (`getUserDetail` returns the raw `bans` row) and `src/components/admin/UsersPanel.tsx:337-346`
- **Code**:
  ```tsx
  {detail.ban ? (
    <p className="rounded-lg bg-surface-2 p-3 text-xs text-muted">
      {t("ban.active", {
        reason: detail.ban.reason || t("ban.noReason"),
        until: detail.ban.banned_until
          ? new Date(detail.ban.banned_until).toLocaleString()
          : t("ban.permanent"),
      })}
    </p>
  ) : null}
  ```
- **Why it is wrong**: `listUsers` computes `banned` with an expiry test (`!bannedUntil || new Date(bannedUntil) > new Date()`, line 117), but `getUserDetail` returns the `bans` row unconditionally and the drawer renders `ban.active` for **any** row — including a temporary ban whose `banned_until` is in the past. There is no expiry sweep anywhere (grep for `"bans"` outside `admin-users.ts` finds only `isUserBanned`), so the row persists forever. The same member then reads "Active" in the list and "Banned: … — until <past date>" in the drawer.
- **How to reproduce**: by inspection — ban a member for 1 day, wait, reopen their detail: the list column says Active, the drawer banner still claims an active ban.
- **Suspected cause**: the drawer trusts row existence as "banned" while the list applies the expiry rule — two different definitions of the same state.

---

## B8 — Member rows are mouse-only: keyboard users cannot open the detail drawer
- **Severity**: low
- **Confidence**: high (verified by reading)
- **Where**: `src/components/admin/UsersPanel.tsx:210-215`
- **Code**:
  ```tsx
  <tr
    key={user.id}
    onClick={() => void openDetail(user.id)}
    className={`cursor-pointer ${selected === user.id ? "bg-surface-2" : ""}`}
  >
  ```
- **Why it is wrong**: the only way to select a member (and thus reach every edit / progress / role / ban / achievement / delete control) is a click on a `<tr>` that has no `tabIndex`, no `role`, and no key handler. A keyboard-only operator can search and read the table but cannot open any member's drawer, which blocks the entire panel's purpose.
- **How to reproduce**: by inspection — Tab through the panel: focus never reaches a row, and there is no other control that calls `openDetail`.
- **Suspected cause**: an interactive element built from a non-interactive table row.

---

## B9 — `push/subscribe` has no ban gate, contradicting the stated contract
- **Severity**: low
- **Confidence**: high (verified by reading)
- **Where**: `src/app/api/push/subscribe/route.ts:34` (POST), `src/lib/admin.ts:252-260` (the claim)
- **Code**:
  ```ts
  // admin.ts docblock for isUserBanned:
  // "a banned member is stopped at every mutating route (games, steals, daily claim,
  //  wheel, coin rain, progress, account, inventory, blog reactions, push)"
  ```
  ```ts
  // push/subscribe/route.ts — POST and DELETE only call supabase.auth.getUser();
  // no isUserBanned / playerGate anywhere in the file
  ```
- **Why it is wrong**: `push` is explicitly listed as a banned-stopped route, but neither the POST (register a subscription) nor the DELETE in this file calls `isUserBanned`/`playerGate`. A banned member's still-valid session can keep (re)registering push subscriptions — the one mutating player endpoint that skipped the shared gate. Impact is small (push opt-in), but it is a real contract mismatch and an inconsistency that will mislead the next reader of `isUserBanned`.
- **How to reproduce**: by inspection — grep confirms the file is the only mutating player route with no ban check.
- **Suspected cause**: the ban gate was added to the gamification routes but not to the push route when the docblock was written.

---

## B10 — `deleteUser` deletes the profile but not the Supabase auth account, and follow-up writes then report success
- **Severity**: low
- **Confidence**: medium (code verified; runtime consequence inferred)
- **Where**: `src/lib/admin-users.ts:290-305`
- **Code**:
  ```ts
  for (const table of tables) {
    await supabase.from(table).delete().eq(table === "bans" ? "profile_id" : "user_id", id);
  }
  const { error } = await supabase.from("profiles").delete().eq("id", id);
  if (error) throw error;
  await audit(ctx, "user.delete", id);
  ```
- **Why it is wrong**: `profiles.id` references `auth.users(id) on delete cascade` (migration `0001_init.sql:138`), i.e. deleting the profile does not touch the auth user, and the route never calls `supabase.auth.admin.deleteUser`. The person's `auth.users` row and session survive, so after "Delete member" they can still authenticate; the only profile-recreation trigger (`handle_new_user`, migration `0001_init.sql:163`) fires on auth-user *insert* only, so no profile is recreated. They are left as an authenticated principal with no profile, and because `updateUserProfile`/`setUserRole`/`/api/account` do 0-row updates that never inspect `error`, a POST to `/api/account` from that orphaned session returns `{ok:true}` while writing nothing. I could not verify runtime behaviour against the live DB.
- **How to reproduce**: by inspection — delete a member, then reuse their session: `authUserId()` still returns an id while `getUserDetail` returns null.
- **Suspected cause**: "delete member" removes the profile row only; the auth account is never deleted.

---

## B11 — `update` / `role` on a non-existent user id answer `{ok:true}`
- **Severity**: low
- **Confidence**: high (verified by reading)
- **Where**: `src/lib/admin-users.ts:186-189` (`updateUserProfile`), `253` (`setUserRole`)
- **Code**:
  ```ts
  const { error } = await supabase
    .from("profiles")
    .update({ ...allowed, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
  await audit(ctx, "user.update", id, { fields: Object.keys(allowed) });
  ```
- **Why it is wrong**: neither update chain uses `.select()`, so a 0-row match is not an error. `POST {action:"role", userId:"<nonexistent>", role:"admin"}` returns `{ok:true}` and writes an `admin_audit` row recording a role change that never happened; the UI shows "Role updated." No client-supplied id is validated against an existing profile (the route's `getUserDetail` result is used only for the owner check, not to 404).
- **How to reproduce**: `POST /api/admin/users` with `{action:"role", userId:"00000000-0000-0000-0000-000000000000", role:"user"}` → `{ok:true}`.
- **Suspected cause**: mutations do not assert that a row was affected (and the id is never existence-checked).

---

## B12 — `_` is left in the search term, so it acts as a LIKE wildcard
- **Severity**: low
- **Confidence**: high (verified by reading)
- **Where**: `src/lib/admin-users.ts:79-82`
- **Code**:
  ```ts
  const safe = q.replace(/[,()%]/g, "");
  builder = builder.or(
    `username.ilike.%${safe}%,display_name.ilike.%${safe}%,twitch_id.ilike.%${safe}%`,
  );
  ```
- **Why it is wrong**: the strip removes the PostgREST structural characters (`,` `(` `)` `%`, and thereby double-encoded `%2C` too) — which I verified is adequate to stop an `or()`/`ilike()` injection — but SQL `LIKE`'s single-character wildcard `_` is not removed or escaped. Searching `a_b` matches `axb`/`a1b`, i.e. the search silently over-matches. Minor wrong-output, not a security hole. (Everything else in the filter — `role` via `.eq`, the `.or()` structure — is safely parameterised.)
- **How to reproduce**: by inspection — search a term containing `_` and observe rows that do not contain it.
- **Suspected cause**: the sanitiser targets PostgREST reserved characters only, not LIKE metacharacters.

---

## Checked and found clean (so "nothing" here is meaningful)

- **Ban-gate coverage on player mutations.** Every mutating player route is gated *before* its write: `daily/claim`, `games/play`, `wheel/spin`, `steal` call `playerGate()` first; `account`, `inventory/sync` call `isUserBanned(user.id)` before the update; `blog/react` and `coinrain` check the signed-in id before the write (coin rain intentionally still allows logged-out visitors). No route merely *shows* a ban error downstream of a mutation. The one exception is B9.
- **`isUserBanned` / `playerGate` semantics** (`src/lib/admin.ts:261-297`): one row per profile (`bans.profile_id` is the PK), `banned_until` null = permanent, expiry compared correctly, missing table fails open by design — correct.
- **`profiles.role` writes** are constrained by the DB check `('user','moderator','admin','owner')` (migration `0025:29-31`) and the route's `isAdminRole` guard, and the `profiles_sync_is_admin` trigger keeps `is_admin` in step — so B1 is purely an authorization gap, not a schema violation.
- **Delete ordering / orphan rows**: every FK to `profiles` is `on delete cascade` (or `set null` for `visitor_id`, `blog_reactions.user_id`, `admin_audit.actor_id`, `brainstorm_ideas.created_by`, `bans.banned_by`), so the profile delete cascades cleanly and the manual pre-deletes cannot leave orphans. (The real gap is B10 — the auth user.)
- **`setUserProgress` clamping** (`admin-users.ts:210-218`): `Math.trunc(Number(n) || 0)` plus `Math.min/Math.max` bounds is finite-safe (`Infinity` lands on the cap, `NaN` on 0) and the row is created when absent — no silent no-op there and no non-finite value reaches the column.
- **i18n**: the full `admin.users.*` key tree is byte-identical across all 11 `messages/*.json`, including the placeholders `{count}`, `{reason}`, `{until}` and `{username}` — no `MISSING_MESSAGE` risk in this panel.
- **`EDITABLE_PROFILE_FIELDS`** correctly excludes `id`, `twitch_id`, `created_at`, `role`, `is_admin`; the whitelist loop drops unknown keys, so the `update` action cannot escalate via profile fields.
- **No server actions** (`grep "use server" src/` → none) reach these mutations; the only non-API mutation surface would be the DB directly.
