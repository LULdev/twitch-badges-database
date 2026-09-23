# Fix proposal — profile, sync and client-reliability (CONFIRMED items)

Scope, from `VERIFIED.md`: items **9, 10, 24–30, 33, 48–51, 56, 57**. Nothing here
modifies a file or the database; this is the design for you to apply.

Rules honoured on every item below:

- **Database change = a new migration.** The ledger is at `0033`; applied files are
  never edited. Exactly one new file is proposed: `0034_profile_visit_dedup_and_showcase_bounds.sql`
  (items 24 and 28). It ends with `notify pgrst, 'reload schema'` and writes its own
  `changelog` row, like 0012 does.
- **A sweep change never makes a badge survive that should be expired.** Where a
  `source='custom'` exemption is added, it only leaves *admin-authored* rows alone;
  every Twitch- and badgebase-sourced row is swept exactly as before. The one place
  a listed badge survives (badgebase confirmation derived from the listing) is the
  listing's own authority claim — it is not a sweep weakening.
- Every app change needs a `npm run log:change` entry (kind `bugfix`), per AGENTS.md.
  Migrations carry theirs in-file.
- Verification ritual after all edits: `npm run lint && npm run typecheck && npm run build`.

Nothing in your adjudication looked wrong to me. Two items are larger than the report
implied (48 and 50), and one (50) subsumes the minimal patch for another (9); both
notes are called out below. No item is skipped.

---

## Order (severity)

1. **Item 10** — customizer wipes name/bio/banner/colour (HIGH, live, silent data loss)
2. **Item 9** — badgebase demotes `source='custom'` badges (HIGH, latent)
3. **Item 50** — badgebase guard / cap / forced status / loops / `inserted` (HIGH guard + MEDIUM rest)
4. **Item 49** — a global-sync failure skips the badgebase half (MEDIUM)
5. **Item 56** — panel save buttons have no in-flight guard (MEDIUM)
6. **Item 48** — `manual/*` pins `/stats` at "degraded" (MEDIUM)
7. **Item 33** — unpaged reads truncate at 1,000 rows (MEDIUM/LOW, latent)
8. **Item 51** — fan-out drops lookup/insert errors, pushes an empty slug (LOW–MEDIUM)
9. **Item 24** — showcase accepts unowned/unbounded slugs (LOW)
10. **Item 25** — inventory sync reverts the display name (LOW)
11. **Item 29** — `push/subscribe` ownership guard fails open (LOW)
12. **Item 30** — `sendPushToAll` reads subscriptions unpaged (LOW)
13. **Item 28** — visit/blog dedup race (LOW)
14. **Item 26** — `perfil.normalize()` trusts a non-array `badges` (LOW)
15. **Item 27** — GQL fallback drops the caller's cache window (LOW)
16. **Item 57** — Content panel shares error/notice across sub-tabs (LOW)

---

# 1. Item 10 — saving ProfileCustomizer wipes `display_name` / `bio` / `banner_url` and reverts `color`

**Severity: HIGH — treat first.** Live, silent, member-visible data loss.

## The design choice (and the recommendation)

Two forms on `/account` write the same four columns from two different seeds:

- `AccountSettings` seeds from the **columns**, and is the only place that *should*
  own them.
- `ProfileCustomizer` seeds from the **`customization` document** (`initial`), which
  is `{}` for anyone who never opened the customizer, so its `displayName` / `bio` /
  `bannerUrl` are `""` and its `color` is `DEFAULTS.color` (`#a970ff`). It ships all
  four on **every** save (`typeof body.X === "string"` is always true), so toggling
  one effect overwrites the columns with those defaults.

**Recommended: the customizer sends only the fields it owns.** AccountSettings keeps
exclusive ownership of `display_name` / `bio` / `banner_url` / `color`; the customizer
owns `customization`, `mood` and the steal settings.

The other phrasing — "the API should ignore a field it was not given" — is **already
true today**: `/api/account` writes a field only when `typeof body.X === "string"`,
so an omitted field is a no-op. The bug is entirely that the customizer *sends* fields
it does not own. Changing the API cannot fix it (the two forms share one route and the
server cannot tell them apart), so client-side omission is the lever. I also recommend
dropping the four inputs from the customizer's *UI*: otherwise editing them there would
silently do nothing, trading one lie for another.

### What the existing `customization` document already contains (members' data depends on this)

The document is the **whole `Customization` object** (`customization: values`), i.e. 35
keys — including copies of `displayName`, `bio`, `bannerUrl`, `color` (defaults `""`,
`""`, `""`, `"#a970ff"`).

Read path (verified): the profile page reads

- `displayName` **only** from `profiles.display_name`;
- `bio` **only** from `profiles.bio`;
- the banner **only** from `profiles.banner_url`;
- `color` from `profiles.color` **with a document fallback**:
  `const customColor = hex(profile?.color ?? text("color"), "#a970ff")`.

So the document copies of `displayName` / `bio` / `bannerUrl` are **dead on read**;
only `color` is a live legacy fallback. Consequences for the fix:

- **No migration is needed**, and no document needs rewriting. Historical documents keep
  their extra keys harmlessly.
- We must **not** stop writing `color` to the document (that would remove the fallback
  for a member who set a colour in the customizer before the column existed). Keeping the
  type fields but removing them from the payload/UI does exactly this: the document keeps
  echoing them, and the column stops being clobbered.

## Files

- `src/components/account/ProfileCustomizer.tsx` (COMMON_FIELDS `:77-99`; save payload `:145-155`)
- No API change.

## Current code

`ProfileCustomizer.tsx:77-99`:

```tsx
const COMMON_FIELDS: Field[] = [
  { key: "displayName", kind: "text", label: "displayName" },
  { key: "title", kind: "text", label: "title", placeholder: "Badge Hunter" },
  { key: "bio", kind: "text", label: "bio" },
  { key: "bannerUrl", kind: "text", label: "banner" },
  { key: "color", kind: "color", label: "color" },
  { key: "accent2", kind: "color", label: "accent2" },
  { key: "font", kind: "select", label: "font", options: [["sans", "Sans"], ["serif", "Serif"], ["mono", "Mono"], ["rounded", "Rounded"]] },
  ...
```

`ProfileCustomizer.tsx:145-155`:

```tsx
        body: JSON.stringify({
          displayName: values.displayName,
          bio: values.bio,
          bannerUrl: values.bannerUrl,
          color: values.color,
          mood,
          customization: values,
          stealEnabled: stealSettings.enabled,
          stealPrice: stealSettings.price,
          stealMax: stealSettings.max,
        }),
```

## Replacement

Replace the head of `COMMON_FIELDS` (keep the rest of the array unchanged):

```tsx
// The customizer owns ONLY the `customization` document, the mood and the steal
// settings. `displayName` / `bio` / `bannerUrl` / `color` are the *columns* that
// AccountSettings edits — the account page mounts both forms, and this one used
// to seed those four from the customization document (empty for a member who
// never opened it) and ship them on every save, so toggling one effect wiped the
// member's name, bio and banner and reverted a colour set in the sibling editor.
const COMMON_FIELDS: Field[] = [
  { key: "title", kind: "text", label: "title", placeholder: "Badge Hunter" },
  { key: "accent2", kind: "color", label: "accent2" },
  { key: "font", kind: "select", label: "font", options: [["sans", "Sans"], ["serif", "Serif"], ["mono", "Mono"], ["rounded", "Rounded"]] },
  ...
```

Replace the payload:

```tsx
        // Only the fields this editor owns. `displayName` / `bio` / `bannerUrl` /
        // `color` belong to AccountSettings (the columns); the route writes any
        // string field it is handed, and this form's copy of them lives in the
        // customization document, which is empty for anyone who never opened it.
        body: JSON.stringify({
          mood,
          customization: values,
          stealEnabled: stealSettings.enabled,
          stealPrice: stealSettings.price,
          stealMax: stealSettings.max,
        }),
```

Optionally document the legacy fields on the type (no functional change):

```tsx
interface Customization {
  // Legacy document fields. The columns of the same name are owned by
  // AccountSettings and are what the profile renders; `color` additionally
  // serves as the profile page's fallback when the column is null. Kept on the
  // type so an existing document round-trips; this editor no longer writes them.
  displayName: string;
  bio: string;
  bannerUrl: string;
  color: string;
  ...
```

## Why it is correct / what it must not break

- The route already treats an absent field as "leave it alone", so omission alone stops
  the overwrite; no server change and no shared-route ambiguity.
- `mood` / `customization` / steal settings are still sent, so `patch` is never empty
  (no 400 `"nothing to update"`).
- `showcase_slots` / `inventory_public` are owned by AccountSettings and untouched here.
- The document still round-trips (`customization: values`), so the profile page's
  `text("color")` fallback and any other document reader keep working.
- Do **not** remove the corresponding keys from `messages/*.json`: unused keys are
  harmless and all eleven files must stay key-identical.

## Risk if wrong

If a member believed the customizer's "Display name" field worked, it now visibly does
nothing there — they must use the AccountSettings card above (intended, single owner).
No data is destroyed by the change itself. The one behavioural loss is that a colour set
*only* in the document (column null) can no longer be edited from the customizer; the
AccountSettings colour control writes the same column and now wins, so the member is not
stuck.

## Verify

1. Apply the edit; `npm run dev`.
2. `/en/account`: set Display name, bio, banner URL and a non-default colour in the top
   card → Save.
3. Toggle any switch in the Creative card lower down → Save.
4. `select display_name, bio, banner_url, color from profiles where id = '<you>';` — all
   four unchanged from step 2.
5. Public profile heading still shows the chosen display name (not `@username`).

---

# 2. Item 9 — the badgebase sweep demotes admin-authored `source='custom'` badges

**Severity: HIGH, latent** (0 custom rows live today; reachable the first time an
operator creates a badge in `/admin → Badges`).

`global.ts` treats `source='custom'` as admin-owned and excludes it from the provider's
reach for the whole run (`:81-98`, and `:269` inside the sweep). `badgebase.ts` has no
such exemption: its sweep recomputes a status for **every** catalogue row
(`badgebase.ts:261-301`), so a panel-created active/dateless badge is demoted to
`expired` by the next daily run, and its enrich path can overwrite admin-authored dates.
`potat.ts:167-178` recomputes status the same way for rows its feed matches — same class,
narrower reach (addressed as a note at the end of this item).

## Files

- `src/lib/syncs/badgebase.ts` (sweep `:260-301`; enrich lookup `:159-161`)
- `src/lib/syncs/potat.ts` (optional, same class, `:136-178`)

## Current code

`badgebase.ts:260-301` (head of the sweep loop and the enrich lookup):

```ts
  for (const row of allBadges) {
    const keyUuid = extractUuid(row.image_url_1x as string | null) ??
      extractUuid(row.image_url_2x as string | null);
    const onActiveList =
      activeKeys.has(row.set_id as string) ||
      (keyUuid ? activeKeys.has(keyUuid) : false);

    if (row.status === "removed") {
```

`badgebase.ts:159-161`:

```ts
    const existing =
      (card.imageUuid ? byUuid.get(card.imageUuid) : undefined) ??
      bySetId.get(card.slug);
```

## Replacement

In the sweep loop, add the exemption as the first statement of the body (mirroring
`global.ts:269`):

```ts
  for (const row of allBadges) {
    // Admin-authored entries are owned by the dashboard, not by badgebase: the
    // panel writes them active/dateless, and this sweep would demote every one
    // of them within a day. `global.ts` has exempted them since the previous
    // round; the two later-added sweeps never learned to.
    if (row.source === "custom") continue;
    const keyUuid = extractUuid(row.image_url_1x as string | null) ??
      extractUuid(row.image_url_2x as string | null);
    const onActiveList =
      activeKeys.has(row.set_id as string) ||
      (keyUuid ? activeKeys.has(keyUuid) : false);

    if (row.status === "removed") {
```

