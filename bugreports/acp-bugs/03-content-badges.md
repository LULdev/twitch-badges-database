# Content & badge administration (blog / changelog / custom badges) + catalogue protection

Audited:
- `src/lib/admin-content.ts`
- `src/app/api/admin/content/route.ts`
- `src/components/admin/ContentPanel.tsx`
- `src/components/admin/BadgesPanel.tsx`
- `src/lib/syncs/global.ts` (the `customKeys` / `incomingLive` logic and the removal/status sweeps)
- supporting reads: `src/lib/admin-route.ts`, `src/lib/admin.ts` (`audit`, `requireAdmin`),
  `src/lib/blog.ts`, `src/lib/markdown.ts`, `src/lib/jsonld.ts`, `src/lib/twitch/types.ts`,
  `src/components/badges/BadgeImage.tsx`,
  `supabase/migrations/0001_init.sql`, `0016_badges_touch_updated_at.sql`,
  `src/app/[locale]/blog/[slug]/page.tsx`, `src/app/[locale]/badges/[slug]/page.tsx`,
  `src/app/[locale]/changelog/page.tsx`, `docs/ACP.md`, `messages/*.json`

Method: read all files above; verified the DB schema/constraints against the migrations
(`badges.slug text not null unique`, `unique (set_id, version)`, `blog_posts.slug not null unique`,
`published_at not null default now()`); machine-checked every key used by both panels against all
eleven `messages/*.json` (none missing); ran `npx eslint` on the five in-scope files (clean).
Could not run the panels in a browser or run `runGlobalSync` (no owner / outward-facing side
effects), so client-side claims are by inspection and the sync claims are by code reading +
schema. No `SELECT` was needed beyond the schema.

## B1 — Editing any badge in the panel relabels it `source = "custom"`, permanently shielding a provider badge from the global sync

- **Severity**: critical
- **Confidence**: high (verified by reading)
- **Where**: `src/lib/admin-content.ts:268` (payload) and `src/lib/admin-content.ts:295-302` (the `if (id)` update branch); interacts with `src/lib/syncs/global.ts:81-98` and `src/lib/syncs/global.ts:266-277`
- **Code**:
```ts
const payload: Record<string, unknown> = {
  set_id: setId,
  version,
  title,
  category,
  slug: slugify(`${setId}-${version}`),
  source: "custom",          // hardcoded for BOTH create and update
  last_seen_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};
...
if (id) {
  // `source` is not editable: a row that came from Helix is not the admin's
  // to relabel, and a custom row must stay protected from the sweep.
  const { error } = await supabase.from("badges").update(payload).eq("id", id);
```
- **Why it is wrong**: the comment says `source` "is not editable", but the update branch writes
  the same `payload` object — which always contains `source: "custom"`. `BadgesPanel` defaults to
  the custom-only filter but the checkbox can be cleared, so the list loads real Helix/IVR/badgebase
  rows; opening one and pressing Save sets `source = 'custom'` on that provider row. From the next
  `runGlobalSync`, `customKeys` is built from `row.source === "custom"` (`global.ts:81-85`), that
  `(set_id, version)` is filtered out of `incomingLive` (`global.ts:96-98`), and the removal sweep
  skips it (`global.ts:269`). The badge therefore stops receiving provider updates forever and is
  never swept even after Twitch retires it; worse, `deleteBadge`'s guard
  (`admin-content.ts:336`) now sees `source === "custom"` and permits deletion — and because the key
  is excluded from `incomingLive`, the sync will never re-insert it. A provider badge can be
  silently converted and then permanently deleted.
- **How to reproduce**: in the ACP → Badges tab, untick "custom only", open any Helix badge
  (e.g. a `partner`/event badge), press Save without changing anything; inspect the row — `source`
  is now `custom` and the next catalog sync skips it.
- **Suspected cause**: `source: "custom"` lives in the shared payload instead of being added only on
  the insert path (the `if (!id)` branch).

## B2 — Editing a changelog entry in the panel silently erases its JSON payload

