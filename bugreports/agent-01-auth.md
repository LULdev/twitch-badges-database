# Bug report — bug-hunter #1 "auth"

Scope: `src/components/TwitchLoginButton.tsx`, `src/app/[locale]/auth/callback/page.tsx`,
`src/app/[locale]/login/page.tsx`, `src/lib/supabase/browser.ts`,
`src/lib/supabase/server.ts`, `src/lib/gamification/session.ts`, `src/proxy.ts`,
`src/app/[locale]/layout.tsx` (plus the call sites needed to confirm impact:
the 10 `/api/*` routes that authenticate from the session cookie, and
`src/components/Header.tsx`).

Read-only audit. No project file was modified; the only file written is this one.
Library behaviour was confirmed against the installed code
(`@supabase/ssr@0.12.7`, `@supabase/auth-js@2.116.0`, `next@16.3.5`,
`next-intl@4.5.0`).

---

## auth-1: Server-side token refresh inside `/api/*` routes is silently discarded, which forces users to be logged out later

- **Severity**: high
- **Side**: server
- **File**: `src/lib/supabase/server.ts:16-18` (with `src/proxy.ts:39-45`)

- **Evidence**:

```ts
// src/lib/supabase/server.ts:12-19
cookies: {
  getAll() {
    return parseCookieHeader(cookieStore.toString() ?? "");
  },
  // Server Components may not set cookies — refresh happens in proxy.ts.
  setAll() {},
},
```

```ts
// src/proxy.ts:39-45
export const config = {
  matcher: [
    // Skip API routes, Next internals, and any file with an extension
    "/((?!api|_next/static|_next/image|sw\\.js|.*\\..*).*)",
  ],
};
```

`getUser()` on the server client does refresh an expired access token —
`@supabase/auth-js` `GoTrueClient.__loadSession()` (dist/main/GoTrueClient.js:2513-2590):

```js
const hasExpired = currentSession.expires_at ? ... < constants_1.EXPIRY_MARGIN_MS : false;
if (!hasExpired) { ... return { data: { session: currentSession }, error: null }; }
const { data: session, error } = await this._callRefreshToken(currentSession.refresh_token);
```

and the rotated session is handed to the cookie adapter, which only ever delivers
it through `setAll`: `@supabase/ssr` `applyServerStorage()` (dist/main/cookies.js:435)
→ `setAll(...)`. Ten `/api/*` routes authenticate through this exact client and
are all excluded from the proxy matcher:

```
src/app/api/{account,inventory/sync,progress,coinrain,daily/claim,games/play,
             wheel/spin,steal,blog/react,push/subscribe}/route.ts   → authUserId()/createClient()
e.g. src/app/api/account/route.ts:17-22
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "not authenticated" }, { status: 401 });
```

- **Why it is a bug**: nothing refreshes the session for `/api/*`. When the access
  token (default TTL 1 h) expires, the *first* request that touches the session is
  typically one of these client fetches (games, wheel, coin rain, profile save), not
  a page navigation. That request renews the session against GoTrue — rotating the
  refresh token — and the new cookies are thrown away by the empty `setAll`. The
  browser keeps the now-superseded pair (expired access + old refresh token). While
  the user keeps browsing pages this is masked by GoTrue's ~10 s refresh-token reuse
  window, but once more than that window has elapsed, the next `getUser()` presents
  an already-used refresh token; GoTrue rejects it (`Invalid Refresh Token: Already
  Used`) and auth-js, seeing a non-retryable refresh failure on an already-expired
  access token, removes the session from storage (`__loadSession`, error branch) —
  which the *proxy* then faithfully persists, deleting the browser's auth cookies.
  The user is signed out mid-session with no error, and cannot tell why. Correctness
  here depends entirely on a ~10 s server-side grace period.
- **Confidence**: likely (mechanism confirmed in the pinned library sources; the
  exact GoTrue rotation/reuse timing is server-side and not verifiable statically)
- **Fix direction**: make the cookie adapter writable where Next allows it (Route
  Handlers / Server Actions can mutate `cookies()`), and/or refresh the session for
  `/api/*` too — either by widening `proxy.ts`'s matcher to the non-cron API paths
  or by adding a small auth-refresh guard in front of them — so a rotated refresh
  token is always written back to the browser.

---

## auth-2: The code exchange is performed twice; the page's own `exchangeCodeForSession` always fails