And in the enrich lookup, skip a matched custom row so badgebase never rewrites
admin-authored dates/artwork:

```ts
    const existing =
      (card.imageUuid ? byUuid.get(card.imageUuid) : undefined) ??
      bySetId.get(card.slug);
    // Same rule as the sweep: a custom row is the dashboard's.
    if (existing?.source === "custom") continue;
```

Changes its surrounding control flow? No: `continue` moves to the next card. `enriched`
is not incremented for it — correct.

> Note: the item-50 rewrite below **already contains both guards**. If you apply the
> item-50 full replacement of `runBadgebaseSync`, skip this patch and use item 50's code.

## Same class in `potat.ts` (optional, recommended)

`potat.ts` recomputes status for every row its distribution feed matches
(`:167-178`) and full-row-upserts it. Add the same exemption at the top of the
per-row body:

```ts
  for (const row of distribution) {
    const badge =
      byKey.get(`${row.badge}:${row.version}`) ??
      (row.url ? byUuid.get(extractUuid(row.url) ?? "") : undefined);
    if (!badge) continue;
    // Admin-authored rows are not potat's to expire.
    if ((badge as { source?: string }).source === "custom") continue;
    matched += 1;
```

This also stops potat from refreshing owner counts on custom rows. That is consistent
with `global.ts` (which does not update custom rows at all); if you would rather keep the
owner-count refresh, move the guard to just wrap the `nextStatus` computation and leave
`owner_count`/rarity writes in place — but the simpler skip is the safer mirror.

## Why it is correct / what it must not break

- Only rows whose `source` is `"custom"` are skipped. Every `helix` / `ivr` / `badgebase`
  row is swept and confirmed exactly as before, so no legitimate badge survives that
  should expire.
- `source` is a NOT NULL column with a default (`global.ts` reads it as a plain string),
  so the comparison is safe for every row; for potat's loosely-typed row use the
  optional cast shown.
- The `onActiveList` resurrection branch is also skipped for custom rows — correct, since
  a custom row is not on the provider listings by construction.

## Risk if wrong

If a custom row *should* have been swept (an operator created a badge, then wanted the
pipeline to expire it), it now stays as authored until the operator changes it in the
panel — which is exactly how `global.ts` already behaves. If the potat guard is placed
wrong, owner counts on custom rows go stale (not harmful).

## Verify

1. In `/admin → Badges`, create a new badge with the defaults (status `active`, no dates).
2. `select source, status, is_confirmed_active from badges where set_id like 'custom-%';`
   → note the row is `custom`, `active`.
3. `npm run sync:badgebase` (and, for the potat guard, wait for / hit `/api/cron/potat`).
4. Re-run the same select → the row is still `active`, `is_confirmed_active` unchanged.
5. Confirm a control: a non-custom dateless badge is still demoted to `expired` by the
   same run (the changelog row "N badges demoted to expired" is non-zero if one exists).

---

# 3. Item 50 — badgebase: incident guard, detail cap, forced status, per-row loops, `inserted`

**Severity: HIGH for the guard (B2), MEDIUM for the rest.** Latent today
(23 active + 18 upcoming = 41 cards vs. the 45 cap).

Five sub-issues, all in `src/lib/syncs/badgebase.ts`, fixed together because they share
one rewrite of `runBadgebaseSync`:

- **B2 guard is all-or-nothing.** Only `activeCards.length === 0` is caught; a partial
  regex parse (1 of 23 cards) passes and the sweep expires everything it can no longer
  see. `global.ts:118-129` has a proportional guard for exactly this.
- **B3 the 45-card detail cap is the only confirmation source.** `is_confirmed_active`
  is set inside the `detailed` loop, so an `/active` card at index ≥ 45 is never
  confirmed (a dateless one stays `expired` though it is redeemable now), and a long
  `/active` list starves `/upcoming`.
- **B4 `confirmedActive ? "active"` short-circuits `resolveStatus`** (`:194-205`), so a
  confirmed card with a future start date flip-flops `active`↔`upcoming` against
  global/potat every run.
- **B6 per-row `update`/`upsert` loops + 45 fetches** risk the 60 s `maxDuration`
  (AGENTS.md explicitly warns against per-row PATCH loops); a kill there writes **no**
  heartbeat at all.
- **B11 `inserted` counts `ignoreDuplicates` no-ops.**

## Files

- `src/lib/syncs/badgebase.ts` — import line, then a full replacement of `runBadgebaseSync`.

## Current code

Import (`:1-12`):

```ts
import { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchBadgebaseListing,
  fetchBadgebaseDetail,
  type BadgebaseCard,
} from "@/lib/twitch/badgebase";
```

The whole function is `:67-344` (quoted piecemeal in the report; you have it in the tree).
Key lines:

```ts
  // Politeness: cap detail fetches per run, small concurrency pool.
  const capped = cards.slice(0, 45);
  const detailed = await mapLimit(capped, 4, (card) =>
    fetchBadgebaseDetail(`/b/${card.badgeId}-${card.slug}/`),
  );
```

```ts
  if (
    activeCards.length === 0 &&
    allBadges.some((row) => row.is_confirmed_active === true)
  ) { ... skipped: "empty-listing" }
```

```ts
      const status = confirmedActive
        ? "active"
        : resolveStatus({ ... }, now);
```

```ts
      if (Object.keys(patch).length > 0) {
        const { error } = await supabase.from("badges").update(patch).eq("id", existing.id);
        if (error) throw error;
        enriched += 1;
      }
```

```ts
    if (error) throw error;
    inserted += 1;
  }
```

## Replacement

Import line becomes:

```ts
import { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchBadgebaseListing,
  fetchBadgebaseDetail,
  type BadgebaseCard,
  type BadgebaseDetail,
} from "@/lib/twitch/badgebase";
```

Full replacement of `runBadgebaseSync` (keep the interface, `BADGE_UUID`, `extractUuid`
and `mapLimit` above it unchanged):

