# Fix proposal — sync-1 & sync-2

Source audit: `bugreports/agent-13-sync-catalog.md` (entries sync-1, sync-2).
Files examined: `src/lib/syncs/global.ts`, `src/lib/syncs/badgebase.ts`,
`src/lib/twitch/types.ts`, `src/lib/changelog.ts`, `src/lib/blog.ts`.

Both bugs are real. Neither is rejected. Details below.

Per AGENTS.md, each applied patch must also add a `logChange()` entry
(`bugfix`) — not shown in the diffs.

---

## sync-1 proposal

### Root cause
`global.ts:199-206` re-selects the "freshly inserted" rows with
`.in("set_id", incoming.map((v) => v.setId))` plus `.order("first_seen_at",
{ ascending: false }).limit(addedTitles.length + 10)`. The `set_id` filter
matches the *entire* live catalog (every incoming set id is present in the DB),
so the result is simply "the newest `N+10` rows in `badges`", not the rows this
run inserted. The inserted rows do sort newest (`first_seen_at = now`), so the
extra ten rows are the ten most recently added **pre-existing** badges. Those
ten are then fed to the fan-out at `global.ts:224-249`: a duplicate `added`
row is inserted into `badge_events` (plain insert, no dedupe) and
`createDropPost()` is called for each. `createDropPost` is idempotent by
`drop-<slug>` (`blog.ts:57`, `ignoreDuplicates: true`), so an *existing* drop
post is a no-op — but any pre-existing badge that never got one (a
badgebase-inserted row, or a badge seeded before the auto-post feature) gains
a bogus post. Hence: duplicate history events every non-seed run that adds a
badge, plus up to ten bogus auto blog posts.

### Exact change
Three edits in `src/lib/syncs/global.ts`.

**1. Track the slugs actually inserted.** At `global.ts:90`:

```diff
   const addedTitles: string[] = [];
+  const newSlugs: string[] = [];
   let updated = 0;
```

**2. Record the slug in the new-badge branch.** At `global.ts:105-124`:

```diff
       const slug = badgeSlug(v.setId, v.version);
       upserts.push({
         ...
         last_seen_at: now.toISOString(),
       });
+      newSlugs.push(slug);
       addedTitles.push(v.title?.trim() || v.setId);
       continue;
```

**3. Fetch exactly those rows instead of the newest N+10.** Replace
`global.ts:198-221` (current):

```ts
  if (addedTitles.length > 0) {
    const { data: fresh } = await supabase
      .from("badges")
      .select(
        "id,slug,title,set_id,image_url_2x,category,is_paid,how_to_earn,start_date,end_date,rarity_tier,rarity_score",
      )
      .in("set_id", incoming.map((v) => v.setId))
      .order("first_seen_at", { ascending: false })
      .limit(addedTitles.length + 10);

    const freshRows = (fresh ?? []) as Array<{
      id: string;
      slug: string;
      title: string;
      set_id: string;
      image_url_2x: string | null;
      category: string;
      is_paid: boolean;
      how_to_earn: string | null;
      start_date: string | null;
      end_date: string | null;
      rarity_tier: "common";
      rarity_score: number;
    }>;
```

with (replacement):

```ts
  type FreshRow = {
    id: string;
    slug: string;
    title: string;
    set_id: string;
    image_url_2x: string | null;
    category: string;
    is_paid: boolean;
    how_to_earn: string | null;
    start_date: string | null;
    end_date: string | null;
    rarity_tier: "common";
    rarity_score: number;
  };

  const freshRows: FreshRow[] = [];
  if (addedTitles.length > 0) {
    // Fetch exactly the rows this run inserted, by their deterministic slug
    // (badgeSlug(setId, version)). The previous `.in("set_id", …).limit(N+10)`
    // query returned the newest N+10 catalog rows and dragged up to ten
    // unrelated badges into the badge_events/blog fan-out below.
    for (const batch of chunk(newSlugs, 200)) {
      const { data } = await supabase
        .from("badges")
        .select(
          "id,slug,title,set_id,image_url_2x,category,is_paid,how_to_earn,start_date,end_date,rarity_tier,rarity_score",
        )
        .in("slug", batch);
      freshRows.push(...((data ?? []) as FreshRow[]));
    }
```