- **Severity**: medium
- **Side**: client
- **File**: `src/app/[locale]/auth/callback/page.tsx:28-52`

- **Evidence**:

```tsx
// src/app/[locale]/auth/callback/page.tsx:28-52
// Guard against double exchange: StrictMode re-runs the effect, and a second
// exchangeCodeForSession call with the same code would fail.
const startedRef = useRef(false);
useEffect(() => {
  if (!code || startedRef.current) return;
  startedRef.current = true;
  const supabase = createClient();
  const exchange = async () => {
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) {
      // A session may already exist despite the error (e.g. retry after a
      // network hiccup) — continue instead of showing a dead end.
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData.session) { goToInventory(); return; }
      setError(exchangeError.message);
      return;
    }
    goToInventory();
  };
  void exchange();
}, [code]);
```

`createClient()` (`src/lib/supabase/browser.ts:20`) is `createBrowserClient`, which
sets `detectSessionInUrl: true` and `flowType: "pkce"`
(`@supabase/ssr` dist/main/createBrowserClient.js). `@supabase/auth-js` then
auto-exchanges the callback URL itself:

```js
// GoTrueClient.js:296-297   (constructor)
if (!settings.skipAutoInitialize) { this.initialize().catch(...); }
// GoTrueClient.js:386-410   (_initialize)
else if (await this._isPKCECallback(params)) { callbackUrlType = 'pkce'; }
if (isBrowser() && this.detectSessionInUrl && callbackUrlType !== 'none') {
  const { data, error } = await this._getSessionFromURL(params, callbackUrlType); ...
// GoTrueClient.js:3262-3275 (_getSessionFromURL, pkce)
const { data, error } = await this._exchangeCodeForSession(params.code, { flowId: ... });
// GoTrueClient.js:1259-1263 (public entry point)
async exchangeCodeForSession(authCode, options) { await this.initializePromise; ... }
```

- **Why it is a bug**: the code is single-use and the code verifier is deleted by
  the first successful (or failed) exchange (`_exchangeCodeForSession` calls
  `removePKCEVerifier` in both branches). Because the effect's own call *awaits*
  `initializePromise`, it strictly runs **after** the client's automatic exchange has
  already consumed the code and removed the verifier, so it can never succeed: it
  either throws `AuthPKCECodeVerifierMissingError` or gets `flow_state_expired` from
  `/token?grant_type=pkce`. The login only ever completes through the error-path
  `getSession()` fallback in the snippet above — i.e. the visible happy path in this
  file is dead code and the real path is the "despite the error" branch. The
  `startedRef` guard protects against StrictMode re-running *this* effect, which is
  not the source of the duplicate exchange. Two further consequences: a guaranteed
  400 request on every login, and the page's `error` state can be set from a call
  that was always going to fail (today it is masked because `getSession()` resolves
  with the auto-exchange's session first; the auto-exchange also strips `?code` from
  the URL via `window.history.replaceState`, and Next patches that call to
  re-render `useSearchParams` — app-router.js:265-280 — so the "no code" branch of
  this page is reachable depending on history-state timing).
- **Confidence**: confirmed (ordering enforced by `await this.initializePromise`)
- **Fix direction**: either let the library own the exchange and delete the manual
  call, or construct the callback client with
  `createBrowserClient(url, key, { auth: { detectSessionInUrl: false } })` and keep
  the explicit exchange as the single path — do not run both.

---

## auth-3: `x-real-ip` is trusted, so the client can still choose its own IP

- **Severity**: medium
- **Side**: server
- **File**: `src/lib/gamification/session.ts:23-33`

- **Evidence**:

```ts
function clientIp(headersLike: { get(name: string): string | null }): string {
  const real = headersLike.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = headersLike.get("x-forwarded-for") ?? "";
  ...
```

Vercel's documentation lists exactly one IP header it owns: "Retrieve the public IP
address of the client. Note that Vercel overwrites **this** header [`x-forwarded-for`]
and does not forward external IPs to prevent spoofing" (vercel.com/docs/headers/request-headers;
Vercel's own helpers are `x-forwarded-for` / `x-vercel-ip-*` / `@vercel/functions`
`ipAddress()`). `x-real-ip` is not in that set, so a client-supplied
`x-real-ip: <random>` is very likely passed through to the function.