```ts
/**
 * Authoritative drop-status sync from badgebase.de's curated listings:
 *   /active   → currently redeemable (status 'active' + is_confirmed_active)
 *   /upcoming → announced, pre-release (status 'upcoming')
 * Every badge NOT on the active list and without a live claim window is
 * demoted to 'expired' — only genuinely redeemable badges stay "active".
 * End dates (countdown expiry) and how-to-earn steps come from the detail
 * pages.
 *
 * Confirmation is derived from the LISTING, not from the detail fetch: the
 * detail budget is a politeness cap, and a badge on /active is redeemable right
 * now whether or not we fetched its page.
 */
export async function runBadgebaseSync(): Promise<BadgebaseSyncSummary> {
  const supabase = createAdminClient();

  const [activeCards, upcomingCards] = await Promise.all([
    fetchBadgebaseListing("/active"),
    fetchBadgebaseListing("/upcoming/"),
  ]);
  const activeList = activeCards.filter((card) => !isStatusSetId(card.slug));
  const upcomingList = upcomingCards.filter((card) => !isStatusSetId(card.slug));

  // Load the catalog FIRST, paged: a single select silently stops at 1000 rows,
  // and a sweep built on a truncated view gains a blind spot past that.
  const allBadges: Array<Record<string, unknown>> = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("badges")
      .select("*")
      .order("id")
      .range(offset, offset + 999);
    if (error) throw error;
    const page = (data ?? []) as Array<Record<string, unknown>>;
    allBadges.push(...page);
    if (page.length < 1000) break;
  }

  // Keys confirmed active by the /active listing (uuid or set_id).
  const activeKeys = new Set<string>();
  for (const card of activeList) {
    if (card.imageUuid) activeKeys.add(card.imageUuid);
    activeKeys.add(card.slug);
  }
  const confirmedExists = allBadges.filter(
    (row) => row.is_confirmed_active === true,
  ).length;

  // Incident guard. An empty listing is the obvious incident; a PARTIAL parse
  // (the hand-rolled regex matching 1 of 23 cards) is the dangerous one — the
  // sweep below would expire everything it can no longer see. Compare what we
  // parsed against the confirmed-active rows we hold and skip rather than trust
  // a suspiciously short list.
  const suspicious =
    confirmedExists > 0 &&
    (activeList.length === 0 || activeList.length < confirmedExists * 0.5);
  if (suspicious) {
    const reason =
      activeList.length === 0 ? "empty-listing" : "active-listing-ratio";
    console.warn(
      `[badgebase] /active parsed ${activeList.length} cards against ${confirmedExists} confirmed-active badges — skipping this run (${reason})`,
    );
    // Recorded, not just returned: a silent skip looks identical to a healthy
    // run on the uptime view, which is exactly the failure this guard exists to
    // make visible.
    await logChange(
      {
        kind: "data_sync",
        title: "Drop-window sync skipped: the /active listing looks truncated",
        body: `Parsed ${activeList.length} active cards against ${confirmedExists} confirmed-active badges in the catalog. Nothing was written — sweeping on a truncated listing would have demoted every dateless badge.`,
        payload: { skipped: reason, parsed: activeList.length, confirmedExists },
      },
      supabase,
    );
    return {
      activeCards: activeList.length,
      upcomingCards: upcomingList.length,
      enriched: 0,
      inserted: 0,
      demotedToExpired: 0,
      errors: 0,
      skipped: reason,
    };
  }

  // Detail budget: 45 fetches total, with a floor reserved for /upcoming so a
  // long /active list cannot starve it (a card past the cap is still confirmed
  // from the listing above).
  const DETAIL_CAP = 45;
  const UPCOMING_FLOOR = 10;
  const upcomingBudget = Math.min(upcomingList.length, UPCOMING_FLOOR);
  const activeBudget = Math.max(0, DETAIL_CAP - upcomingBudget);
  const capped: BadgebaseCard[] = [
    ...activeList.slice(0, activeBudget),
    ...upcomingList.slice(0, upcomingBudget),
  ];
  const detailed = await mapLimit(capped, 4, (card) =>
    fetchBadgebaseDetail(`/b/${card.badgeId}-${card.slug}/`),
  );
  const detailFor = new Map<string, BadgebaseDetail | null>();
  let errors = 0;
  for (const { item: card, result: detail } of detailed) {
    if (!detail) errors += 1;
    detailFor.set(`${card.badgeId}-${card.slug}`, detail);
  }

  const byUuid = new Map<string, Record<string, unknown>>();
  const bySetId = new Map<string, Record<string, unknown>>();
  for (const row of allBadges) {
    const uuid =
      extractUuid(row.image_url_1x as string | null) ??
      extractUuid(row.image_url_2x as string | null);
    if (uuid) byUuid.set(uuid, row);
    if (!bySetId.has(row.set_id as string)) bySetId.set(row.set_id as string, row);
  }

  const now = new Date();
  let enriched = 0;
  let inserted = 0;
  let demotedToExpired = 0;

  // Every write is collected into one of two keyed maps and flushed in bulk:
  // PostgREST rejects a batch that touches the same (set_id, version) twice
  // (SQLSTATE 21000), and a per-row PATCH loop risked the 60 s route limit
  // (AGENTS.md: keep syncs on bulk upserts).
  const inserts = new Map<string, Record<string, unknown>>();
  const updates = new Map<string, Record<string, unknown>>();

  // Columns owned by the owner-statistics (potat) sync or by the database.
  // Writing them back from this run's snapshot would revert a potat write that
  // landed in between — the same rule global.ts applies.
  const NOT_BADGEBASE_OWNED = new Set([
    "id", "created_at", "updated_at",
    "owner_count", "active_count", "percentage", "last_polled_at",
    "rarity_score", "rarity_tier",
  ]);
  const strip = (row: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(row).filter(([key]) => !NOT_BADGEBASE_OWNED.has(key)),
    );

  // Pass 1 — every listed card. `/upcoming` first and `/active` last so that if
  // two cards resolve to the same catalog row, the /active confirmation wins.
  for (const card of [...upcomingList, ...activeList]) {
    const detail = detailFor.get(`${card.badgeId}-${card.slug}`) ?? null;
    const existing =
      (card.imageUuid ? byUuid.get(card.imageUuid) : undefined) ??
      bySetId.get(card.slug);
    // Admin-authored rows are the dashboard's, not the provider's.
    if (existing?.source === "custom") continue;

    const confirmedActive = card.status === "active";
    const cardStart = card.startTs
      ? new Date(card.startTs * 1000).toISOString()
      : null;

    if (existing) {
      const patch: Record<string, unknown> = {};
      let startDate = existing.start_date as string | null;
      let endDate = existing.end_date as string | null;
      if (detail) {
        startDate = detail.startDate ?? cardStart;
        endDate = detail.endDate;
        if (startDate !== existing.start_date) patch.start_date = startDate;
        if (endDate !== existing.end_date) patch.end_date = endDate;
        if (startDate !== existing.release_date) patch.release_date = startDate;
        const isPaid = card.tags.includes("paid")
          ? true
          : card.tags.includes("free")
            ? false
            : null;
        if (isPaid !== null && isPaid !== existing.is_paid) patch.is_paid = isPaid;
        if (detail.howToEarn && detail.howToEarn !== existing.how_to_earn)
          patch.how_to_earn = detail.howToEarn;
      }
      if ((existing.is_confirmed_active as boolean | null) !== confirmedActive) {
        patch.is_confirmed_active = confirmedActive;
      }
      // resolveStatus is the single source of truth for status (a future start
      // still counts as "upcoming" even when confirmed). Forcing "active" here
      // made badgebase and global/potat rewrite each other on every run.
      const status = resolveStatus(
        {
          start_date: startDate,
          end_date: endDate,
          is_confirmed_active: confirmedActive,
        },
        now,
      );
      if (existing.status === "removed") {
        // A card still listed here was never really gone: the global key-based
        // sweep removed it because its set_id is a badgebase slug.
        patch.status = status;
        patch.removed_at = null;
      } else if (status !== existing.status) {
        patch.status = status;
      }
      if (Object.keys(patch).length > 0) {
        updates.set(
          `${existing.set_id as string}:${existing.version as string}`,
          strip({ ...existing, ...patch }),
        );
        enriched += 1;
      }
      continue;
    }

    // Unknown to the catalog: only insertable when a detail page supplied the
    // description and dates. A card beyond the cap that is unknown cannot be
    // invented, but it *is* already confirmed as active by the listing check.
    if (!detail) continue;
    inserts.set(`${card.slug}:1`, {
      set_id: card.slug,
      version: "1",
      slug: `${card.slug}-v1`,
      title: card.title ?? card.slug,
      description: detail.description,
      image_url_1x: card.imageUrl,
      image_url_2x: card.imageUrl,
      image_url_4x: card.imageUrl,
      category: guessCategory(card.slug),
      is_paid: card.tags.includes("paid"),
      how_to_earn: detail.howToEarn,
      start_date: detail.startDate ?? cardStart,
      end_date: detail.endDate,
      release_date: detail.startDate ?? cardStart,
      status: resolveStatus(
        {
          start_date: detail.startDate ?? cardStart,
          end_date: detail.endDate,
          is_confirmed_active: confirmedActive,
        },
        now,
      ),
      is_confirmed_active: confirmedActive,
      source: "badgebase",
      first_seen_at: now.toISOString(),
      last_seen_at: now.toISOString(),
    });
  }

  // Pass 2 — sweep every catalog row not confirmed by the listing and without a
  // live window. Custom rows are out of the provider's reach.
  for (const row of allBadges) {
    if (row.source === "custom") continue;
    const key = `${row.set_id as string}:${row.version as string}`;
    const keyUuid =
      extractUuid(row.image_url_1x as string | null) ??
      extractUuid(row.image_url_2x as string | null);
    const onActiveList =
      activeKeys.has(row.set_id as string) ||
      (keyUuid ? activeKeys.has(keyUuid) : false);

    if (row.status === "removed") {
      // Only resurrect what the /active listing vouches for; a genuinely gone
      // badge stays removed. This also recovers rows outside the detail cap.
      if (!onActiveList) continue;
      if (!updates.has(key)) {
        updates.set(key, strip({
          ...row,
          is_confirmed_active: true,
          status: "active",
          removed_at: null,
        }));
      }
      continue;
    }
    if (onActiveList) continue;

    // Merge onto whatever pass 1 already decided for this row, so the status is
    // computed from the values the row will actually carry.
    const base = updates.get(key) ?? row;
    const nextStatus = resolveStatus(
      {
        start_date: base.start_date as string | null,
        end_date: base.end_date as string | null,
        is_confirmed_active: false,
      },
      now,
    );
    if (base.status !== nextStatus || (base.is_confirmed_active as boolean)) {
      updates.set(key, strip({ ...base, is_confirmed_active: false, status: nextStatus }));
      if (nextStatus === "expired" && row.status !== "expired") demotedToExpired += 1;
    }
  }

  // Inserts first, counted from what the database actually inserted: a conflict
  // discarded by ignoreDuplicates must not inflate the number (the old code
  // incremented per loop turn).
  const insertRows = [...inserts.values()];
  for (let i = 0; i < insertRows.length; i += 200) {
    const { data, error } = await supabase
      .from("badges")
      .upsert(insertRows.slice(i, i + 200), {
        onConflict: "set_id,version",
        ignoreDuplicates: true,
      })
      .select("id");
    if (error) throw error;
    inserted += (data ?? []).length;
  }

  const updateRows = [...updates.values()];
  for (let i = 0; i < updateRows.length; i += 200) {
    const { error } = await supabase
      .from("badges")
      .upsert(updateRows.slice(i, i + 200), { onConflict: "set_id,version" });
    if (error) throw error;
  }

  await logChange(
    {
      kind: "data_sync",
      title: "Drop-window listing sync completed",
      body: `${activeList.length} active + ${upcomingList.length} upcoming cards processed, ${enriched} badges enriched, ${inserted} new badges inserted, ${demotedToExpired} badges demoted to expired, ${errors} detail fetch errors.`,
      payload: {
        activeCards: activeList.length,
        upcomingCards: upcomingList.length,
        enriched,
        inserted,
        demotedToExpired,
        errors,
        ranAt: now.toISOString(),
      },
    },
    supabase,
  );

  // A resolved summary is recorded as a healthy heartbeat, so a total detail
  // outage — every card's fetch failed, no badge got a real claim window —
  // would show green. Surface it as a failure instead.
  if (capped.length > 0 && errors === capped.length) {
    throw new Error(
      `badgebase: all ${errors} detail fetches failed — treating the run as failed`,
    );
  }

  return {
    activeCards: activeList.length,
    upcomingCards: upcomingList.length,
    enriched,
    inserted,
    demotedToExpired,
    errors,
  };
}
```

Cleanup: nothing further — `errors` is counted once, in the loop above.

## Why it is correct / what it must not break

- **Guard (B2):** `confirmedExists > 0 && (parsed === 0 || parsed < confirmedExists * 0.5)`
  is `global.ts`'s proportional rule, keyed on the confirmed set the catalog holds. It
  fires only when we currently *have* something to protect; it writes nothing and records
  its own changelog + `skipped` result, so the cron reports `degraded`. Existing rows
  keep their flags.
- **Cap (B3):** confirmation and status come from the listing for **every** listed card
  (pass 1 iterates all of `activeList ∪ upcomingList`, not just `capped`); the detail
  budget now only affects dates/how-to-earn/description. The reserved upcoming floor
  stops `/active` from starving `/upcoming`. A card beyond the cap that is unknown to the
  catalog still cannot be inserted — correct, we have no title/description for it.
- **Status (B4):** `resolveStatus` is used everywhere, so a future-dated confirmed card is
  `upcoming` consistently across badgebase, global and potat. No more 15-minute flip-flop.
- **Loops (B6):** the per-card `update().eq("id")` and per-card `upsert` become two bulk
  upserts per 200 rows. `NOT_BADGEBASE_OWNED` strips the columns potat/db own, matching
  `global.ts`; both update paths produce homogeneous key sets (all derived from a full
  `select("*")` row), which PostgREST requires.
- **`inserted` (B11):** counted from `.select("id")` on the `ignoreDuplicates` upsert.
- **"Must not expire a legitimate badge":** the sweep's condition is unchanged for
  non-custom rows; the only rows that survive are those the `/active` listing vouches for
  — the documented authority. `resolveStatus` still returns `expired` for dateless
  unconfirmed rows.
- `mapLimit`, `BADGE_UUID`, `extractUuid` untouched. `errors` still feeds the
  all-details-failed throw.

## Risk if wrong

This is the highest-risk edit here. Failure modes to check: (a) the bulk upsert's
homogeneous-key requirement — both maps are built from full rows so this holds, but a
future partial patch would break it; (b) mis-placing the upcoming/active order would let
an `/upcoming` card un-confirm an `/active` one (hence `[...upcomingList, ...activeList]`);
(c) the guard's `0.5` threshold could skip a legitimate deep cut (acceptable — skipping is
non-destructive and self-heals next tick); (d) the heartbeat-kill class is *mitigated*,
not removed: the work is now ~2 statements instead of ≤90 round trips, but a slow
provider can still exceed 60 s (raise concurrency or lower `DETAIL_CAP` if that recurs —
do not add a sub-daily Vercel schedule, Hobby rejects it).

## Verify

1. `npm run lint && npm run typecheck`.
2. Dry-ish check: run `npm run sync:badgebase` against a non-production DB (or
   `scripts/sync-badgebase.ts`) and watch the summary: `enriched` ≈ listed rows whose
   snapshot differs, `inserted` 0 on a settled catalog, `demotedToExpired` 0 on a healthy
   one.
3. `select count(*) from badges where is_confirmed_active;` → should equal the `/active`
   card count (23) and, critically, **not** be reduced by rows outside the cap.
4. Force the guard: temporarily serve `BADGEBASE_BASE_URL` pointing at a host returning a
   single card, run the sync, and confirm `skipped: "active-listing-ratio"` plus no status
   change:
   `select count(*) from badges where is_confirmed_active;` unchanged.
5. Confirm the heartbeat row is `degraded` with the skip message on a skip, and the
   changelog carries "skipped: the /active listing looks truncated".
6. `select count(*) from badges where status='expired' and start_date is null and end_date is null and is_confirmed_active;`
   → 0 (no confirmed dateless row left expired).

---

# 4. Item 49 — a global-sync failure skips the whole badgebase half for the day

**Severity: MEDIUM.**

`cron/global/route.ts:20-38` returns 500 **before** the badgebase enrichment at `:43-69`.
`runGlobalSync` throws on any provider incident (its own ratio guard throws by design) or
any Supabase error, so one bad IVR/Helix morning freezes `is_confirmed_active`, countdown
end dates and how-to-earn for the whole day even though badgebase is reachable.

## File

- `src/app/api/cron/global/route.ts` (whole `GET`).

## Current code

```ts
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const started = Date.now();

  let summary: unknown;
  try {
    summary = await withHeartbeat("sync/global", () => runGlobalSync());
  } catch (error) {
    console.error("[cron/global]", error);
    await pruneHeartbeats(90).catch(() => 0);
    await recordHeartbeat({
      source: "cron/global",
      status: "error",
      durationMs: Date.now() - started,
      message: error instanceof Error ? error.message : "failed",
    });
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "failed" },
      { status: 500 },
    );
  }
  ... // badgebase below
```

