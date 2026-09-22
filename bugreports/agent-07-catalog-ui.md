# Bug report — agent-07 "catalog-ui"

Scope: badge catalog UI (BadgeCard/Grid/Image, Countdown, FilterBar, Pagination,
RarityChip, BadgeExplorer, the four catalog pages, OwnersChart).
Method: source read + read-only curl of the public production site (2026-09-22).

## cat-1: Catalog explorer swallows every DB error and shows "catalog is empty / run the sync"
- **Severity**: high
- **Side**: server
- **File**: src/components/badges/BadgeExplorer.tsx:46-55
- **Evidence**:
  ```ts
  try {
    [result, categories] = await Promise.all([ listBadges(filters), getCategories() ]);
  } catch {
    // DB not ready
  }
  ```
  `curl -s "https://twitch-badges-database.vercel.app/en/badges?page=9999"` returns
  `card p-10 ... "The catalog is empty. Run the sync scripts or wait for the next cron run to populate it."`
  (that string is `common.setupHint`, messages/en.json:77 — the `result === null` branch),
  while `?page=2` returns `475 badges found` (messages/en.json:60 `badges.results`).
- **Why it is a bug**: Any transient PostgREST/Supabase failure (or a page beyond
  the result window, which PostgREST answers with 416) is indistinguishable from
  an un-provisioned DB. The user sees "run the sync scripts" instead of the real
  error; no results, no pagination, no retry affordance. Operators lose the signal
  too because nothing is logged.
- **Confidence**: confirmed
- **Fix direction**: Log the caught error and render an error/empty state that
  distinguishes "DB error" from "no rows"; or let the error propagate to the
  route's error boundary.

## cat-2: Out-of-range `?page=` is not clamped → dead-end empty page with no pagination
- **Severity**: medium
- **Side**: shared
- **File**: src/lib/queries.ts:153,208-219 invoked from src/components/badges/BadgeExplorer.tsx:43 (`page`)
- **Evidence**: `listBadges` clamps only the low end: `const page = Math.max(filters.page ?? 1, 1);`
  then `query.range((page - 1) * perPage, page * perPage - 1)`. With 475 rows, 48/page
  (10 pages) and `?page=9999`, the range offset (479,904) is past the resource, the
  request fails (PostgREST 416) → caught by cat-1 → `result === null` → curl shows
  only the setup hint and `page=9999` in the URL, no tiles and no `<nav>` pagination.
- **Why it is a bug**: A shared/old/stale link (or a `page` beyond the current total)
  renders nothing and offers no way back to the catalog instead of clamping to the
  last page or redirecting to page 1.
- **Confidence**: confirmed
- **Fix direction**: Clamp `page` to `Math.min(page, pages)` after computing `count`
  (or `if (page > pages) return last/empty page 1`) and re-render Pagination.

## cat-3: `/active` hides every active badge that has no `end_date`
- **Severity**: high
- **Side**: server
- **File**: src/app/[locale]/active/page.tsx:37 → src/lib/queries.ts:191-195
- **Evidence**: `defaultSort="ending"` becomes `filters.sort = "ending"`, and
  `case "ending": query = query.not("end_date","is",null).order("end_date", …)`.
  Every other sort has no such filter.
- **Why it is a bug**: The `/active` page's default sort silently *filters* the
  dataset: any badge with `status='active'` but `end_date IS NULL` (evergreen/
  permanent activations) is excluded from both the grid and the `count`,
  under-reporting "active" badges on the page that exists to list them. Sorting
  should not change membership.
- **Confidence**: likely (filter effect is code-confirmed; no DB row inspected)
- **Fix direction**: Order by `end_date` with `nullsFirst:false` instead of
  `.not("end_date","is",null)` so null-end badges sort last but still appear.

## cat-4: Transient DB error on a badge detail URL yields a wrong 404
- **Severity**: medium
- **Side**: server
- **File**: src/app/[locale]/badges/[slug]/page.tsx:71-72
- **Evidence**: `const badge = await getBadgeBySlug(slug).catch(() => null); if (!badge) notFound();`
- **Why it is a bug**: A genuine query failure (network/pooler hiccup, timeout)
  is treated identically to "no such slug" and returns a 404. Search engines and
  users drop a permanently valid badge page, and the real error is invisible.
- **Confidence**: likely
- **Fix direction**: Let real query errors throw (or check the error kind) and
  reserve `notFound()` for a returned `null` row.