Everything after (`if (freshRows.length > 0) { … badge_events … blog … }`,
`global.ts:223-251`) is unchanged and now iterates only the real new rows.
`freshRows[0]` (used for the notification URL, `global.ts:271-272`) is still a
genuinely new badge; ordering is no longer guaranteed but any new badge is a
valid link target.

### Why it is safe
- The identifier used for the lookup is the same value written into the row's
  `slug` column two lines above (`badgeSlug(v.setId, v.version)`), so the query
  cannot miss an inserted row or pick a foreign one, assuming the existing
  `slug` uniqueness invariant (the `/badges/[slug]` route and
  `createDropPost`'s `onConflict: "slug"` already depend on it).
- Chunking at 200 keeps every PostgREST query small even on the initial seed;
  the `chunk()` helper already exists in this file (`global.ts:39-45`).
- No schema change, no change to the upsert path, counts (`addedTitles.length`)
  or the `isInitialSeed` gate. `badge_events` and the blog fan-out simply stop
  receiving unrelated rows.
- The removed/updated branches do not read `freshRows`.

### How to verify
1. Duplicate history events before/after (expect zero after a clean run):
   ```sql
   select badge_id, count(*) as c
   from badge_events
   where kind = 'added'
   group by badge_id
   having count(*) > 1
   order by c desc;
   ```
2. Bogus auto posts: cross-check posts created recently against badges first
   seen in the same window:
   ```sql
   select p.slug, p.created_at
   from blog_posts p
   where p.is_auto
     and p.slug like 'drop-%'
     and p.created_at > now() - interval '1 day';
   ```
   After the fix the number of new `drop-*` posts equals the number of badges
   whose `first_seen_at` falls in the same run.
3. End-to-end: `npm run sync:global` twice with an unchanged catalog → the
   second run reports `added: 0` and inserts no `badge_events`. Then force one
   known missing set and confirm exactly one `added` event and one `drop-*`
   post.

### Residual risk
- Relies on `badges.slug` being unique. If two `set_id:version` pairs ever
  collapse to the same slug, the slug lookup would return both rows. (The
  upsert is already keyed on `set_id,version`, so this would be a pre-existing
  data problem, not introduced here.)
- A run inserting more than 1000 badges is still bounded only by the 200-chunk
  loop — correct, just more round trips; the initial-seed path already skips
  blog/push.
- `badge_events` remains an append-only insert with no uniqueness constraint.
  Re-adding a badge after a genuine removal will (correctly) add a new event.
- The audit's sync-6 (unbounded `.in` of all incoming set ids) is fixed as a
  side effect for this query, since `newSlugs` is at most the new-row count.

---

## sync-2 proposal

### Root cause
badgebase inserts unknown cards with `set_id: card.slug` and `version: "1"`
(`badgebase.ts:180-205`), where `card.slug` is badgebase's own URL slug and is
**not** byte-equal to Twitch's `set_id` in the "not most" case (task example:
`wsci-2026-v1` vs `wsci-2026`). The global removal sweep keys presence on
`${set_id}:${version}` (`global.ts:88`, `global.ts:164-169`), so such a row's
key never appears in `incomingKeys` and the row is set `status:'removed'`
(daily, since badgebase/global run daily). badgebase then refuses to undo it:
the enrich path only patches status when `existing.status !== "removed"`
(`badgebase.ts:164`), and the demotion sweep skips removed rows outright
(`badgebase.ts:213-214`). Net effect: a currently-redeemable badge is
permanently `removed` and never repaired. Confirmed by code path — badgebase
*does* re-find the row (via image UUID or `bySetId.get(card.slug)`), so the
`!== "removed"` guard is the exact blocker.

### Exact change
Two files. 2A prevents the wrongful removal (the actual root cause); 2B/2C
repair rows already stuck as `removed`.