## Replacement (full file body)

```ts
import { isAuthorizedCron } from "@/lib/cron-auth";
import { runGlobalSync } from "@/lib/syncs/global";
import { runBadgebaseSync } from "@/lib/syncs/badgebase";
import { pruneHeartbeats, recordHeartbeat, withHeartbeat } from "@/lib/health";
import { prunedCoinRainGate } from "@/lib/gamification/daily";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const started = Date.now();

  // Hobby plans allow only 2 daily crons, so this handler runs the catalog diff
  // AND the badgebase drop-window enrichment together. Both halves run even when
  // the other fails: a provider incident on the Twitch feed used to return 500
  // before the badgebase enrichment, freezing the authoritative activity state
  // for the whole day as collateral damage.
  let summary: unknown = null;
  let globalFailed = false;
  let globalError: string | null = null;
  try {
    summary = await withHeartbeat("sync/global", () => runGlobalSync());
  } catch (error) {
    console.error("[cron/global]", error);
    globalFailed = true;
    globalError = error instanceof Error ? error.message : "failed";
  }

  let badgebase: unknown = null;
  let badgebaseFailed = false;
  let badgebaseSkipped = false;
  let badgebaseError: string | null = null;
  try {
    // The summary is passed through to the heartbeat: a run that deliberately
    // did nothing is not a success, and without this the payload carried no
    // trace of it.
    badgebase = await withHeartbeat(
      "sync/badgebase",
      () => runBadgebaseSync(),
      (result) => result as unknown as Record<string, unknown>,
      (result) =>
        typeof (result as { skipped?: string }).skipped === "string"
          ? {
              status: "degraded",
              message: "drop-window enrichment skipped",
            }
          : { status: "ok" },
    );
    badgebaseSkipped =
      typeof (badgebase as { skipped?: string }).skipped === "string";
  } catch (error) {
    console.error("[cron/badgebase]", error);
    badgebaseFailed = true;
    badgebaseError = error instanceof Error ? error.message : "failed";
  }

  // Daily housekeeping: keep the heartbeat table bounded. The coin-rain gate
  // only ever consults today's rows, so anything older is dead weight. Retention
  // must not be coupled to the least reliable step, so it runs unconditionally.
  const pruned = await pruneHeartbeats(90).catch(() => 0);
  const prunedRainGate = await prunedCoinRainGate().catch(() => 0);

  const durationMs = Date.now() - started;
  await recordHeartbeat({
    source: "cron/global",
    status: globalFailed || badgebaseFailed || badgebaseSkipped ? "degraded" : "ok",
    durationMs,
    message: globalFailed
      ? (globalError ?? "catalog sync failed")
      : badgebaseFailed
        ? (badgebaseError ?? "drop-window enrichment failed")
        : badgebaseSkipped
          ? "drop-window enrichment skipped"
          : null,
    payload: {
      prunedHeartbeats: pruned,
      prunedRainGate,
      globalFailed,
      badgebaseFailed,
      badgebaseSkipped,
    },
  });

  // 207 signals a partial success: exactly one half failed (or the enrichment
  // deliberately did nothing). 500 is reserved for both halves failing.
  const status = globalFailed && badgebaseFailed ? 500 : globalFailed || badgebaseFailed ? 207 : 200;
  return Response.json(
    {
      ok: !globalFailed && !badgebaseFailed,
      summary,
      globalFailed,
      globalError,
      badgebase,
      badgebaseFailed,
      badgebaseSkipped,
      durationMs,
      pruned,
      prunedRainGate,
    },
    { status },
  );
}
```

## Why it is correct / what it must not break

- The `withHeartbeat` wrappers still record one row per engine (`sync/global`,
  `sync/badgebase`) exactly as before; the outer `cron/global` row keeps its `degraded`/
  `ok` logic and now also carries `globalFailed`.
- The prune and `prunedCoinRainGate` still run once, unconditionally (cron-3's fix is
  preserved and now applies on the global-failure path too — previously the failure path
  pruned but skipped the coin-rain gate).
- The `badgebaseSkipped` message text was genericised because the skip reason is now
  either `"empty-listing"` or `"active-listing-ratio"` (item 50). The `withHeartbeat`
  `statusOf` still returns `degraded` for any `skipped` string.
- Nothing else calls this route's JSON shape except the dashboard/operator; `summary`
  is now `null` instead of absent on the failure path.

## Risk if wrong

The HTTP status for a global-only failure changes from `500` to `207`. The only consumer
that inspects a cron status code is `.github/workflows/potat-sync.yml`, which hits
`/api/cron/potat`, not this route; Vercel cron ignores it. If you want the old alarm,
make the status `globalFailed ? 500 : badgebaseFailed ? 207 : 200` and keep the JSON
flags — the badgebase half still runs either way.

## Verify

1. `npm run lint && npm run typecheck`.
2. Force a global failure without a provider: temporarily set
   `TWITCH_HELIX_URL`/`IVR` to a failing host, `curl -s -o /dev/null -w "%{http_code}" -H "authorization: Bearer $CRON_SECRET" https://<host>/api/cron/global`
   → `207`, and in the log the badgebase half still ran.
3. `select source, status, created_at from system_heartbeats order by created_at desc limit 4;`
   → a `sync/badgebase` row exists even though `sync/global` is `error`.
4. `select count(*) from badges where is_confirmed_active;` unchanged by the failed run.

---

# 5. Item 56 — admin panel save/create buttons have no in-flight guard

**Severity: MEDIUM.**

`ContentPanel` (blog save), `BadgesPanel` (badge save), `BrainstormPanel` (idea save) and
all four `SettingsPanel` save buttons re-POST on a double click. For a **new** entry the
payload is `id: undefined` both times → two creates with the same derived slug; the
second hits the UNIQUE key while the first reported "saved", leaving a contradicting error
banner. The panels that do guard (`SyncPanel`, `AdminGate`, `StatusPanel`,
`NewsletterPanel`) show the pattern — it was simply not applied here.

Pattern to match (from `SyncPanel.tsx`): a boolean state + `disabled={busy}`.

## File 1 — `src/components/admin/ContentPanel.tsx` (`BlogAdmin`)

Nothing to add in `ContentPanel` itself for this item (that is item 57).

`BlogAdmin` — add state next to `loading` (`:96`):

```tsx
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
```

Replace the Save button (`:240-269`):

```tsx
            <button
              type="button"
              className="btn btn-primary px-3 py-1.5 text-xs"
              disabled={busy}
              onClick={async () => {
                if (busy) return;
                setBusy(true);
                try {
                  const { ok, error } = await call({
                    resource: "blog",
                    action: "save",
                    id: editing.id || undefined,
                    input: {
                      slug: editing.slug,
                      title: editing.title,
                      excerpt: editing.excerpt,
                      content: editing.content,
                      coverUrl: editing.cover_url,
                      author: editing.author,
                      status: editing.status,
                      locale: editing.locale,
                      tags: editing.tags,
                    },
                  });
                  if (ok) {
                    setNotice(t("saved"));
                    setEditing(null);
                    await load();
                  } else setError(error ?? t("saveFailed"));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t("save")}
            </button>
```

Replace the Delete button (`:273-289`) the same way:

```tsx
            {editing.id ? (
              <button
                type="button"
                className="btn px-3 py-1.5 text-xs text-danger"
                disabled={busy}
                onClick={async () => {
                  if (busy) return;
                  if (!window.confirm(t("confirmDelete"))) return;
                  setBusy(true);
                  try {
                    const { ok, error } = await call({
                      resource: "blog",
                      action: "delete",
                      id: editing.id,
                    });
                    if (ok) {
                      setNotice(t("deleted"));
                      setEditing(null);
                      await load();
                    } else setError(error ?? t("saveFailed"));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t("delete")}
              </button>
            ) : null}
```

## File 2 — `src/components/admin/ContentPanel.tsx` (`ChangelogAdmin`)

Add state at the top of `ChangelogAdmin` (next to `entries`/`draft`):

```tsx
  const [busy, setBusy] = useState(false);
```

Replace the Save button (`:407-434`). Note the JSON parse has an early `return`, so the
`finally` is what releases `busy`:

```tsx
            <button
              type="button"
              className="btn btn-primary px-3 py-1.5 text-xs"
              disabled={busy}
              onClick={async () => {
                if (busy) return;
                let payload: unknown = null;
                if (draft.payload.trim()) {
                  try {
                    payload = JSON.parse(draft.payload);
                  } catch {
                    setError(t("badJson"));
                    return;
                  }
                }
                setBusy(true);
                try {
                  const { ok, error } = await call({
                    resource: "changelog",
                    action: "save",
                    id: draft.id,
                    input: { kind: draft.kind, title: draft.title, body: draft.body, payload },
                  });
                  if (ok) {
                    setNotice(t("saved"));
                    setDraft(null);
                    await load();
                  } else setError(error ?? t("saveFailed"));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t("save")}
            </button>
```

Replace the Delete button (`:438-454`) with the same `disabled={busy}` + `try/finally`
shape as the BlogAdmin delete above (`resource: "changelog"`).