- **Severity**: high
- **Confidence**: high (verified by reading)
- **Where**: `src/components/admin/ContentPanel.tsx:356-363` and `:395-425`; `src/lib/admin-content.ts:164-175`
- **Code**:
```tsx
onClick={() =>
  setDraft({
    id: entry.id, kind: entry.kind, title: entry.title,
    body: entry.body ?? "", payload: "",   // original payload is discarded
  })
}
...
{draft.id === undefined ? ( <label>… payload textarea …</label> ) : null}
...
let payload: unknown = null;
if (draft.payload.trim()) { … JSON.parse … }
… input: { kind, title, body, payload }
```
```ts
const row = { kind, title, body: input.body ?? null, payload: (input.payload ?? null) as … };
if (id) { await supabase.from("changelog").update(row).eq("id", id); … }
```
- **Why it is wrong**: the payload field is hidden while editing an existing entry, and the draft is
  opened with `payload: ""`. On Save, `draft.payload.trim()` is falsy, `payload` stays `null`, and
  `upsertChangelog` unconditionally writes `payload: null` on the UPDATE. Editing any changelog
  entry — even just fixing a typo in the title — destroys its structured `payload` JSON (the
  `logChange()` payloads that the syncs and RSS use). `listChangelog` selects `payload` but
  `ChangelogRow` does not declare it, so the original value never reaches the form.
- **How to reproduce**: by inspection — open a sync-generated changelog row (`data_sync`,
  `badge_added`), change the title, Save; the row's `payload` becomes `null`.
- **Suspected cause**: the editor neither loads nor re-sends the existing payload, and the update
  always includes the key.

## B3 — A custom badge slug can be empty, and a slug collision reports a 500 instead of a clear error