## cat-5: "Clear" does not clear the search box (uncontrolled input)
- **Severity**: low
- **Side**: client
- **File**: src/components/badges/FilterBar.tsx:98, 182-191
- **Evidence**: `<input type="search" name="q" defaultValue={current.q} … />` is
  uncontrolled; the clear button calls `navigate({ q: null, … })` which only
  rewrites the URL. React keeps the existing `<input>` DOM node, so `defaultValue`
  is never re-applied.
- **Why it is a bug**: After typing a query and clicking "Clear" (or using the
  browser back button), the URL says no `q` while the box still shows the old
  search text — the visible state contradicts the results.
- **Confidence**: confirmed
- **Fix direction**: Make the input controlled (`value`/`onChange` synced to the
  URL) or key it on `current.q` so it remounts, or clear the input ref on navigate.

## cat-6: Filter toggle chips expose no selected state to assistive tech
- **Severity**: low
- **Side**: client
- **File**: src/components/badges/FilterBar.tsx:106,120 (`role="group" aria-label={t("filters")}`)
- **Evidence**: Both the status and price button groups use the identical
  `aria-label="Filters"`, and the selected chip is conveyed only by the
  `chip-active` CSS class (no `aria-pressed`/`aria-current`).
- **Why it is a bug**: Screen-reader users hear two identically named groups and
  cannot tell which status/price filter is active, unlike the `<select>`s which
  are labelled individually.
- **Confidence**: confirmed
- **Fix direction**: Give each group a distinct label (status/price) and add
  `aria-pressed={current.status === option.value}` to the chips.

## cat-7: "NEW" marker has no lower bound on `first_seen_at`
- **Severity**: low
- **Side**: server
- **File**: src/components/badges/BadgeCard.tsx:56-61
- **Evidence**: `now - new Date(badge.first_seen_at).getTime() < 14 * 86_400_000`
- **Why it is a bug**: The comparison is only one-sided. A future-dated
  `first_seen_at` (clock skew, a mis-parsed badgebase timestamp) makes the
  difference negative and permanently `< 14d`, so the badge is flagged NEW for
  ~14 days past a date that has not even occurred yet.
- **Confidence**: likely
- **Fix direction**: Require `first_seen_at <= now && now - first_seen_at < 14d`.

## cat-8: Related-badges fallback shows unrelated badges under "Same category"
- **Severity**: low
- **Side**: server
- **File**: src/app/[locale]/badges/[slug]/page.tsx:76,284-289
- **Evidence**: `listBadges({ category: badge.category, perPage: 7 })` — in
  queries.ts:170-172 the category filter is skipped when `category` is falsy, so a
  null-category badge gets the global newest list, labelled
  `t("sameCategory", { category: badge.category })`.
- **Why it is a bug**: For a badge whose category is null/empty the section claims
  "same category" while listing arbitrary newest badges.
- **Confidence**: likely
- **Fix direction**: Skip the related section (or label it "related badges") when
  `badge.category` is falsy.

## cat-9: Badge tile image alt duplicates the visible title
- **Severity**: low
- **Side**: client
- **File**: src/components/badges/BadgeImage.tsx:39 (`alt={badge.title}`)
- **Evidence**: `BadgeCard` renders the image and then the same
  `{badge.title}` as text inside one `<Link>` (BadgeCard.tsx:55,66); the tile is
  effectively a single link whose accessible name repeats the title twice.
- **Why it is a bug**: Screen readers announce the badge name twice per tile;
  the image is decorative here and should be hidden.
- **Confidence**: confirmed
- **Fix direction**: Use `alt=""` (aria-hidden) in card/tile contexts, or add an
  `alt` prop so the detail hero keeps a meaningful description.

Checked and found clean: Countdown hydration parity (server renders "— : — : —",
`Math.max(0,…)` prevents negatives; no mismatch), Countdown negative/NaN for
well-formed dates, duplicate React keys (BadgeGrid `badge.id`, Pagination `p`,
Countdown unit labels — all unique), `useSearchParams()` (FilterBar sits inside
pages that read `await searchParams`, i.e. dynamically rendered, and production
`?page=2` renders fine — no Suspense bailout observed), relative `?page=` pagination
hrefs (production emits working `href="?page=3"`), BadgeImage null-src placeholder,
OwnersChart null handling and `<2`-point guard.