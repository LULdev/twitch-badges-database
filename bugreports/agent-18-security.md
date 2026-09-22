# agent-18 — security audit (bug-hunter #18)

Scope read in full: `src/app/api/{account,steal,coinrain,games/play,daily/claim,wheel/spin,blog/react,push/subscribe,push/vapid,inventory/sync,progress}/route.ts`,
`src/lib/gamification/session.ts`, `src/lib/supabase/{admin,browser}.ts`, `src/lib/env.ts`,
`src/proxy.ts`, `supabase/migrations/0001_init.sql` (policies/grants), `0003_gamification.sql` (policies/grants),
`0006_hardening_atomic_counters.sql`. Live probes were read-only GETs against the public production site.

---

## Priority hypothesis — REFUTED (client cannot influence the IP headers on Vercel)

- **File**: `src/lib/gamification/session.ts:23-33`
- **Evidence (code)**:
  ```ts
  const real = headersLike.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = headersLike.get("x-forwarded-for") ?? "";
  ...
  return parts.length > 0 ? parts[parts.length - 1] : "unknown";
  ```
- **Evidence (authoritative platform doc)**, `https://vercel.com/docs/headers/request-headers`, fetched 2026-09-22:
  - `x-forwarded-for`: *"The public IP address of the client that made the request. If you are trying to use Vercel behind a proxy, we currently **overwrite** the `X-Forwarded-For` header and **do not forward external IPs**. This restriction is in place to prevent IP spoofing."*
  - `x-real-ip`: *"This header is identical to the `x-forwarded-for` header."*
  - Custom client-supplied XFF requires an **Enterprise "Trusted Proxy"**.
- **Evidence (live)**: `curl -D - https://twitch-badges-database.vercel.app/en` → `Server: Vercel`, `X-Vercel-Id: fra1::iad1::…`; spoofed `-H "x-real-ip: 203.0.113.7" -H "x-forwarded-for: 203.0.113.9, 10.0.0.1"` on `/api/progress` and `/api/push/vapid` produced normal responses (no observable header-dependent behaviour to compare; the mutation-based test — POST `/api/blog/react` toggle — was not run because it writes production data).
- **Verdict**: On this deployment (plain `vercel.app` production, no trusted proxy) Vercel overwrites both headers before the function runs, so a client cannot forge the value used by `view dedup`, `coinRain` and `blog/react`. The `clientIp()` hardening is correct. **No bug.** Residual note (informational): if the app is ever fronted by another proxy/self-hosted ingress, `x-forwarded-for` again becomes client-controlled — the rightmost entry is then *not* necessarily the trusted edge; only Vercel's overwrite guarantees trust.

---

## sec-1: `POST /api/push/subscribe` upsert lets anyone detach (or claim) another browser's push subscription

- **Severity**: medium
- **Side**: server
- **File**: `src/app/api/push/subscribe/route.ts:31-40` (contrast `:66-68`)
- **Evidence**:
  ```ts
  const admin = createAdminClient();
  const { error } = await admin.from("push_subscriptions").upsert(
    { user_id: user?.id ?? null, endpoint, p256dh, auth, user_agent: ... },
    { onConflict: "endpoint" },
  );
  ```
  The DELETE handler immediately below was explicitly hardened:
  ```ts
  // ... Deleting by endpoint alone would let anyone who learns another
  // browser's endpoint URL unsubscribe it.
  query = user ? query.eq("user_id", user.id) : query.is("user_id", null);
  ```
  Schema: `endpoint text not null unique` (`0001_init.sql:259`).
- **Why it is a bug**: The POST path performs the same `endpoint`-keyed mutation the DELETE path guards against, but with **no ownership check**. An anonymous POST carrying a victim's endpoint hits `onConflict: "endpoint"` and rewrites that row's `user_id` to `NULL` (detach → the owner stops receiving targeted push), and a logged-in attacker can rewrite it to *their own* id (claim). It is the exact scenario the DELETE comment describes, unmitigated on the write path. Exploitation needs the endpoint URL (long/unguessable), so this is not trivially mass-exploitable, but it is a genuine inconsistency and the guard exists precisely because endpoints are considered learnable.
- **Confidence**: confirmed (logic + schema); exploitation requires endpoint knowledge.
- **Fix direction**: In POST, when the endpoint already exists, verify it belongs to the caller (or is unowned) before upserting; reject otherwise — mirror the DELETE check, or use the caller's scoped client instead of the admin client.

## sec-2: `/api/coinrain` has no authentication check and no rate limiting

