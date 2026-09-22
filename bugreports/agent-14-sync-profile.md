# agent-14 — sync / profile data audit

Scope: `src/lib/syncs/potat.ts`, `src/lib/twitch/potat.ts`, `src/lib/twitch/perfil.ts`,
`src/lib/inventory.ts`, `src/lib/queries.ts`, `src/app/api/inventory/sync/route.ts`,
`src/app/api/cron/potat/route.ts`.

## pdat-1: Failed owners fetch nulls out every owner_count and still reports a healthy heartbeat
- **Severity**: critical
- **Side**: server
- **File**: src/lib/syncs/potat.ts:42-49 (and 115, 150-152, 174-181)
- **Evidence**:
  ```ts
  const [distribution, owners] = await Promise.all([
    fetchAllDistribution(),
    fetchAllOwners().catch(() => []),
  ]);
  ...
  const totalOwners = ownersByBadge.get(`${row.badge}:${row.version}`) ?? null;
  ```
- **Why it is a bug**: The `.catch(() => [])` turns any owners-endpoint outage (429 beyond
  `Retry-After`, 5xx, schema change) into an empty list. Every badge then gets
  `totalOwners = null`, `valuesChanged` is true (`null !== 5000`), so the upsert at line
  161 writes `owner_count: null` over correct data and appends a `badge_stats` row with
  nulls — destroying the owner counts the rarity index and `/badges?sort=owners` depend on.
  No changelog/alert marks it as a failure, and `runPotatSync` resolves normally so
  `cron/potat` records `status: "ok"`.
- **Confidence**: confirmed
- **Fix direction**: Let `fetchAllOwners` reject (remove the `.catch`), or skip the
  owner/percentage write path for badges whose key is absent from `ownersByBadge`
  (`if (!ownersByBadge.has(key)) continue;`) instead of coercing to `null`.

## pdat-2: An empty/malformed perfil response deletes the user's whole inventory
- **Severity**: high
- **Side**: server
- **File**: src/lib/inventory.ts:24, 43-50, 62-82 (normalize in src/lib/twitch/perfil.ts:33-55)
- **Evidence**:
  ```ts
  const perfil = await fetchUserBadges(username, 0);   // throws only on non-2xx
  ...
  const toRemove = [...currentIds].filter((id) => !ownedIds.has(id));
  if (toRemove.length > 0) { ... .delete().eq("user_id", userId).in("badge_id", toRemove) }
  ```
- **Why it is a bug**: `normalize()` defaults every field (`id: ""`, `badges: []`) and there
  is no post-condition on the parsed payload. A 200 response with an unexpected shape (an
  error envelope, `{data:[...]}` instead of a bare object, an upstream soft-failure) yields
  `badges: []`, so `ownedIds` is empty and `toRemove` is *every* row in `user_inventory` —
  the sync silently deletes the user's entire collection. `perfil.id`/`displayName` are then
  written to `profiles` as `""` as well.
- **Confidence**: confirmed
- **Fix direction**: Validate the parsed perfil (`perfil.id` non-empty and, for a known
  account, `badges.length > 0`) and abort/throw before the delete when the payload is
  implausibly empty.

## pdat-3: potat 429 retry returns the response without re-checking its status
- **Severity**: high
- **Side**: server
- **File**: src/lib/twitch/potat.ts:36-46 (used at 61, 89, 112)
- **Evidence**:
  ```ts
  if (res.status === 429) {
    ...
    return fetch(url, { headers: {...}, next: { revalidate: 0 } });
  }
  if (!res.ok) { throw new Error(...) }
  ```
- **Why it is a bug**: The recursive return bypasses the `!res.ok` guard, so a second 429 or
  a 5xx comes back as a "successful" `Response`. Callers do `await res.json()` unguarded
  (`fetchDistributionPage`, `fetchAllOwners`, `fetchOwnedLeaderboard`), which either throws a
  `SyntaxError` on the error body or returns an object with no `data`, and
  `all.push(...page.data)` then throws `TypeError: undefined is not iterable` — the whole
  global sync dies in the owners loop while distribution already succeeded. It also violates
  the documented "honor Retry-After once, then surface the failure" contract.
- **Confidence**: confirmed
- **Fix direction**: Assign the retried response to `res` and fall through to the existing
  `!res.ok` check (or loop with an attempt counter) instead of returning it directly.

## pdat-4: Badge-claim activity log is built from rows that never fetched title/slug
- **Severity**: medium
- **Side**: server
- **File**: src/lib/inventory.ts:26-29, 88-98
- **Evidence**:
  ```ts
  .from("badges").select("id,set_id,version")
  ...
  const catalogRows = (catalog ?? []) as unknown as Array<{ id: string; slug: string; title: string }>;
  title: `unlocked badge: ${badge.title}`, ... payload: { badge: badge.slug },
  ```
- **Why it is a bug**: The projection only selects `id,set_id,version`, but the code casts it
  to a `slug`/`title` shape. Every unlock therefore writes the public feed entry
  "unlocked badge: undefined" and `payload.badge = undefined`, so `/changelog`, notifications
  and any feed renderer show broken text and dead links.