(`ChangelogAdmin` has no `Post` import issue: it already imports `useState`. Both
components share `ContentPanel`'s imports.)

## File 3 — `src/components/admin/BadgesPanel.tsx`

Add `const [busy, setBusy] = useState(false);` next to `notice` (`:66`).

Save button (`:240-273`) — same shape, `call({ resource: "badges", action: "save", … })`,
failure variable is `failure`:

```tsx
            <button
              type="button"
              className="btn btn-primary px-3 py-1.5 text-xs"
              disabled={busy}
              onClick={async () => {
                if (busy) return;
                setBusy(true);
                try {
                  const { ok, error: failure } = await call({
                    resource: "badges",
                    action: "save",
                    id: editing.id || undefined,
                    input: {
                      setId: editing.set_id,
                      version: editing.version,
                      title: editing.title,
                      description: editing.description,
                      howToEarn: editing.how_to_earn,
                      category: editing.category,
                      imageUrl1x: editing.image_url_1x,
                      imageUrl2x: editing.image_url_2x,
                      imageUrl4x: editing.image_url_4x,
                      clickUrl: editing.click_url,
                      isPaid: editing.is_paid,
                      startDate: editing.start_date,
                      endDate: editing.end_date,
                      status: editing.status,
                    },
                  });
                  if (ok) {
                    setNotice(t("saved"));
                    setEditing(null);
                    await load();
                  } else setError(failure ?? t("saveFailed"));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t("save")}
            </button>
```

Delete button (`:277-293`) — `disabled={busy}` + `try/finally`, action `delete`.

> Bonus, in scope of item 9: this panel's "new badge" form defaults to
> `status: "active"` with null dates, which is exactly the row item 9 protects. With
> item 9 applied it now survives the sweeps.

## File 4 — `src/components/admin/BrainstormPanel.tsx`

Add `const [busy, setBusy] = useState(false);` next to `notice` (`:33`) and guard the
single `post()` helper (`:53-69`) — it serves both Save and Delete, so this covers both
buttons:

```tsx
  async function post(payload: Record<string, unknown>, successKey?: string) {
    if (busy) return false;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/ideas", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? t("failed"));
        return false;
      }
      if (successKey) setNotice(t(successKey));
      await load();
      return true;
    } finally {
      setBusy(false);
    }
  }
```

Add `disabled={busy}` to the Save button (`:190-198`) and the Delete button (`:142-150`).

## File 5 — `src/components/admin/SettingsPanel.tsx`

Add `const [busy, setBusy] = useState(false);` next to `grantRole` (`:55`).

Guard the two helpers, keeping their `useCallback` deps in step:

```tsx
  const save = useCallback(
    async (section: string, value: unknown) => {
      if (busy) return false;
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const res = await fetch("/api/admin/settings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ section, value }),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setError(body.error ?? t("saveFailed"));
          return false;
        }
        setNotice(t("saved"));
        return true;
      } finally {
        setBusy(false);
      }
    },
    [busy, setError, setNotice, t],
  );

  const act = useCallback(
    async (payload: Record<string, unknown>) => {
      if (busy) return false;
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const res = await fetch("/api/admin/settings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setError(body.error ?? t("saveFailed"));
          return false;
        }
        setNotice(t("saved"));
        await load();
        return true;
      } finally {
        setBusy(false);
      }
    },
    [busy, load, setError, setNotice, t],
  );
```

Add `disabled={busy}` to the four save buttons (`:140`, `:165`, `:253`) and the admins
Add (`:279-289`) and Remove (`:298-304`) buttons.

## Why it is correct / what it must not break

- A disabled button cannot dispatch a second click; the `if (busy) return` guard covers
  the (unlikely) same-tick double dispatch from a keyboard/interaction quirk.
- `try/finally` guarantees `busy` is released on the error paths (including the JSON
  parse early return in ChangelogAdmin).
- Disabling while the post-save reload runs is intentional: it prevents editing/re-saving
  against a half-reloaded list.
- No server change: the routes already reject the duplicate — we simply stop sending it.

## Risk if wrong

Minimal. Worst case a legitimately slow request keeps the button disabled slightly
longer. Do not reuse an existing state like `loading` for this: `loading` also covers list
fetches, and disabling Save during a background reload is a worse UX than the extra state.

## Verify

1. `npm run lint && npm run typecheck`.
2. `/admin` → New entry (blog/badge/idea), fill the title, double-click Save fast:
   the Network tab shows **one** POST and the list shows one new row.
3. `select count(*) from blog_posts where slug = '<slug>';` → 1.
4. Settings: double-click a Save → one POST, one "saved" banner, no error banner.

---

# 6. Item 48 — one failed `manual/*` sync pins the public `/stats` gauge to "degraded"

**Severity: MEDIUM, latent** (no `manual/*` rows live).

`stats.ts:240-252` counts **every** source's newest row. `manual/global|badgebase|potat`
are written only when an operator presses "sync now" in `/api/admin/sync`, and nothing
ever supersedes them — so one failed manual run leaves
`manual/*.last_status = 'error'` forever and `serviceStatus` returns `degraded` on the
headline gauge while the scheduled pipeline is healthy.

## File

- `src/lib/stats.ts` (`serviceStatus`, `:240-253`).

## Current code

```ts
function serviceStatus(sources: UptimeSource[]): ServiceStatus {
  if (sources.length === 0) return "degraded";
  const latest = sources
    .map((source) => source.last_at ?? "")
    .sort()
    .at(-1);
  if (!latest) return "degraded";
  const ageMinutes = (Date.now() - new Date(latest).getTime()) / 60_000;
  const errored = sources.filter((source) => source.last_status === "error");
  // No heartbeat in 36h means the pipeline is not running at all.
  if (ageMinutes > 60 * 36) return "down";
  if (errored.length > 0 || ageMinutes > 120) return "degraded";
  return "operational";
}
```

## Replacement

```ts
function serviceStatus(sources: UptimeSource[]): ServiceStatus {
  // Operator-initiated one-offs (`manual/*`) are written only when someone
  // presses "sync now" in the dashboard, and no recurring job ever supersedes
  // their row — so a single failed manual run would pin the public gauge at
  // "degraded" forever. The gauge describes the *scheduled* pipeline: `sync/*`
  // and `cron/*` (plus `web`).
  const recurring = sources.filter(
    (source) => !source.source.startsWith("manual/"),
  );
  if (recurring.length === 0) return "degraded";
  const latest = recurring
    .map((source) => source.last_at ?? "")
    .sort()
    .at(-1);
  if (!latest) return "degraded";
  const ageMinutes = (Date.now() - new Date(latest).getTime()) / 60_000;
  const errored = recurring.filter((source) => source.last_status === "error");
  // No heartbeat in 36h means the pipeline is not running at all.
  if (ageMinutes > 60 * 36) return "down";
  if (errored.length > 0 || ageMinutes > 120) return "degraded";
  return "operational";
}
```

## Why it is correct / what it must not break

- `manual/*` rows remain in `sources`, so they are still listed in the uptime table and
  still contribute to `availability`/`lastHeartbeat` for the operator view. Only the
  headline `status` ignores them.
- The age is computed from recurring sources only, so a manual row cannot keep a dead
  pipeline looking fresh either.
- `UptimeSource.source` exists (`stats.ts:162`), so the filter type-checks.
- The `errored` filter still catches a genuinely failing scheduled source.

## Risk if wrong

If the only rows a fresh installation ever has are `manual/*`, the gauge is `degraded`
until the first scheduled run — correct, there is nothing scheduled to be healthy about
yet. If someone expects the manual button to affect the public gauge, that expectation is
the bug being removed.

## Verify

1. `npm run lint && npm run typecheck`.
2. Force a manual failure (press "sync now" against an unreachable provider), then check:
   `select source, last_status from stats_uptime_sources;` → `manual/*` is `error`, and
   `/stats` still reads **operational**.
3. Trip a real scheduled source (`select ... where source='cron/global'`) → the gauge
   goes `degraded`, proving the filter is not blanket-silencing errors.

---

# 7. Item 33 — unpaged reads truncate at PostgREST's 1,000-row cap

**Severity: MEDIUM/LOW, latent** (catalog 476; wheel/rain activity rows grow over time).

Three unpaged `activity_events` reads in `achievements.ts`, plus the `user_inventory`
join in the same function, and unpaged `badges` reads in `badgebase.ts` and `potat.ts`.
`global.ts:58-69` and `queries.ts` already page; these were missed.

## File 1 — `src/lib/gamification/achievements.ts`

`pageAll` already exists (`:387-403`). Wrap the four unpaged reads in the `Promise.all`
(`:412-473`).

Current:

```ts
const [badgesRes, gamesRes, roundsRes, wheelRes, turboRes, profileRes,
    rainRes, stealRes, reactRes, visitsRes, usersRes, topCoinsRes, achRes, visitorsRes,
    maxBetRes] =
    await Promise.all([
      supabase.from("user_inventory").select("badges(rarity_tier,status,set_id,first_seen_at,rarity_score)").eq("user_id", userId),
      pageAll<{ game: string; won: boolean }>((from, to) => ... game_rounds ...),
      supabase.from("game_rounds").select("game,won,bet,payout,result,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(60),
      supabase.from("activity_events").select("xp_amount").eq("user_id", userId).eq("kind", "wheel"),
      supabase.from("turbo_wins").select("id", { count: "exact", head: true }).eq("user_id", userId),
      supabase.from("profiles").select("view_count, customization, mood, twitch_created_at, showcase_slots, created_at").eq("id", userId).maybeSingle(),
      supabase.from("activity_events").select("payload").eq("kind", "coin_rain").eq("user_id", userId),
      pageAll<{...}>((from, to) => ... steal_attempts ...),
      supabase.from("blog_reactions").select("id", { count: "exact", head: true }).eq("user_id", userId),
      pageAll<{ profile_id: string }>((from, to) => ... profile_visits ...),
      supabase.from("profiles").select("id", { count: "exact", head: true }),
      supabase.from("user_progress").select("user_id").order("coins", { ascending: false }).limit(3),
      supabase.from("activity_events").select("kind").eq("user_id", userId),
      pageAll<{ ip_hash: string }>((from, to) => ... profile_visits ...),
      supabase.from("game_rounds").select("bet").eq("user_id", userId).order("bet", { ascending: false }).limit(1).maybeSingle(),
    ]);
```

Replace the four members (`badgesRes`, `wheelRes`, `rainRes`, `achRes`) with paged
versions, leaving order and all other members intact:

```ts
      // Paged: PostgREST caps one response at 1000 rows and these grow without
      // bound (a collector's inventory; wheel spins; coin-rain events), so an
      // unbounded select silently truncated the aggregates below.
      pageAll<{ badges: Record<string, unknown> | null }>((from, to) =>
        supabase
          .from("user_inventory")
          .select("badges(rarity_tier,status,set_id,first_seen_at,rarity_score)")
          .eq("user_id", userId)
          .order("badge_id")
          .range(from, to),
      ),
```

```ts
      pageAll<{ xp_amount: number | null }>((from, to) =>
        supabase
          .from("activity_events")
          .select("xp_amount")
          .eq("user_id", userId)
          .eq("kind", "wheel")
          .order("id")
          .range(from, to),
      ),
```

```ts
      pageAll<{ payload: Record<string, unknown> | null }>((from, to) =>
        supabase
          .from("activity_events")
          .select("payload")
          .eq("kind", "coin_rain")
          .eq("user_id", userId)
          .order("id")
          .range(from, to),
      ),
```

```ts
      pageAll<{ kind: string }>((from, to) =>
        supabase
          .from("activity_events")
          .select("kind")
          .eq("user_id", userId)
          .order("id")
          .range(from, to),
      ),
```

Downstream uses are unaffected: `badgesRes.data` is now `Array<{badges: …}>`; the existing
line

```ts
const badges = ((badgesRes.data ?? []) as Array<Record<string, unknown>>).map((b) => b.badges as Record<string, unknown>).filter(Boolean);
```

still works (each row has `.badges`), and `(wheelRes.data ?? [])`, `(rainRes.data ?? [])`,
`(achRes.data ?? [])` still work because `pageAll` returns an array. `user_inventory` has
**no `id` column** (PK is `(user_id, badge_id)`), which is why it is ordered by `badge_id`
— ordering by `id` would be a `42703`.

## File 2 — `src/lib/syncs/badgebase.ts`

Superseded by item 50's rewrite for badgebase (the paged load is inside it). If you are
not applying item 50, replace `badgebase.ts:84-90`:

```ts
  const allBadges: Array<Record<string, unknown>> = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("badges")
      .select("*")
      .order("id")
      .range(offset, offset + 999);
    if (error) throw error;
    const page = (data ?? []) as Array<Record<string, unknown>>;
    allBadges.push(...page);
    if (page.length < 1000) break;
  }
```

## File 3 — `src/lib/syncs/potat.ts:82-102`

Current:

```ts
  const badges = await supabase
    .from("badges")
    .select("*")
    .neq("status", "removed")
    .then(({ data, error }) => {
      if (error) throw error;
      return (data ?? []) as Array<Record<string, unknown> & { ... }>;
    });
```

Replace with a paged load keeping the same element type:

```ts
  // Paged: a single select silently stops at PostgREST's 1000-row cap, after
  // which the rows past it never get their owner counts or rarity refreshed.
  type BadgeRow2 = Record<string, unknown> & {
    id: string;
    set_id: string;
    version: string;
    image_url_1x: string | null;
    status: string;
    start_date: string | null;
    end_date: string | null;
    first_seen_at: string;
    owner_count: number | null;
    active_count: number | null;
    percentage: number | null;
    last_polled_at: string | null;
  };
  const badges: BadgeRow2[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("badges")
      .select("*")
      .neq("status", "removed")
      .order("id")
      .range(offset, offset + 999);
    if (error) throw error;
    const page = (data ?? []) as BadgeRow2[];
    badges.push(...page);
    if (page.length < 1000) break;
  }
```

(`byKey`/`byUuid` below use `(typeof badges)[number]`; with the explicit `BadgeRow2[]`
annotation this resolves the same way. If you prefer, keep the inline object type on the
`Array<>` and drop the named type.)

## Why it is correct / what it must not break

- Every loader uses the same offset/`range` + `order("id")` shape as `global.ts`, which is
  the established pattern for a stable total order.
- `pageAll` returns `{ data: T[]; error }`; callers already treat `.data ?? []` as an
  array, so no destructive behaviour changes. Errors are ignored exactly as they were
  (the unpaged selects also ignored/awaited them), except potat/badgebase which already
  threw.
- Ordering is stable per table (`id` is a PK/identity; `user_inventory` uses its unique
  `badge_id`), so no row is duplicated or dropped across pages.

## Risk if wrong

Ordering by a non-unique column would make paging skip/duplicate rows; the columns chosen
are unique per scope. `pageAll` over a very large table adds round trips (1,000 rows per
request) — bounded and cheap. The `user_inventory` join paging changes nothing below 1,000
owned badges.

## Verify

1. `npm run lint && npm run typecheck`.
2. `select count(*) from user_inventory where user_id = '<a big collector>';` and compare
   with the profile's owned count rendered on the page (they should agree past 1,000).
3. `select count(*) from badges;` → the potat/badgebase sweeps' `enriched`/`matched`
   counts should be consistent with the full catalog count, not capped at 1,000.
4. `select count(*) from activity_events where kind='wheel' and user_id='<you>';` vs. the
   wheel stats used by achievements (spot-check `k_lucky_2500`/`wheelBest`).

---

# 8. Item 51 — the new-badge fan-out drops lookup/insert errors and pushes an empty slug

**Severity: LOW–MEDIUM** (silent loss of `badge_events` history and blog posts; a dead
link delivered to every push subscriber).

In `global.ts`: the `.in("slug", …)` select's `error` is discarded (`:319-325`); if it
fails, `freshRows` is empty, so `badge_events` inserts and `createDropPost` are skipped
while the changelog row, desktop notification and web push still go out with
`url: "/en/badges/"` from `first?.slug ?? ""` (`:391-393`). The removal-events insert's
error is discarded too (`:428-434`).

## File

- `src/lib/syncs/global.ts` (`:314-414`, `:427-434`).

## Current code

```ts
    const freshBatches: Array<Record<string, unknown>> = [];
    for (const batch of chunk(newSlugs, 200)) {
      const { data } = await supabase
        .from("badges")
        .select(
          "id,slug,title,set_id,image_url_2x,category,is_paid,how_to_earn,start_date,end_date,rarity_tier,rarity_score",
        )
        .in("slug", batch);
      freshBatches.push(...((data ?? []) as Array<Record<string, unknown>>));
    }
```

```ts
    if (freshRows.length > 0) {
      await supabase.from("badge_events").insert(
        freshRows.map((row) => ({ ... })),
      );
      if (!isInitialSeed) { ...createDropPost... }
    }
```

```ts
    if (!isInitialSeed) {
      const first = freshRows[0];
      const url = `/en/badges/${first?.slug ?? ""}`;
      await recordNotification({ ... url ... }).catch(...);
      await sendPushToAll({ ... url ... }).catch(...);
    }
```

```ts
  if (removed.length > 0) {
    await supabase.from("badge_events").insert(
      removed.map((r) => ({ badge_id: r.id, kind: "removed" as const, detail: null })),
    );
```

## Replacement

Lookup — capture and fail loudly (the history is the durable record; better to fail the
run than to notify with a dead link):

```ts
    const freshBatches: Array<Record<string, unknown>> = [];
    for (const batch of chunk(newSlugs, 200)) {
      const { data, error } = await supabase
        .from("badges")
        .select(
          "id,slug,title,set_id,image_url_2x,category,is_paid,how_to_earn,start_date,end_date,rarity_tier,rarity_score",
        )
        .in("slug", batch);
      // A dropped lookup error used to leave `freshRows` empty: the durable
      // badge_events history and every drop post were skipped silently while the
      // changelog, notification and push still went out with a dead link.
      if (error) throw error;
      freshBatches.push(...((data ?? []) as Array<Record<string, unknown>>));
    }
```

History insert — surface its error:

```ts
    if (freshRows.length > 0) {
      const { error: eventsError } = await supabase.from("badge_events").insert(
        freshRows.map((row) => ({
          badge_id: row.id,
          kind: "added" as const,
          detail: { source, set_id: row.set_id },
        })),
      );
      if (eventsError) throw eventsError;
      if (!isInitialSeed) {
        for (const row of freshRows) {
          await createDropPost({ ... }, supabase);
        }
      }
    }
```

Notification/push — only when there is a real slug, and derive the URL without the
`?? ""` fallback:

```ts
    // Only notify when the fan-out actually looked the rows up: an empty
    // freshRows means "/en/badges/" — a dead link blasted to every subscriber.
    if (!isInitialSeed && freshRows.length > 0) {
      const first = freshRows[0];
      const url = `/en/badges/${first.slug}`;
      await recordNotification({ ...kind: "badge_added", ..., url, tag: "new-badges" })
        .catch((err) => console.warn("[notify] failed:", err));
      await sendPushToAll({ ..., url, tag: "new-badges" })
        .catch((err) => console.warn("[push] failed:", err));
    }
```

(The comment should note this is *not* the fix for VERIFIED item 8 — the `"/en/badges/…"`
prefix is still double-localised by next-intl's `Link`; that finding is outside this
proposal's scope. Only the empty-slug dead link is fixed here.)

Removal events — surface the error:

```ts
  if (removed.length > 0) {
    const { error: eventsError } = await supabase.from("badge_events").insert(
      removed.map((r) => ({ badge_id: r.id, kind: "removed" as const, detail: null })),
    );
    if (eventsError) throw eventsError;
    await logChange({ ... }, supabase);
  }
```

## Why it is correct / what it must not break

- The lookup throwing means the whole sync is marked failed and retried the next run; the
  badge rows were already upserted (idempotent on `(set_id, version)`), so the retry
  re-does the fan-out. This converts silent data loss into a visible failure.
- Notification/push now require `freshRows.length > 0`; `first.slug` is a non-null `text`
  column, so the URL is always well-formed.
- The initial-seed path still skips notification/push and blog posts.
- `logChange` for `badge_added` still runs when `freshRows` is empty (it only describes
  `addedTitles`); with the lookup now throwing, `freshRows` empty is only reachable for a
  genuine mid-flight deletion, in which case the log entry is still accurate about the
  additions attempted.

## Risk if wrong

A transient Supabase read error now fails the whole sync where before it "succeeded" with
a partial fan-out — the intended trade (history is durable). If you prefer not to fail the
catalog run, wrap the fan-out in its own `try/catch`, `console.error`, and skip the
notification/push while keeping the run green; then the loss is visible in the log at
least. The empty-slug guard is unconditional and safe either way.

## Verify

1. `npm run lint && npm run typecheck`.
2. Simulate: make the `.in("slug", …)` select fail (e.g. a temporary bad column) and run
   `runGlobalSync()` with one new badge → the run throws instead of sending a push.
3. Happy path: `select kind, count(*) from badge_events group by kind;` — a new badge
   produces one `added` row before its notification/push (check ordering in the code path
   or the notification payload).
4. `select url from notifications where kind='badge_added' order by created_at desc limit 5;`
   → no row ends in `/en/badges/`.

---

# 9. Item 24 — `showcase_slots` accepts arbitrary unowned slugs with no bound

**Severity: LOW** (public badge display the member does not own; unbounded public-read
JSONB string).

`/api/account` stores `showcaseSlots` verbatim — no ownership check, no per-string length,
no charset — and the profile page renders whatever slugs match the catalogue
(`user_inventory` is never consulted). `postgrest-js`'s `in()` wraps reserved characters
without escaping embedded quotes, so an unbounded/crafted slug can also break the
`.in("slug", slugs)` filter.

## File

- `src/app/api/account/route.ts` (`:49-53`), plus the migration (item 28's file, below).

## Current code

```ts
  if (Array.isArray(body.showcaseSlots)) {
    patch.showcase_slots = body.showcaseSlots
      .filter((slug): slug is string => typeof slug === "string")
      .slice(0, 6);
  }
```

## Replacement

```ts
  if (Array.isArray(body.showcaseSlots)) {
    // Cap the count, bound each slug and restrict it to the catalogue charset:
    // the column is public-read jsonb, so an unbounded string would be stored and
    // re-sent to PostgREST's `in()` on every profile view, and postgrest-js does
    // not escape embedded quotes.
    const wanted = [
      ...new Set(
        body.showcaseSlots
          .filter((slug): slug is string => typeof slug === "string")
          .map((slug) => slug.slice(0, 120))
          .filter((slug) => /^[A-Za-z0-9._-]+$/.test(slug)),
      ),
    ].slice(0, 6);

    // The picker only offers badges the member owns, but this route is the
    // boundary and the profile renders whatever slugs match the catalogue.
    if (wanted.length > 0) {
      const { data: badgeRows, error: badgeError } = await supabase
        .from("badges")
        .select("id,slug")
        .in("slug", wanted);
      if (badgeError) {
        return Response.json({ error: "showcase lookup failed" }, { status: 500 });
      }
      const idBySlug = new Map(
        ((badgeRows ?? []) as Array<{ id: string; slug: string }>).map((row) => [
          row.slug,
          row.id,
        ]),
      );
      const ids = wanted
        .map((slug) => idBySlug.get(slug))
        .filter((id): id is string => typeof id === "string");
      const { data: ownedRows, error: ownedError } = ids.length
        ? await supabase
            .from("user_inventory")
            .select("badge_id")
            .eq("user_id", user.id)
            .in("badge_id", ids)
        : { data: [] as Array<{ badge_id: string }>, error: null };
      if (ownedError) {
        return Response.json({ error: "showcase ownership check failed" }, { status: 500 });
      }
      const ownedIds = new Set(
        (ownedRows ?? []).map((row) => row.badge_id as string),
      );
      patch.showcase_slots = wanted.filter((slug) => {
        const id = idBySlug.get(slug);
        return id ? ownedIds.has(id) : false;
      });
    } else {
      patch.showcase_slots = [];
    }
  }
```

## Why it is correct / what it must not break

- `supabase` here is the request's user-scoped server client (`createClient`); the
  `inventory_read` policy allows `user_id = auth.uid()` and `badges` is public-read, so no
  service-role client is needed (`getInventory` uses the same path).
- The charset filter makes `.in("slug", wanted)` safe for postgrest-js and matches catalogue
  slugs (`badgeSlug` produces `[a-z0-9-]`, plus `.`/`_` tolerated).
- Dropping unowned/non-catalogue slugs changes only what is **stored**: the profile page
  only ever renders slugs that resolve in the catalogue, so what a visitor sees is
  unchanged for legitimate uses.
- Clearing is still possible: an empty/filtered-to-empty array writes `[]`.
- `wanted` is deduped, so `patch.showcase_slots` never repeats a slug.
- The existing `Object.keys(patch).length === 0 → 400` guard is unaffected.

## Risk if wrong

Two extra round trips per AccountSettings save when showcase slots are present; acceptable.
If a member legitimately owns a badge that the sync has not yet written to
`user_inventory`, the selection is dropped — the picker only offers in-inventory badges,
so this cannot happen through the UI. The `showcase_slots` `jsonb` column has no NOT NULL
issue with `[]`.

## Verify

1. `npm run lint && npm run typecheck`.
2. As any member, `POST /api/account {"showcaseSlots":["<a badge you do NOT own>"]}` →
   `select showcase_slots from profiles where id='<you>';` → `[]`.
3. Own badge: pick it in the account UI → save → the slug is stored and the public
   showcase shows it.
4. Oversized/crafted: `{"showcaseSlots":["a\"b", "<1 MB string>"]}` → stored array is
   `[]` (or contains only clean, owned slugs); `select pg_column_size(showcase_slots) from profiles where id='<you>';` stays tiny.

---

# 10. Item 25 — "Sync inventory" reverts the member's display name

**Severity: LOW.** `display_name` is member-editable in `AccountSettings` and is the
public profile heading; `normalize()` almost always yields a non-empty `displayName`
(falling back to the login), so the sync overwrites the member's chosen name.

## File

- `src/lib/inventory.ts` (`:179-197`).

## Current code

```ts
  // Keep profile Twitch metadata fresh (avatar / display name / creation).
  // Only fields the provider actually returned are written: an empty or null
  // value used to overwrite a good one, so one thin response blanked the
  // avatar and display name of a user who had both.
  const profilePatch: Record<string, unknown> = {};
  if (perfil.displayName) profilePatch.display_name = perfil.displayName;
  if (perfil.profileImageURL) profilePatch.avatar_url = perfil.profileImageURL;
  if (perfil.id) profilePatch.twitch_id = perfil.id;
  if (perfil.createdAt) profilePatch.twitch_created_at = perfil.createdAt;
  if (Object.keys(profilePatch).length > 0) {
    const { error: profileError } = await supabase
      .from("profiles")
      .update(profilePatch)
      .eq("id", userId);
    if (profileError) console.warn("[inventory] profile update failed:", profileError.message);
  }
```

## Replacement

```ts
  // Provider-owned identity metadata: avatar, twitch id and account creation are
  // refreshed on every sync. `display_name` is deliberately NOT in this patch —
  // it is member-editable (AccountSettings) and is the public profile heading, so
  // a sync writing it silently reverted a chosen name to the Twitch name.
  const profilePatch: Record<string, unknown> = {};
  if (perfil.profileImageURL) profilePatch.avatar_url = perfil.profileImageURL;
  if (perfil.id) profilePatch.twitch_id = perfil.id;
  if (perfil.createdAt) profilePatch.twitch_created_at = perfil.createdAt;
  if (Object.keys(profilePatch).length > 0) {
    const { error: profileError } = await supabase
      .from("profiles")
      .update(profilePatch)
      .eq("id", userId);
    if (profileError) console.warn("[inventory] profile update failed:", profileError.message);
  }

  // Seed `display_name` from Twitch only while it is still unset, so a first
  // sync populates it and a member's chosen name is never reverted. Conditional
  // in SQL (`.is(..., null)`) so it stays correct under concurrency.
  if (perfil.displayName) {
    const { error: nameError } = await supabase
      .from("profiles")
      .update({ display_name: perfil.displayName })
      .eq("id", userId)
      .is("display_name", null);
    if (nameError) console.warn("[inventory] display name seed failed:", nameError.message);
  }
```

## Why it is correct / what it must not break

- Keeps the first-sync population (display_name still becomes the Twitch display name for
  a member who never set one) while never overwriting a member value.
- Handles the "thick response blanks a good value" case as before (only non-empty
  provider values are used).
- The extra `update` is conditional in SQL, so two concurrent syncs cannot both write.

## Risk if wrong

A member who deliberately wants to clear their display name back to the Twitch name must
type it in AccountSettings; the sync will not repopulate a nulled column. That is the
intended consequence of treating the field as member-owned.

## Verify

1. `/en/account`: set Display name = "Cool Name" → Save.
2. Press "Sync inventory" on the inventory page.
3. `select display_name from profiles where id='<you>';` → still "Cool Name".
4. Fresh account (null display_name) + sync → the column is populated from Twitch.

---

# 11. Item 29 — `/api/push/subscribe` ownership guard fails open

**Severity: LOW** (security). The `maybeSingle()` `error` is discarded; a lookup failure
leaves `existing` null, the 409 guard is skipped, and the following
`upsert(..., { onConflict: "endpoint" })` rewrites `user_id` to the caller's — `null` for
an anonymous request, detaching a signed-in user's browser.

## File

- `src/app/api/push/subscribe/route.ts` (`:63-70`).

## Current code

```ts
  const { data: existing } = await admin
    .from("push_subscriptions")
    .select("user_id")
    .eq("endpoint", endpoint)
    .maybeSingle();
  if (existing?.user_id && existing.user_id !== user?.id) {
    return Response.json({ error: "endpoint already registered" }, { status: 409 });
  }
```

## Replacement

```ts
  const { data: existing, error: lookupError } = await admin
    .from("push_subscriptions")
    .select("user_id")
    .eq("endpoint", endpoint)
    .maybeSingle();
  // Fail CLOSED: the ownership guard is worth nothing if a failed lookup lets the
  // upsert below rewrite `user_id` to the caller's (null for an anonymous
  // request), detaching someone else's browser.
  if (lookupError) {
    return Response.json({ error: "subscription lookup failed" }, { status: 500 });
  }
  if (existing?.user_id && existing.user_id !== user?.id) {
    return Response.json({ error: "endpoint already registered" }, { status: 409 });
  }
```

## Why it is correct / what it must not break

- A transient lookup error now rejects the subscribe (client can retry) rather than
  mutating ownership. This is the standard fail-closed choice for an authorization check.
- Happy paths are unchanged; `endpoint` is unique (the upsert's `onConflict: "endpoint"`
  depends on it), so `maybeSingle` returns 0 or 1 row.
- The DELETE path already does the correct ownership scoping and is untouched.

## Risk if wrong

A brief PostgREST outage makes new subscriptions fail with 500 instead of silently
mis-assigning them — acceptable and recoverable (the PWA re-subscribes).

## Verify

1. `npm run lint && npm run typecheck`.
2. Anonymous `curl -X POST /api/push/subscribe` with an endpoint already owned by a
   signed-in user → `409` (unchanged, proves the guard still fires).
3. Code inspection confirms the `lookupError` branch precedes the upsert.

---

# 12. Item 30 — `sendPushToAll` reads subscriptions unpaged

**Severity: LOW** (silent fan-out loss past 1,000 subscriptions; the table is empty
today).

## File

- `src/lib/push.ts` (`:39-43`).

## Current code

```ts
  const supabase = createAdminClient();
  const { data: subscriptions, error } = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth");
  if (error) throw error;

  let sent = 0;
  ...
  await Promise.allSettled(
    (subscriptions ?? []).map(async (sub) => {
```

## Replacement

```ts
  const supabase = createAdminClient();
  // Paged: PostgREST caps one response at 1000 rows, so a single select would
  // silently notify an arbitrary 1000 subscribers and only ever see their dead
  // endpoints.
  type Subscription = { endpoint: string; p256dh: string; auth: string };
  const subscriptions: Subscription[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .order("endpoint")
      .range(offset, offset + 999);
    if (error) throw error;
    const page = (data ?? []) as Subscription[];
    subscriptions.push(...page);
    if (page.length < 1000) break;
  }

  let sent = 0;
  ...
  await Promise.allSettled(
    subscriptions.map(async (sub) => {
```

## Why it is correct / what it must not break

- `endpoint` is unique, so it is a stable total order — no row skipped or duplicated
  across pages.
- `subscriptions` is now always an array, so `(subscriptions ?? [])` becomes
  `subscriptions.map(...)`.
- The dead-endpoint prune still operates on everything actually sent to.

## Risk if wrong

More round trips for a large subscriber base (1,000 per request), and the fan-out holds
every subscription in memory — a deliberate trade for completeness. If the table grows to
tens of thousands, chunk the fan-out too (not needed now).

## Verify

1. `npm run lint && npm run typecheck`.
2. `select count(*) from push_subscriptions;` and confirm the `sent + failed` total the
   function returns can reach that number (> 1,000 in a seeded test).

---

# 13. Item 28 — the visit / blog dedup race (read-then-insert)

**Severity: LOW.** The counter bump is atomic (`bump_view_count`), but the dedup is not:
two overlapping requests both read 0, both insert, both bump. The same pattern exists in
`recordBlogView`.

## Design

A unique index is the only atomic form. A **fixed 5-minute bucket** supplied by the
writer (on top of the existing *sliding* read check) closes the race at the reported
instant, with two properties kept deliberately:

- Existing rows keep a **NULL** bucket and are exempt via a **partial** unique index → no
  row is deleted, no backfill, and the index cannot fail on historical duplicates.
- The sliding read check stays, so sequential reloads behave exactly as today.

Residual: two overlapping requests that land in **different** buckets can still both
insert. That is strictly better than today (same-bucket races are closed) and far cheaper
than a locking RPC. If you want exact sliding-window atomicity, replace the insert path
with a `SECURITY DEFINER` RPC that takes `pg_advisory_xact_lock(hashtext(profile_id||ip_hash))`
before the check-then-insert — but note that is the same function class that produced
items 1/2 in this round, so it must `revoke … from public, anon, authenticated` and take
no caller-supplied window.

## File 1 — new migration `supabase/migrations/0034_profile_visit_dedup_and_showcase_bounds.sql`

```sql
-- ============================================================
-- 0034 — atomic profile/blog view dedup + bounded showcase slots
-- ============================================================
-- WHY THIS EXISTS
-- (a) `profile_visits` (and `blog_views`) enforces its 5-minute per-IP dedup as an
--     application-level read-then-insert: two overlapping requests both read "no recent
--     visit" and both insert, so one visitor yields two rows and two counter bumps. The
--     counter bump is already atomic (bump_view_count, 0006/0007); the dedup was not, and
--     a unique index is the only atomic form. The writer supplies a fixed 5-minute bucket
--     ON TOP of the existing sliding read check, so sequential behaviour is unchanged and
--     only the race is closed. Existing rows keep a NULL bucket and are exempt (partial
--     index), so no row is deleted and the index cannot fail on historical duplicates.
-- (b) `profiles.showcase_slots` is public-read jsonb with no CHECK; a non-app writer could
--     store an unbounded array. The write path now bounds it; this is the matching
--     backstop (0012 pattern).

alter table public.profile_visits
  add column if not exists dedup_bucket bigint;

alter table public.blog_views
  add column if not exists dedup_bucket bigint;

create unique index if not exists profile_visits_dedup_unique
  on public.profile_visits (profile_id, ip_hash, dedup_bucket)
  where dedup_bucket is not null;

create unique index if not exists blog_views_dedup_unique
  on public.blog_views (post_id, ip_hash, dedup_bucket)
  where dedup_bucket is not null;

alter table public.profiles
  drop constraint if exists profiles_showcase_slots_shape;
alter table public.profiles
  add constraint profiles_showcase_slots_shape
  check (
    jsonb_typeof(showcase_slots) = 'array'
    and jsonb_array_length(showcase_slots) <= 6
  );

-- PostgREST serves the schema from a cache; refresh it so the new columns/indexes/
-- constraint are visible immediately (0008–0012 convention).
notify pgrst, 'reload schema';

insert into public.changelog (kind, title, body, payload) values (
  'bugfix',
  'View dedup is atomic; showcase slots are bounded',
  'profile_visits and blog_views deduplicated their 5-minute window with a read-then-insert, so two overlapping requests both inserted and both bumped the view counter. A partial unique index on (id, ip_hash, dedup_bucket) — the bucket written by the app — makes the guard atomic for new rows; existing rows keep a NULL bucket and are untouched. profiles.showcase_slots also gained an array/length CHECK as the database-level backstop for the /api/account ownership+size validation.',
  '{"version": "visit-dedup-1.0"}'::jsonb
);
```

## File 2 — `src/lib/gamification/visits.ts`

Current (`:30-33` and `:78-81`):

```ts
  const { error: insertError } = await supabase
    .from("profile_visits")
    .insert({ profile_id: profileId, visitor_id: visitorId, ip_hash: ipHash });
  if (insertError) return false;
```

```ts
  const { error: insertError } = await supabase
    .from("blog_views")
    .insert({ post_id: postId, ip_hash: ipHash });
  return !insertError;
```

Replacement — compute the bucket once in each function and include it:

`recordProfileVisit`:

```ts
  // Same-bucket key for the partial unique index: two overlapping requests in the
  // same 5-minute window collide on insert instead of both counting. The read
  // check above keeps the sliding-window behaviour; this only closes the race.
  const bucket = Math.floor(Date.now() / DEDUP_WINDOW_MS);
  const { error: insertError } = await supabase
    .from("profile_visits")
    .insert({
      profile_id: profileId,
      visitor_id: visitorId,
      ip_hash: ipHash,
      dedup_bucket: bucket,
    });
  // A 23505 here is the race losing, not an error: the visit was already counted.
  if (insertError) return false;
```

`recordBlogView`:

```ts
  const bucket = Math.floor(Date.now() / DEDUP_WINDOW_MS);
  const { error: insertError } = await supabase
    .from("blog_views")
    .insert({ post_id: postId, ip_hash: ipHash, dedup_bucket: bucket });
  return !insertError;
```

## Why it is correct / what it must not break

- The app already treats any insert error as "not counted" (`return false` / `!insertError`),
  so a `23505` from the index is absorbed correctly with no code change beyond the bucket.
- The sliding read check is untouched, so the *observed* window is unchanged in every
  non-race case.
- Existing rows (`dedup_bucket IS NULL`) are ignored by the partial index — the index
  creation cannot fail on historical duplicates.
- Service-role inserts bypass RLS; column grants for service_role are unaffected.
- Deploy order: apply the migration **before** the code (an insert naming a not-yet-existing
  column errors; the app degrades gracefully by not counting views until migrated).

## Risk if wrong

A wrong bucket expression (e.g. per-second instead of 5-minute) would make the index
useless or over-restrictive. Bucket boundaries allow at most two rows in any sliding
5-minute span (the residual above) — no worse than today. If the index is created
*without* the partial predicate, it would fail on existing duplicates and abort the
migration inside its transaction (safe, but blocked).

## Verify

1. `npm run db:apply` on a copy, then
   `select indexdef from pg_indexes where indexname in ('profile_visits_dedup_unique','blog_views_dedup_unique');`
   → both `WHERE (dedup_bucket IS NOT NULL)`.
2. Fire two simultaneous `GET /en/profile/<x>` with the same cookie, then
   `select count(*) from profile_visits where profile_id='<x>' and ip_hash='<h>' and created_at > now() - interval '1 minute';`
   → 1 (was 2), and `select view_count from profiles where id='<x>';` up by 1.
3. Reload after 5+ minutes → counts once more (sliding window still works).

---

# 14. Item 26 — `perfil.normalize()` trusts a non-array `badges`

**Severity: LOW.** `(raw.badges ?? []).map(...)` throws on `{"badges":{}}` instead of
degrading to "no badges". The badges.blog leg's throw is caught, but the GQL leg is
outside that `try`, so the same malformed shape escapes `fetchUserBadges` and the profile
page's `catch { notFound() }` turns a real Twitch user into a 404 with no log. `raw` itself
is unguarded too (`raw.id` on a literal `null` body).

## File

- `src/lib/twitch/perfil.ts` (`:37-59`, `:75`, `:97-104`).

## Current code

```ts
function normalize(raw: RawPerfilUser): PerfilUser {
  return {
    id: String(raw.id ?? ""),
    login: String(raw.login ?? ""),
    displayName: String(raw.displayName ?? raw.display_name ?? raw.login ?? ""),
    profileImageURL: String(
      raw.profileImageURL ?? raw.profile_image_url ?? "",
    ),
    createdAt: raw.createdAt ?? raw.created_at ?? null,
    isAffiliate: raw.isAffiliate,
    badges: (raw.badges ?? []).map((b) => ({ ... })),
  };
}
```

```ts
  return normalize((await res.json()) as RawPerfilUser);
```

```ts
  const payload = (await res.json()) as Array<{
    data?: { user?: RawPerfilUser | null };
  }>;
  const user = payload[0]?.data?.user;
```

## Replacement

```ts
function normalize(raw: RawPerfilUser | null | undefined): PerfilUser {
  // Both upstream bodies are cast, not validated: a response of {"badges": {}}
  // (or a literal null) made `.map` a TypeError. Degrade to "no badges" instead —
  // the profile page turns an escaping throw into a 404.
  const user: RawPerfilUser =
    raw && typeof raw === "object" ? raw : {};
  const list = Array.isArray(user.badges) ? user.badges : [];
  return {
    id: String(user.id ?? ""),
    login: String(user.login ?? ""),
    displayName: String(user.displayName ?? user.display_name ?? user.login ?? ""),
    profileImageURL: String(
      user.profileImageURL ?? user.profile_image_url ?? "",
    ),
    createdAt: user.createdAt ?? user.created_at ?? null,
    isAffiliate: user.isAffiliate,
    badges: list.map((b) => ({
      setID: String(b.setID ?? ""),
      version: String(b.version ?? "1"),
      title: b.title ?? null,
      description: b.description ?? null,
      image1x: b.image1x ?? null,
      image2x: b.image2x ?? null,
      image4x: b.image4x ?? null,
      clickAction: b.clickAction ?? null,
      clickURL: b.clickURL ?? null,
    })),
  };
}
```

GQL body guard (`:97-104`):

```ts
  const payload = (await res.json()) as
    | Array<{ data?: { user?: RawPerfilUser | null } }>
    | null;
  const user = Array.isArray(payload) ? payload[0]?.data?.user : undefined;
  if (!user) {
    throw new Error(`Twitch GQL: user "${login}" not found`);
  }
  return normalize(user);
```

## Why it is correct / what it must not break

- A well-formed payload is unchanged (same field precedence).
- A malformed/non-array `badges` now yields `[]` rather than a throw; the resolver still
  returns a usable `PerfilUser` (display name falls back to the login), so the profile
  renders instead of 404ing.
- `normalize` is called from both legs; the null guard covers the badges.blog `null` body
  and the GQL non-array body.
- The valid-login regex check in `fetchUserBadges` is untouched; the "user not found"
  throw for a genuinely missing user is preserved (`!user` still throws).

## Risk if wrong

If a malformed payload becomes common, profiles silently show "no badges" — better than a
404 and now logged as a warning upstream (the badges.blog leg still warns). No security
change.

## Verify

1. `npm run lint && npm run typecheck`.
2. Point `BADGESBLOG_PERFIL_URL` at a stub returning `{"badges":{}}` and load
   `/en/profile/<a-non-member>` → the page renders (no badges), not a 404.
3. Same stub for `TWITCH_GQL_URL` with the badges.blog leg failing → same result (no
   escaping throw).

---

# 15. Item 27 — the GQL fallback drops the caller's cache window

**Severity: LOW.** `fetchUserBadges(login, 900)` is documented to cache the resolved list
for 15 minutes; `fetchFromGql` hard-codes `revalidate: 0` and the catch does not forward
`revalidate`, so while badges.blog is down every profile view is an uncached live GQL call
to `gql.twitch.tv`.

## File

- `src/lib/twitch/perfil.ts` (`:82-93`, `:120-128`).

## Current code

```ts
async function fetchFromGql(login: string): Promise<PerfilUser> {
  const query = `...`;
  const res = await fetch(envOrNull("TWITCH_GQL_URL") ?? GQL_URL, {
    ...
    next: { revalidate: 0 },
  });
```

```ts
  try {
    return await fetchFromBadgesBlog(clean, revalidate);
  } catch (error) {
    ...
    return fetchFromGql(clean);
  }
```

## Replacement

```ts
async function fetchFromGql(login: string, revalidate: number): Promise<PerfilUser> {
  const query = `...`;
  const res = await fetch(envOrNull("TWITCH_GQL_URL") ?? GQL_URL, {
    ...
    // Honour the caller's window: with `revalidate: 0` an upstream badges.blog
    // outage — the exact condition this fallback exists for — turned every view
    // of every non-member profile into an uncached call to gql.twitch.tv.
    next: { revalidate },
  });
```

```ts
    return fetchFromGql(clean, revalidate);
```

## Why it is correct / what it must not break

- The primary path already forwards `revalidate` to `fetchFromBadgesBlog`; the fallback
  now does the same. `fetchUserBadges`'s default is `300`, and the profile page passes
  `900`, so the fallback inherits exactly the same window.
- No call site changes: `fetchFromGql` is private and only invoked from that catch.

## Risk if wrong

A longer cache on the GQL fallback means a just-changed Twitch badge set can be up to 15
minutes stale during an outage — the same trade the primary path already makes. If a stale
fallback were unacceptable, the caller should pass a smaller window; the function now
respects it.

## Verify

1. `npm run lint && npm run typecheck`.
2. Point `BADGESBLOG_PERFIL_URL` at a failing host, request `/en/profile/<non-member>`
   twice, and confirm only one outbound GQL POST per cache window (`revalidate: 900`).

---

# 16. Item 57 — the Content panel shares error/notice between sub-tabs

**Severity: LOW.** The banner lives in `ContentPanel`, so an error raised by the Blog tab
stays on screen after switching to Changelog (and vice-versa), reporting a failure against
the wrong section.

## File

- `src/components/admin/ContentPanel.tsx` (`:60-80`).

## Current code

```tsx
      <nav className="flex gap-1">
        {(["blog", "changelog"] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => setTab(entry)}
            ...
          >
            {t(`tabs.${entry}`)}
          </button>
        ))}
      </nav>
```

## Replacement

```tsx
      <nav className="flex gap-1">
        {(["blog", "changelog"] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => {
              setTab(entry);
              // The error/notice banner is shared by both sub-views; clear it on
              // switch so a Blog failure is not shown as the Changelog's.
              setError(null);
              setNotice(null);
            }}
            ...
          >
            {t(`tabs.${entry}`)}
          </button>
        ))}
      </nav>
```

## Why it is correct / what it must not break

- Both sub-panels already `setError(null)`/`setNotice(null)` before their own loads, so
  clearing on switch only removes stale cross-tab context; each panel's own messages still
  appear.
- No change to the banner markup or the `setError`/`setNotice` props.
- The stronger alternative (move the banner and state into each child) is unnecessary for
  correctness; this two-line change fixes the reported defect.

## Risk if wrong

None material: a message raised by a panel is cleared when the operator leaves that tab,
which is the desired behaviour.

## Verify

1. Force a Blog load failure (make `/api/admin/content?resource=blog` return non-200),
   switch to Changelog → no stale Blog error above the changelog table.

---

# Appendix — applying this set

1. Apply code edits in a branch; run `npm run lint && npm run typecheck && npm run build`.
2. Apply `0034` **before** deploying the `visits.ts` change:
   `npm run db:apply`, then
   `select indexdef from pg_indexes where indexname like '%dedup_unique';` and
   `select conname from pg_constraint where conname = 'profiles_showcase_slots_shape';`.
3. `npm run log:change -- bugfix "<one line>" "<paragraph>" '{"audit":"full-audit-2026-09"}'`
   for the app-side changes (the migration writes its own row).
4. Deploy order per AGENTS.md: the `visits.ts` column must exist first; everything else is
   code-only and safe to ship together.

Notes on items that interact:

- **Item 50 already includes item 9's guards** (and item 33's paged catalog load) — apply
  it as one replacement and skip those two standalone patches.
- **Item 49 depends on item 50's `skipped` reasons** (`empty-listing` /
  `active-listing-ratio`); the genericised heartbeat message there covers both.
- **Item 24 and item 28 share migration `0034`.**
- **Item 8** (notification URL double-localised by `Link`) is deliberately **not** touched
  here — it is outside the list you gave me; item 51 only removes the empty-slug dead link.