- **Severity**: medium
- **Side**: server
- **File**: `src/app/api/coinrain/route.ts:6-13`
- **Evidence**:
  ```ts
  const body = ... as { profileId?: string } | null;
  if (!body?.profileId) return Response.json({ error: "profileId required" }, { status: 400 });
  const giverId = await authUserId();          // may be null — never rejected
  const result = await coinRain(giverId, body.profileId);
  ```
  Every sibling economy route rejects unauthenticated callers (`steal/route.ts:8`, `games/play/route.ts:8`, `daily/claim/route.ts:8`, `wheel/spin/route.ts:8`); coinrain is the only one that does not.
- **Why it is a bug**: An unauthenticated request with an arbitrary `profileId` reaches the economy mutation with a `null` giver. The endpoint trusts a client-supplied id, has no per-caller rate limit (the only gate is inside `coinRain`, which is IP-keyed — and IP is the sole defence), and always answers `200` even on failure, so abuse is invisible. At minimum it is an unauthenticated write surface on the coin economy; combined with the IP-keyed gate it is a cheap amplification vector for scripted callers rotating IPs.
- **Confidence**: likely (impact depends on `daily.ts:coinRain`, which is outside scope).
- **Fix direction**: Require `authUserId()` (401 when null) as the other economy routes do, and add a rate limit; stop returning `200` for failed mutations.

## sec-3: `/api/games/play` numeric/input validation gap (NaN / Infinity / negative bet, unvalidated `input`)

- **Severity**: medium
- **Side**: server
- **File**: `src/app/api/games/play/route.ts:13-16`
- **Evidence**:
  ```ts
  if (!body?.game || typeof body.bet !== "number") {
    return Response.json({ error: "invalid payload" }, { status: 400 });
  }
  const result = await playGame(userId, body.game, body.bet, body.input ?? {});
  ```
- **Why it is a bug**: `typeof NaN === "number"` and `typeof Infinity === "number"` both pass, and negatives are never excluded. `bet` is then handed to the server-authoritative game engine as a coin stake. If the engine does not itself clamp (`Number.isFinite` + bounds), `NaN` poisons arithmetic and `-bet`/`Infinity` can invert or inflate payouts. `body.input` is forwarded as `PlayInput` with no shape check, so arbitrary client keys reach game logic. The route (not the engine) is the declared validation boundary.
- **Confidence**: likely (needs `games.ts` to confirm the engine does not re-clamp; the route-level gap is certain).
- **Fix direction**: Validate `Number.isSafeInteger(body.bet) && body.bet > 0` (and a max) in the route, and validate/whitelist the `input` fields per game.

## sec-4: `/api/account` stores unvalidated `customization` JSON with no size cap (and unvalidated `showcaseSlots` strings)

- **Severity**: low
- **Side**: server
- **File**: `src/app/api/account/route.ts:51-53` (also `:45-49`, `:37-40`)
- **Evidence**:
  ```ts
  if (body.customization && typeof body.customization === "object") {
    patch.customization = body.customization;
  }
  ```
  Every other field is bounded (`slice(0,64)`, `slice(0,280)`, regex-checked colour, clamped numbers); `customization` is stored verbatim into a `jsonb not null` column (`0003_gamification.sql:140`), and `showcaseSlots` accepts any strings.
- **Why it is a bug**: No depth/size cap → an authenticated user can store arbitrarily large JSON in their row (storage/DoS amplification; `jsonb` re-parsed on every profile read). `showcase_slots` entries are never validated against owned badges/slugs, so they are attacker-chosen opaque strings that the profile page later renders — safe only as long as the renderer never interpolates them into a URL/HTML sink. Not currently a confirmed XSS (React escapes text, and no `dangerouslySetInnerHTML` on profile data), hence low.
- **Confidence**: likely for the size/validation gap; unconfirmed for any XSS impact.
- **Fix direction**: Enforce a serialized-size cap (e.g. `JSON.stringify(...).length <= 4096`) and a fixed key/type allowlist for `customization`; validate `showcaseSlots` against the caller's owned badge slugs.

## sec-5: `/api/blog/react` — no rate limit, and reaction deletion is keyed only on IP hash (not `user_id`)

- **Severity**: low
- **Side**: server
- **File**: `src/app/api/blog/react/route.ts:24-37`
- **Evidence**:
  ```ts
  const ipHash = ipHashFromRequest(request);
  ...
  .eq("post_id", post.id).eq("ip_hash", ipHash).eq("emoji", body.emoji).maybeSingle();
  if (existing) { await supabase.from("blog_reactions").delete().eq("id", existing.id); ... }
  ```
- **Why it is a bug**: The route runs on the service-role client (RLS bypassed) and deletes by `ip_hash`, ignoring `user_id`. Any two clients sharing an IP hash (NAT/CGNAT, corporate, VPN exit) collide, so one visitor can silently remove another's reaction — the same class of issue the push DELETE handler was hardened for. There is also no request rate limit on the toggle (only the per-IP-per-emoji row uniqueness), and every call is a service-role write.
- **Confidence**: likely (IP-spoof bypass is refuted per the priority finding; the shared-IP collision and missing rate limit are real).
- **Fix direction**: Scope the delete to the caller's `user_id` when authenticated, and add a lightweight per-IP rate limit on the toggle.

