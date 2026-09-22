# Bug report — agent-11 "api-misc"

## api-1: Public /api/feed leaks internal `user_id` (and raw `payload`) of every user
- **Severity**: high
- **Side**: server
- **File**: src/app/api/feed/route.ts:14
- **Evidence**: `.select("id,user_id,username,avatar_url,kind,title,body,xp_amount,coins_amount,payload,created_at")` served from `createAdminClient()` (line 10), serialized straight back in the response (line 24). Confirmed in the consumer type too: src/components/FeedList.tsx:10 `user_id: string | null;`
- **Why it is a bug**: This endpoint is unauthenticated and uses the service-role client, bypassing RLS, then returns each event's internal `user_id` (Supabase auth UUID) and the free-form `payload` column. Anyone polling the public feed harvests stable user identifiers and whatever producers put in `payload` (e.g. badge/target references), which is exactly the data the app deliberately avoids exposing elsewhere.
- **Confidence**: confirmed
- **Fix direction**: Drop `user_id` and `payload` from the select (or allow-list only display fields); the feed only needs username/avatar/kind/title/body/amounts.

## api-2: FeedList `seenIds` set grows without bound (memory leak) and polling ignores hidden tab
- **Severity**: medium
- **Side**: client
- **File**: src/components/FeedList.tsx:40,48-51
- **Evidence**: `const seenIds = useRef(new Set<number>(...))`; `for (const event of fresh) seenIds.current.add(event.id);` — ids are never removed. `setEvents((prev) => [...fresh, ...prev].slice(0, 60))` bounds the rendered list but not the Set.
- **Why it is a bug**: On a long-lived tab (the app keeps FeedList mounted and polls every 5s forever, line 65) `seenIds` accumulates every event id the server ever returns, forever — an unbounded in-memory structure on a page designed to stay open. Separately the 5s interval keeps firing while the tab is hidden, burning requests.
- **Confidence**: confirmed
- **Fix direction**: Cap `seenIds` (e.g. keep only ids present in the retained 60 events) and skip polling when `document.visibilityState !== "visible"`.

## api-3: PushToggle.disable() leaves an active subscription + stale server row while UI shows "off"
- **Severity**: medium
- **Side**: client
- **File**: src/components/PushToggle.tsx:92-107
- **Evidence**:
  ```ts
  await fetch("/api/push/subscribe", { method: "DELETE", ... });
  await subscription.unsubscribe();
  } finally { setState("off"); }
  ```
- **Why it is a bug**: If the DELETE fetch rejects (offline, 5xx, aborted), control jumps to `finally`, so `subscription.unsubscribe()` never runs and the rejection is swallowed. The browser keeps the push subscription and the server row is untouched, yet the button renders "off". The user believes push is disabled but notifications keep arriving; a later `enable()` reuses the still-live subscription with no visible indication anything is stale.
- **Confidence**: confirmed
- **Fix direction**: `await subscription.unsubscribe()` first (or in its own `try`), and only set state "off" after both the unsubscribe and DELETE succeed; otherwise surface an error state.

## api-4: /api/feed returns 500 on a malformed `limit` instead of falling back to the default
- **Severity**: low
- **Side**: server
- **File**: src/app/api/feed/route.ts:9
- **Evidence**: `const limit = Math.min(50, Math.max(5, Number(url.searchParams.get("limit") ?? "30")));` — `Number("abc")` is `NaN`, and `Math.max(5, NaN)`/`Math.min(50, NaN)` both yield `NaN`, so `.limit(NaN)` is sent.
- **Why it is a bug**: A caller passing a non-numeric `limit` (e.g. `?limit=all`) gets an invalid limit pushed into the PostgREST query, turning a trivial bad param into a 500 error response rather than degrading to the 30-row default.
- **Confidence**: likely
- **Fix direction**: Validate with `Number.isFinite` before clamping, defaulting to 30 when not finite.

## Checked, no defect found
- `api/progress`, `api/push/vapid`: unauthenticated by design, expose only non-sensitive data.
- `api/inventory/sync` + `lib/inventory.ts`: writes only for `user.id` from the session (`route.ts:12-27`); no cross-user write path.
- `lib/push.ts`: prunes 404/410 dead endpoints; fan-out errors are collected, not thrown.
- JSON parsing: every client `res.json()` (`FeedList`, `PushToggle`, `SyncButton` `.catch(()=>null)`, `LiveStatus`) sits inside a try/catch, so an HTML error page does not crash the component.
- `public/sw.js` / `ServiceWorkerRegister.tsx`: the SW registers at scope "/" and installs no `fetch` handler / cache, so there is no stale-JS-after-deploy cache to serve.
- `LiveRefresher.tsx`, `stats/LiveStatus.tsx`: intervals/timeouts are cleared on unmount; `mountedRef` guards post-unmount setState.