**2A — `src/lib/twitch/types.ts`: share the image-UUID extractor.** Add after
`badgeSlug` (`types.ts:93`):

```ts
const BADGE_UUID = /badges\/v1\/([0-9a-f-]{36})/i;

/**
 * Extract the badge image UUID from a static-cdn.jtvnw.net badge URL.
 * It is the only identity shared by the Twitch catalog and badgebase-inserted
 * rows, whose `set_id` is a badgebase slug rather than Twitch's set id.
 */
export function extractBadgeUuid(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = BADGE_UUID.exec(url);
  return match ? match[1] : null;
}
```

**2A — `src/lib/syncs/global.ts`: match by UUID when deciding removal.**
Add the import at `global.ts:3-9`:

```diff
 import {
   badgeSlug,
+  extractBadgeUuid,
   guessCategory,
   isStatusSetId,
   resolveStatus,
   type BadgeVersionSource,
 } from "@/lib/twitch/types";
```

Build an incoming-UUID set next to `incomingKeys` (`global.ts:87-88`):

```diff
   const now = new Date();
   const incomingKeys = new Set(incoming.map((v) => `${v.setId}:${v.version}`));
+  const incomingUuids = new Set<string>();
+  for (const v of incoming) {
+    const uuid = extractBadgeUuid(v.imageUrl1x) ?? extractBadgeUuid(v.imageUrl2x);
+    if (uuid) incomingUuids.add(uuid);
+  }
```

Replace the removal loop (`global.ts:164-169`), current:

```ts
  const removed: Array<{ id: string; title: string }> = [];
  for (const [key, ex] of existing) {
    if (!incomingKeys.has(key) && ex.status !== "removed") {
      removed.push({ id: ex.id, title: ex.title });
    }
  }
```

replacement:

```ts
  const removed: Array<{ id: string; title: string }> = [];
  for (const [key, ex] of existing) {
    if (incomingKeys.has(key) || ex.status === "removed") continue;
    // A badgebase-inserted row carries a badgebase slug as its set_id, so its
    // key is never in incomingKeys. Twitch still publishes the same artwork —
    // match on the image UUID (the cross-source identity) before concluding
    // the badge is gone.
    const uuid =
      extractBadgeUuid(ex.image_url_1x as string | null) ??
      extractBadgeUuid(ex.image_url_2x as string | null);
    if (uuid && incomingUuids.has(uuid)) continue;
    removed.push({ id: ex.id, title: ex.title });
  }
```

**2B — `src/lib/syncs/badgebase.ts`: let the authority un-remove.**
Replace the guard at `badgebase.ts:164-166`, current:

```ts
      if (status !== existing.status && existing.status !== "removed") {
        patch.status = status;
      }
```

replacement:

```ts
      if (existing.status === "removed") {
        // The /active listing is the authoritative activity source: a card
        // still listed here was never really gone — the global key-based
        // sweep removed it because its set_id is a badgebase slug.
        patch.status = status;
        patch.removed_at = null;
      } else if (status !== existing.status) {
        patch.status = status;
      }
```

**2C — `src/lib/syncs/badgebase.ts`: resurrect from the sweep too**, so rows
outside the 45-card detail cap are recovered. Replace the head of the sweep
loop (`badgebase.ts:212-220`), current:

```ts
  const sweepRows: Array<Record<string, unknown>> = [];
  for (const row of allBadges) {
    if (row.status === "removed") continue;
    const keyUuid = extractUuid(row.image_url_1x as string | null) ??
      extractUuid(row.image_url_2x as string | null);
    const onActiveList =
      activeKeys.has(row.set_id as string) ||
      (keyUuid ? activeKeys.has(keyUuid) : false);
    if (onActiveList) continue;
```

replacement:

```ts
  const sweepRows: Array<Record<string, unknown>> = [];
  for (const row of allBadges) {
    const keyUuid = extractUuid(row.image_url_1x as string | null) ??
      extractUuid(row.image_url_2x as string | null);
    const onActiveList =
      activeKeys.has(row.set_id as string) ||
      (keyUuid ? activeKeys.has(keyUuid) : false);

    if (row.status === "removed") {
      // Only resurrect what the /active listing vouches for; a genuinely gone
      // badge stays removed.
      if (!onActiveList) continue;
      sweepRows.push({
        ...row,
        is_confirmed_active: true,
        status: "active",
        removed_at: null,
      });
      continue;
    }
    if (onActiveList) continue;
```

(The remainder of the loop is unchanged.) Note `badgebase.ts`'s local
`extractUuid`/`BADGE_UUID` (lines 23-29) can later be replaced by the shared
`extractBadgeUuid` from 2A — optional cleanup, not required for the fix.

### Why it is safe
- UUID matching mirrors the identity badgebase already relies on in its enrich
  path (`byUuid`, `badgebase.ts:90-97, 117-119`), so 2A grants the global sweep
  exactly the same cross-source view badgebase uses. Nothing else changes:
  rows matched by key behave as before, and rows with no matching UUID are
  still removed.
- 2B only fires for rows already `removed`; the normal non-removed path is
  untouched. 2C only resurrects rows present on badgebase's `/active` listing —
  the same authority the whole module is built on. `removed_at` is cleared
  consistently with `global.ts:156`.
- 2A means a wrongly-removed row is no longer produced; 2B/2C are one-time
  data repair for rows already stuck. Resurrected rows are `active`, so the
  subsequent badgebase sweep leaves them alone.
- No schema or type changes beyond an added exported helper.

### How to verify
1. Reproduce pre-fix (sql): identify badgebase rows whose key is not in the
   Twitch catalog yet which are live on badgebase:
   ```sql
   select id, set_id, version, slug, status, removed_at
   from badges
   where source = 'badgebase'
   order by removed_at desc nulls last;
   ```
   Before the fix, run `npm run sync:global` and observe badgebase rows flipping
   to `status = 'removed'`; the global changelog gains a `badge_removed` entry.
2. After the fix, `select count(*) from badges where source='badgebase' and
   status='removed';` → `0`, and the global summary's `removed` count no longer
   includes badgebase titles (check the `data_sync` changelog payload).
3. End-to-end: `npm run sync:global` then `npm run sync:badgebase`; confirm a
   badgebase card currently on badgebase `/active` has `status='active'` and
   `removed_at is null` afterwards, and that the next global run does not flip
   it back.

### Residual risk
- A badgebase row whose image URLs contain no parsable UUID (both null) still
  cannot be matched by 2A and could be removed if its set_id also differs.
- Rows already `removed` and not covered by badgebase's `/active` listing stay
  `removed` (intended). 2C's coverage is limited to the active listing.
- Pre-existing, out of scope: badgebase only ever details the first 45 cards
  (`cards.slice(0, 45)`, `badgebase.ts:77`), so cards past position 45 are
  never enriched in any run. 2C deliberately does not depend on per-card
  detail for exactly this reason; wiring pagination is a separate fix.
- 2A slightly widens the set of rows exempt from global removal (any row whose
  artwork UUID is in the incoming catalog). This is the intended identity
  match, but if Twitch ever reuses a badge image UUID across two catalog
  rows, both are exempted.

---

## Verdict on the two bugs
- **sync-1 — real.** Confirmed by reading `global.ts:199-206` (`.in(set_id)`
  over the whole catalog + `limit(N+10)`) and the fan-out at `:224-249`.
  Duplicate `badge_events` are certain; bogus `drop-*` posts occur for
  pre-existing badges lacking a drop post (badgebase-inserted ones qualify).
- **sync-2 — real, conditional on a slug/set_id mismatch** (which is the
  reported case). The whole chain is visible in code: badgebase inserts
  `set_id: card.slug` (`badgebase.ts:180-205`), global removes by
  `${set_id}:${version}` (`global.ts:88,164-169`), badgebase refuses to repair
  `removed` (`badgebase.ts:164`, `:213-214`). No upstream condition can rescue
  the row.