## sec-6: `/api/push/subscribe` accepts arbitrary `endpoint`/`p256dh`/`auth` with no validation — SSRF/blind-request vector

- **Severity**: medium
- **Side**: server
- **File**: `src/app/api/push/subscribe/route.ts:20-40`
- **Evidence**:
  ```ts
  if (!endpoint || !p256dh || !auth) { return 400 }
  ... upsert({ user_id: user?.id ?? null, endpoint, p256dh, auth, ... })
  ```
  `endpoint` is stored unvalidated as free text (`0001_init.sql:259`) and is later used as the destination of server-side Web Push requests.
- **Why it is a bug**: The stored `endpoint` becomes a URL the server POSTs to when delivering notifications. Accepting an arbitrary URL means an attacker can register an endpoint pointing at an internal/third-party host (or a Vercel metadata/loopback address) and have the server make requests to it — blind SSRF, plus the endpoint can be used to confirm server-side reachability. There is also no cap on how many distinct endpoints one caller can register, so the table can be flooded.
- **Confidence**: likely (depends on `src/lib/push.ts`, outside scope; the unvalidated storage and the "endpoint is fetched server-side" model are certain).
- **Fix direction**: Validate `endpoint` as an `https:` URL whose host is an allow-listed push service (`*.googleapis.com`, `*.mozilla.com`, `*.windows.com`, `*.apple.com`, …), reject private/loopback IPs, and rate-limit registrations.

---

## Verified as NOT a bug

### profiles UPDATE trigger from 0006 does block `is_admin` / `view_count` / `twitch_id`

- **File**: `supabase/migrations/0006_hardening_atomic_counters.sql:22-42`
- **Evidence** (trigger, quoted):
  ```sql
  create or replace function public.protect_profile_columns()
  returns trigger language plpgsql set search_path = public as $$
  begin
    if auth.uid() is not null then
      new.id := old.id;
      new.is_admin := old.is_admin;
      new.view_count := old.view_count;
      new.twitch_id := old.twitch_id;
      new.created_at := old.created_at;
    end if;
    return new;
  end;
  $$;
  drop trigger if exists profiles_protect_columns on public.profiles;
  create trigger profiles_protect_columns
    before update on public.profiles
    for each row execute function public.protect_profile_columns();
  ```
  Policy it complements: `profiles_self_update on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id)` (`0001_init.sql:340-341`); grants leave `UPDATE` on `profiles` to `authenticated` but revoke `INSERT`/`DELETE` (`0001_init.sql:380`).
- **Analysis**: A logged-in PATCH of `{"is_admin":true}` through the public REST API satisfies the policy (`auth.uid() = id`) but the BEFORE-UPDATE trigger restores `new.is_admin := old.is_admin`, so the write is a silent no-op. The `auth.uid() is not null` guard cannot be dodged: an unauthenticated/anon request has `auth.uid() = null`, so the policy predicate `auth.uid() = id` is false and the UPDATE is rejected before the trigger matters. `id`, `created_at` and `twitch_id` are likewise restored. The trigger is correct.
- **Note**: `username` is intentionally not protected (self-service rename is by design); no `email` column exists on `profiles` (`0001_init.sql:119-134`), so the public-read policy exposes no email.

### No secret reachable from client bundles

- **File**: `src/lib/supabase/admin.ts:8-19`, `src/lib/supabase/browser.ts:9-20`
- **Evidence**: no `"use client"` module imports `@/lib/supabase/admin` or `@/lib/env` (grep across `src/**` returned empty). `browser.ts` reads only `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` as static member expressions; `SUPABASE_SERVICE_ROLE_KEY` appears only in `admin.ts:11`, which is imported exclusively by server routes/libs/scripts. No `dangerouslySetInnerHTML` sink renders user-controlled data (only `jsonLdScript(...)` and `renderMarkdown(post.content)`, both admin-authored).

### `proxy.ts` / `env.ts` / `push/vapid` / `inventory/sync` / `progress` / `account` / `steal` / `daily/claim` / `wheel/spin`

No auth bypass, IDOR, SSRF or open redirect found. `proxy.ts` correctly excludes `/api` from the i18n matcher and only refreshes the session. `/api/push/vapid` exposes only the public VAPID key (verified live: `{"configured":true,"publicKey":"BJN4ODj6Dx-…"}`). `/api/inventory/sync` derives the username from the caller's own DB row (no client input → no SSRF). `/api/account` writes through the caller-scoped RLS client (`.eq("id", user.id)`), so no cross-user IDOR; `steal`/`daily`/`wheel` all require `authUserId()`.