- **Why it is a bug**: the whole point of this helper is to be unspoofable — its own
  comment documents that trusting a client-controlled value "let anyone defeat the
  5-minute view dedup, the daily coin-rain gate and the per-IP blog reaction rule".
  Preferring `x-real-ip` moves the hole rather than closing it: if the header is
  forwarded, sending a fresh random value per request defeats every IP-keyed control
  at once (`/api/coinrain`, `/api/blog/react`, the 5-minute view dedup), which is an
  economy/abuse issue. (Note: this is the fix direction B3 of `bugreports/BUGS.md`
  recorded as done; that fix asserted `x-real-ip` is "set by Vercel", an assumption
  the Vercel docs do not support.)
- **Confidence**: likely — the code is plain; what is unconfirmed is whether Vercel's
  ingress strips a client-supplied `x-real-ip` (cannot be verified from the repo).
- **Fix direction**: trust only the header Vercel documents as overwritten
  (`x-forwarded-for`; Vercel replaces it, so the whole value is the client IP), or use
  `@vercel/functions`' `ipAddress()`. Do not prefer an undocumented header.

---

## auth-4: Refreshed auth cookies are not visible to the render of the same request

- **Severity**: low
- **Side**: shared
- **File**: `src/proxy.ts:10-34`

- **Evidence**:

```ts
export async function proxy(request: NextRequest) {
  const response = handleI18nRouting(request);      // next-intl snapshots headers here
  ...
  const supabase = createServerClient(..., {
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
  });
  await supabase.auth.getUser();
  return response;
}
```

next-intl's middleware builds its response before that, from a copy taken at call
time (dist/esm/production/middleware/middleware.js): `const l = new Headers(t.headers); …
e.next({ request: { headers: l } })`. The Supabase client then mutates
`request.cookies` *after* that copy was made, and forwarded request headers come from
the copy (that is the documented Next API for propagating modified request cookies).

- **Why it is a bug**: on the request where the access token crosses its expiry the
  Set-Cookie reaches the browser, but the Server Component render of that same request
  still sees the old cookie. The layout (`src/app/[locale]/layout.tsx:66-70`) therefore
  performs a **second, redundant** refresh of the identical session
  (`__loadSession` → `_callRefreshToken`), whose result is dropped by
  `server.ts:17`. Today this is invisible only because GoTrue answers a
  within-reuse-window refresh with the same new token; the header on that one request
  and the number of `/token` calls both depend on that grace behaviour rather than on
  this code. The comment in `server.ts` ("refresh happens in proxy.ts") is only half
  true for exactly this reason.
- **Confidence**: confirmed (mechanism); the user-visible impact is masked today.
- **Fix direction**: run the Supabase refresh before/independently of the i18n
  response and re-create the response's request headers afterwards (or set the
  refreshed cookie header on the response next-intl returns) so the current render
  sees the refreshed session.

---

## auth-5: `redirectTo` omits the locale prefix; the post-login locale is negotiated, not chosen

- **Severity**: low
- **Side**: client
- **File**: `src/components/TwitchLoginButton.tsx:28` (with `src/app/[locale]/auth/callback/page.tsx:18`)

- **Evidence**:

```tsx
redirectTo: `${window.location.origin}/auth/callback`,
```

```tsx
// callback page: locale taken from the *current* path segment
const locale = window.location.pathname.split("/")[1] || "en";
window.location.replace(`/${locale}/inventory`);
```

`routing` uses `localePrefix: "always"` (`src/i18n/routing.ts:6`) and there is no
`src/app/auth/callback` route — only `src/app/[locale]/auth/callback`.

- **Why it is a bug**: the return URL does not name a locale, so the post-login
  destination is not the locale the user logged in from: `/auth/callback` is bounced
  by the i18n middleware to whatever locale it negotiates from the `NEXT_LOCALE`
  cookie (set by `syncCookie`, and it deliberately does *not* set the cookie when the
  cookie is absent and the resolved locale already equals the `Accept-Language`
  locale) or, failing that, from `Accept-Language`. A user who opened `/pt/login` with
  no locale cookie (e.g. an `en-US` browser that switched language without the cookie
  being written, or a client that drops the cookie) is redirected to `/en/inventory`
  after logging in. It also adds a 307 hop to every login, and the bare
  `/auth/callback` must be present in Supabase's redirect allow-list or the entire
  login fails (config, not code — per AGENTS.md the allow-listed value is indeed the
  un-prefixed path, so this matches today).
- **Confidence**: confirmed for the mechanism/extra hop; the wrong-locale outcome
  depends on cookie state (unconfirmed in production).