- **Severity**: medium
- **Confidence**: high (verified by reading + schema: `badges.slug text not null unique`)
- **Where**: `src/lib/admin-content.ts:273` (`slug: slugify(...)`, no emptiness guard) and `:304-322` (create clash check is on `(set_id, version)` only)
- **Code**:
```ts
slug: slugify(`${setId}-${version}`),
...
const { data: clash } = await supabase.from("badges")
  .select("id, source").eq("set_id", setId).eq("version", version).maybeSingle();
if (clash) { throw new Error(`a ${clash.source} badge already exists for ${setId} v${version}`); }
```
- **Why it is wrong**: `slugify` strips everything outside `[a-z0-9\s-]` after NFKD, so a `set_id`
  with no ASCII alphanumerics (e.g. `"日本語"`, or a set id made only of symbols) yields `""`.
  `upsertBlogPost` guards `if (!slug) throw …` (`admin-content.ts:93`), but `upsertBadge` does not,
  so a badge is inserted with `slug = ''` — a public URL `/en/badges/` that resolves nothing, and a
  second such badge dies on the `slug` unique constraint. Separately, because the clash check keys on
  `(set_id, version)`, a *different* pair that slugifies to the same string (e.g. set_id `"a b"`
  version `"1"` vs set_id `"a-b"` version `"1"` → both `a-b-1`; or set_id `"foo"` version `"v2"` vs
  a provider row's `badgeSlug("foo","2") = "foo-v2"`) passes the check and then fails the DB unique
  constraint — a raw Postgres message that `adminAction`'s regex (`src/lib/admin-route.ts:35`) does
  not match, so the operator sees `500 {"error":"internal"}` instead of "slug already taken".
- **How to reproduce**: by inspection — create a custom badge whose `set_id` is non-Latin; the row
  gets an empty slug. Or create two badges whose `(set_id,version)` differ but slugify identically.
- **Suspected cause**: missing `if (!slug)` guard, and a collision check narrower than the DB's own
  uniqueness (`slug`).

## B4 — `deleteBadge` ignores the row lookup's error, so a failed SELECT bypasses the "custom only" guard

- **Severity**: medium
- **Confidence**: medium (logic verified; requires a transient lookup failure)
- **Where**: `src/lib/admin-content.ts:329-339`
- **Code**:
```ts
const { data: row } = await supabase
  .from("badges")
  .select("source, set_id, version")
  .eq("id", id)
  .maybeSingle();
if (row && row.source !== "custom") {
  throw new Error("only custom badges can be deleted — provider badges return on the next sync");
}
const { error } = await supabase.from("badges").delete().eq("id", id);
```
- **Why it is wrong**: the destructure drops `error`. On any lookup failure (network blip, pooler
  hiccup) `row` is `null`, the `row &&` short-circuits, and the guard is skipped — the provider
  badge is then deleted. Cascades remove its `badge_events` and every owner's `user_inventory` row
  (`0001_init.sql:112,127,206`), so collectors lose the badge; the next sync re-inserts a *new*
  row/`id`, so those inventory links are not recovered. The same call also writes a
  `badge.delete` audit row (`:341`), so a genuine lookup failure is recorded as a successful
  deletion.
- **How to reproduce**: by inspection — a `select` error leaves `data` null; contrast with the
  code's own intent that a provider badge must never be deletable.
- **Suspected cause**: `error` not checked (or absence of the row conflated with a failed read).

## B5 — New custom badges store `""` instead of `null` for optional fields, so the 1x image never renders and the "how to earn" fallback is defeated

- **Severity**: medium
- **Confidence**: high (verified by reading + `BadgeImage` nullish logic)
- **Where**: `src/components/admin/BadgesPanel.tsx:87-108` (`newBadge` defaults) and `:248-263` (save payload); `src/lib/admin-content.ts:289-292`; `src/components/badges/BadgeImage.tsx:26`
- **Code**:
```ts
// BadgesPanel newBadge()
image_url_1x: "", image_url_2x: "", image_url_4x: "", click_url: "",
description: "", how_to_earn: "",
```
```ts
// admin-content.ts optional loop
const value = input[from];
if (value !== undefined) payload[to] = value;   // "" is stored, not skipped
```
```ts
// BadgeImage.tsx
const src = badge.image_url_4x ?? badge.image_url_2x ?? badge.image_url_1x ?? null;
```
- **Why it is wrong**: the panel only exposes `image_url_1x` for editing, but initialises `2x`/`4x`
  to `""`. The API writes those empty strings (only `undefined` is skipped). `BadgeImage` uses `??`,
  which does not skip `""`, so `src = "" ?? "" ?? <the real 1x URL> = ""` → falsy → the placeholder
  is drawn. A custom badge for which the admin supplied a valid image URL therefore displays **no
  artwork**. The same empty-string-vs-null issue makes `how_to_earn ?? description ?? t("howToEarnUnknown")`
  on the badge page (`badges/[slug]/page.tsx:278`) render a blank paragraph instead of the "unknown"
  fallback, and puts `""` into the page's meta description (`:108`).
- **How to reproduce**: ACP → Badges → New, set a title and fill the single image field, Save; open
  the badge page — the image placeholder is shown, not the URL.
- **Suspected cause**: form defaults use `""` where the column and the render paths expect `null`.

## B6 — Blog update path never checks slug uniqueness, so a slug edit fails with a 500 instead of the "already taken" error

- **Severity**: low
- **Confidence**: high (verified by reading)
- **Where**: `src/lib/admin-content.ts:96-101` (update) vs `:105-110` (create guard)
- **Code**:
```ts
if (id) {
  const { error } = await supabase.from("blog_posts").update(payload).eq("id", id);
  if (error) throw error;
  ...
  return id;
}
// A duplicate slug must be a clear error, not a silent second row: …
const { data: existing } = await supabase.from("blog_posts").select("id").eq("slug", slug).maybeSingle();
if (existing) throw new Error(`slug "${slug}" is already taken`);
```
- **Why it is wrong**: the duplicate-slug guard the comment describes exists only on the create
  path. Editing a post and changing its slug to an existing one runs `update(...).eq("id", id)`
  straight into the `slug` unique constraint; the thrown Postgres error ("duplicate key value
  violates unique constraint …") does not match `adminAction`'s 400-message regex
  (`admin-route.ts:35`), so the panel shows the generic 500/internal failure rather than
  "slug already taken". (The `id` branch also never verifies the post exists, so a stale id updates
  zero rows and still returns success.)
- **How to reproduce**: by inspection — open two posts, set the second's slug to the first's, Save.
- **Suspected cause**: uniqueness validation is only on the insert branch.

## B7 — An admin-created post can occupy a future auto-drop-post slug and silently suppress that drop post

- **Severity**: low
- **Confidence**: medium (verified by reading; requires the admin to use the `drop-…` pattern)
- **Where**: `src/lib/blog.ts:30-58`; `src/lib/admin-content.ts:105-117`
- **Code**:
```ts
const { error } = await supabase.from("blog_posts").upsert(
  { slug: `drop-${badge.slug}`, … },
  { onConflict: "slug", ignoreDuplicates: true },
);
```
- **Why it is wrong**: `createDropPost` inserts with `ignoreDuplicates: true`, so if a row already
  exists with slug `drop-<badgeSlug>` it does nothing and reports no error (a warning is logged only
  when `error` is truthy — a duplicate that is ignored is not an error). The admin create path only
  refuses a slug that *already* exists, so an editor can create a post whose slug equals the
  deterministic drop slug of a badge that will be added later; when that badge is first synced, its
  automatic drop post is never published and nothing signals why. (The create path is also
  check-then-insert, not atomic, so two concurrent saves of the same slug race into a 500.)
- **How to reproduce**: by inspection — create a post with slug `drop-<setId>-v1` for a badge not yet
  in the catalog, then let the sync add that badge.
- **Suspected cause**: reserved `drop-*` slugs are not claimed by the admin create path.

## B8 — GET `limit`/`offset` parsed with `Number()` without a finite check

- **Severity**: low
- **Confidence**: medium (unverified end-to-end — did not exercise against PostgREST)
- **Where**: `src/app/api/admin/content/route.ts:34,42,50,51`; `src/lib/admin-content.ts:43,144-145,225-226`
- **Code**:
```ts
return await listBlogPosts({
  limit: Number(url.searchParams.get("limit") ?? 20),
  offset: Number(url.searchParams.get("offset") ?? 0),
  ...
});
```
- **Why it is wrong**: a non-numeric `?limit=abc` yields `NaN`; `Math.min(Math.max(NaN, 1), 100)`
  is `NaN` (the `?? 20` only covers `null`/`undefined`), so `.range(NaN, NaN)` is sent and the
  PostgREST error is thrown as a 500 rather than a 400. Admin-only and not reachable from the
  shipped panel (it sends literal `20`/`25`), so impact is low.
- **How to reproduce**: `GET /api/admin/content?resource=blog&limit=abc` as an admin.
- **Suspected cause**: `Number()` without `Number.isFinite`.

## B9 — Markdown links accept any URL scheme (`javascript:`) — informational

- **Severity**: low
- **Confidence**: high (verified by reading); impact limited because only admins author posts
- **Where**: `src/lib/markdown.ts:13-16`
- **Code**:
```ts
.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" rel="noopener noreferrer">$1</a>');
```
- **Why it is wrong**: `renderMarkdown` correctly HTML-escapes first, so there is no markup
  injection, but the link target is inserted verbatim and not scheme-checked; a post body containing
  `[click](javascript:alert(1))` renders a clickable `javascript:` link. The author is an
  authenticated admin and the auto-generated drop posts only place external badge text in
  bold/code spans (never in a link target), so this is not a cross-trust-boundary escalation — noted
  only because the task asked whether a Markdown field is rendered unsanitised downstream.
- **How to reproduce**: by inspection — enter such a link in the blog content textarea and open the
  published post.
- **Suspected cause**: no allow-list of `http(s):`/relative schemes for the href.

## Checked and found clean (so "nothing" is meaningful)

- **catalogue protection**: the sweep skips `source === "custom"` (`global.ts:269`) and
  `incomingLive` filters custom keys (`:96-98`); a custom row cannot be overwritten by the upsert
  loop because it is excluded from `incomingLive`, and a colliding provider badge is refused on
  create (`admin-content.ts:304-314`). The one way through is B1.
- **`category = "status"` refusal**: applied before both create and update (`admin-content.ts:262`),
  and the panels restrict the category/status selects to the allowed values.
- **datetime-local round-trip**: `toLocalInput` (`BadgesPanel.tsx:51-57`) reads local components and
  the onChange parses a time-bearing value (interpreted as local) back through `toISOString()`, so
  the value round-trips without a timezone shift (only sub-minute precision is dropped).
- **HTML/Markdown injection**: blog content is escaped by `renderMarkdown`; badge `description` /
  `how_to_earn` and changelog `body` are rendered as React text; all JSON-LD goes through
  `jsonLdScript`, which escapes `<`/`>`/`&` and the line separators.
- **i18n**: every `admin.content.*` and `admin.badges.*` key used by both panels exists in all
  eleven `messages/*.json` (machine-checked).
- **Authorization**: every GET/POST branch sits behind `adminAction` → `requireAdmin()` (bootstrap is
  denied for this route); no service-role import from the client components.
- **`audit` failures**: swallowed by design (`admin.ts:198-217`), so a mutation is not reported as
  failed because of an audit write.
- **`deleteBlogPost` / `deleteChangelog`**: no dependent tables (`badge_events` / `badge_stats` /
  `user_inventory` all cascade from `badges`; `blog_posts` and `changelog` have none), so no
  orphans; deleting an auto post is a deliberate admin capability, not a defect.