- **Confidence**: confirmed
- **Fix direction**: Add `slug,title` to the `select(...)` (or look them up per claimed badge
  from `getCatalogKeys`).

## pdat-5: Profile sync overwrites good fields with empty values, errors are swallowed
- **Severity**: medium
- **Side**: server
- **File**: src/lib/inventory.ts:130-138, 146-156; src/app/api/inventory/sync/route.ts:26-28
- **Evidence**:
  ```ts
  await supabase.from("profiles").update({
    display_name: perfil.displayName, avatar_url: perfil.profileImageURL,
    twitch_id: perfil.id, twitch_created_at: perfil.createdAt ?? null,
  }).eq("id", userId);          // no error check
  ...
  .update({ potat_level: potat.level, potatoes: potat.potatoes, ... })  // nulls possible
  ```
- **Why it is a bug**: `normalize()` produces `""` for missing `displayName`/`profileImageURL`,
  so a partial perfil payload blanks the user's stored avatar/display name, and `potat.level`
  / `potat.potatoes` are written as `null` (wiping a previously good level) when the upstream
  omits them. Neither update checks `error`, and the route returns `{ok:true}` regardless —
  a half-updated profile is reported as success.
- **Confidence**: confirmed
- **Fix direction**: Only include a key in the update when the incoming value is non-empty,
  and surface `error` from both updates (route should return 502).

## pdat-6: Duplicate rows in one upsert batch abort the whole sync
- **Severity**: medium
- **Side**: server
- **File**: src/lib/syncs/potat.ts:108-171, 184-188
- **Evidence**:
  ```ts
  const badge = byKey.get(`${row.badge}:${row.version}`) ?? (row.url ? byUuid.get(...) : undefined);
  ...
  upsertRows.push({ ...badge, owner_count: totalOwners, ... });
  ...
  await supabase.from("badges").upsert(batch, { onConflict: "set_id,version" });
  ```
- **Why it is a bug**: Two distribution entries can resolve to the same catalog row (the
  `byUuid` fallback matches any version of the same image UUID, and the feed can repeat a
  badge). Both are pushed as separate objects with the same `set_id,version`, so Postgres
  rejects the batch with `21000 ON CONFLICT DO UPDATE command cannot affect row a second
  time`, which throws out of `runPotatSync` — after `distribution` succeeded, losing the
  entire sync.
- **Confidence**: likely
- **Fix direction**: Key the pending upserts by `set_id:version` in a `Map` (last write wins)
  before chunking, so each conflict key appears once per batch.

## pdat-7: Stats aggregations silently cap at the PostgREST 1000-row default
- **Severity**: medium
- **Side**: server
- **File**: src/lib/queries.ts:532-556
- **Evidence**:
  ```ts
  supabase.from("badges").select("rarity_tier").not("rarity_tier", "is", null),
  supabase.from("badges").select("category"),
  ```
- **Why it is a bug**: These unpaginated selects return only the first 1000 rows (PostgREST
  `max-rows`), so once the catalog exceeds 1000 badges the `/stats` rarity distribution and
  category counts undercount permanently, with no error. `getCatalogKeys()`
  (`queries.ts:472-483`) has the same shape with `limit(3000)`, which is above that default
  and therefore unreachable — its consumers see at most 1000 badges.
- **Confidence**: likely
- **Fix direction**: Aggregate in a `stats_*` view / RPC instead of pulling rows, or page
  with `.range()` until exhausted.

## pdat-8: Full-catalog load plus capped pagination and a 60s function limit
- **Severity**: medium
- **Side**: server
- **File**: src/lib/syncs/potat.ts:54-74; src/lib/twitch/potat.ts:64-97; src/app/api/cron/potat/route.ts:6
- **Evidence**:
  ```ts
  const badges = await supabase.from("badges").select("*").neq("status","removed")...
  for (let i = 0; i < 50; i += 1) { ... }   // hard stop, no truncation signal
  export const maxDuration = 60;
  ```
- **Why it is a bug**: Every badge full row is materialised in the function (unbounded memory
  as the catalog grows) while the two potat pagination loops stop at 50 pages (10k rows) with
  no error if there is more — the remainder silently gets `totalOwners = null`, which then
  feeds the null-overwrite problem from pdat-1. Combined with the `select("*")` round-trip
  and the bulk upsert, the 60s `maxDuration` is a realistic timeout cliff that only shows up
  as a generic `error` heartbeat.
- **Confidence**: likely
- **Fix direction**: Select only the columns the sync needs, and make the pagination loop
  raise when `hasNextPage` is still true at the iteration cap.

## Checked, no bug found
- SSRF/path traversal: `fetchPotatUser` (`potat.ts:182-184`) and `fetchUserBadges`
  (`perfil.ts:110-113`) both validate `^[a-z0-9_]{3,25}$` before building the URL;
  `fetchBadgeLiveStats` uses `encodeURIComponent` in a query value.
- Cross-user writes: every `user_inventory` insert/delete and `user_sync_state` upsert in
  `syncUserInventory` is scoped to the passed `userId`, and the route derives it from
  `supabase.auth.getUser()`.
- `getProfileByUsername` wildcard escaping (`queries.ts:353-371`) is correct.