- **Fix direction**: build the return URL from the active locale
  (`window.location.pathname`, i.e. `/${locale}/auth/callback`) so no locale
  negotiation is involved.

---

## auth-6: The callback page ignores OAuth error parameters and cannot retry in place

- **Severity**: low
- **Side**: client
- **File**: `src/app/[locale]/auth/callback/page.tsx:23-31,56-66`

- **Evidence**:

```tsx
const code = searchParams.get("code");
...
if (!code || startedRef.current) return;
```

```tsx
if (!code) { /* "failed" + t("noCode") + retry link */ }
```

- **Why it is a bug**: a provider-side failure returns
  `?error=access_denied&error_description=…` (or `error_code=…`) and no `code`, so the
  user who just declined/renounced the Twitch prompt — or whose authorization server
  side failed — is shown the generic "no code in the URL" message instead of the
  provider's reason, which is the only actionable information for support. Additionally
  `startedRef.current` is set on the first attempt, so once the exchange has failed the
  component can never retry within that page load; the sole escape is the `/login`
  link (which is itself redirected to `/inventory` if the session did in fact get
  established, so this is not a hard dead end — hence low).
- **Confidence**: confirmed
- **Fix direction**: read `error` / `error_description` and render them with their own
  message, and reset `startedRef` (or key the effect on an attempt counter) so the
  retry button re-runs the exchange.

---

## auth-7: Logout revokes every device's session

- **Severity**: low
- **Side**: client
- **File**: `src/components/Header.tsx:49`

- **Evidence**:

```tsx
const supabase = createClient();
await supabase.auth.signOut();
```

`@supabase/auth-js` documents the default explicitly (`GoTrueClient.js`, signOut JSDoc):
"**Warning**: the default `scope` is `'global'`. This signs the user out of *every
device* they are currently signed in on, not just the current tab/session. If you only
want to sign out of the current session (the behavior most other auth libraries
default to), pass `{ scope: 'local' }` explicitly."

- **Why it is a bug**: clicking "Log out" in the header logs the user out on their
  phone/TV as well. That is a surprising side effect for a per-device menu action and
  is not what the UI implies. (If site-wide logout is intended, this is a
  documentation matter — flagging it as a behavioural defect, not a missing feature.)
- **Confidence**: confirmed behaviour; intent unconfirmed
- **Fix direction**: `await supabase.auth.signOut({ scope: "local" })` if only this
  session should end.

---

## Checked and found sound (no finding)

- `src/lib/supabase/server.ts:14` `parseCookieHeader(cookieStore.toString() ?? "")`:
  `parseCookieHeader` **is** exported from `@supabase/ssr@0.12.7` (re-exported via
  `dist/main/utils/index.js`); Next's `RequestCookies.toString()` exists and
  URI-encodes values, whose round-trip through `cookie.parse`'s `decodeURIComponent`
  is a no-op for `@supabase/ssr`'s base64url payloads (alphabet `A-Za-z0-9-_`).
- `src/lib/supabase/browser.ts`: env vars are read as static `NEXT_PUBLIC_*` member
  expressions as the invariant requires, and the missing-var case throws loudly
  instead of shipping `undefined`.
- `src/app/[locale]/login/page.tsx:24-28` / `inventory/page.tsx:29-38`: no redirect
  loop — an authenticated visitor of `/login` is sent to `/inventory`, and the
  inventory page renders `TwitchLoginButton` inline for anonymous visitors.
- Locale keys used by the callback page and button (`login.title/subtitle/button/
  redirecting/failed/noCode/retry`) exist identically in all 11 `messages/*.json`
  files (no `MISSING_MESSAGE` risk on the error screens).
- No client component reaches `@/lib/supabase/server` or `@/lib/supabase/admin`
  (checked every `"use client"` file), so no service-role key can reach the bundle.
- `next-intl`'s `useRouter()` spreads the Next router (`{...o, push, replace, prefetch}`),
  so `router.refresh()` in `Header.logout` is the real Next refresh and does re-render
  the server header.
- `next-intl`'s locale redirect preserves the query string
  (`formatPathname(pathname, prefix, request.nextUrl.search)`), so the bare
  `/auth/callback` bounce does not drop `?code=` (auth-5 is about locale/hops only).
- The catch-all `src/app/[locale]/[...rest]/page.tsx` just calls `notFound()` — no
  auth-relevant redirect path.
