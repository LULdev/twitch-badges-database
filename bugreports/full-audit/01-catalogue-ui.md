# Public catalogue surface (client-side)

Audited: `src/app/[locale]/page.tsx`, `src/app/[locale]/badges/page.tsx`,
`src/app/[locale]/active/page.tsx`, `src/app/[locale]/upcoming/page.tsx`,
`src/app/[locale]/expired/page.tsx`, `src/components/badges/{BadgeExplorer,
FilterBar,BadgeCard,BadgeGrid,BadgeImage,Countdown,Pagination,RarityChip}.tsx`,
`src/lib/queries.ts` (the read paths these pages use), `src/lib/rarity.ts`,
`src/i18n/navigation.ts`, `src/components/LiveRefresher.tsx`.

Method: source read; `npx tsc --noEmit` (clean); `npx eslint` on the whole scope
(clean); read-only `SELECT`s against the live DB via the pooler; read-only
PostgREST probes with the publishable key; `curl` of the live production site
(`twitch-badges-database.vercel.app`); a mechanical 11-locale key/placeholder
check for every message key this surface uses. I could not run `next build`
(15 static workers, memory-bound on this box), so no conclusion rests on build
output.

Prior rounds: `cat-1`…`cat-9` (agent-07) are all recorded as fixed in
`bugreports/AGENT-AUDIT.md` and were **not** re-reported; I verified the fixes
are present (`loadFailed` state, page clamp, sort-does-not-filter,
`alt=""`, `key={current.q}`, `aria-pressed`, `first_seen_at <= now`,
skip-related-without-category) and hunted only beyond them.

---

## B1 — `/active` and `/upcoming` display the wrong active sort in the filter bar

- **Severity**: medium
- **Confidence**: high (verified on the live site)
- **Where**: `src/components/badges/BadgeExplorer.tsx:42` vs
  `src/components/badges/FilterBar.tsx:50` (and the pages
  `src/app/[locale]/active/page.tsx:42`, `src/app/[locale]/upcoming/page.tsx:42`)
- **Code**:
  ```tsx
  // BadgeExplorer.tsx — the query's sort
  sort: searchParams.sort ?? defaultSort,          // /active → "ending"

  // BadgeExplorer.tsx:68 — defaultSort is NOT forwarded to the control
  <FilterBar categories={categories} statusLocked={statusLocked} showStatus={!statusLocked} />

  // FilterBar.tsx:50 — the control's sort
  sort: params.get("sort") ?? "newest",            // no param → "newest"
  ```
- **Why it is wrong**: `/active` defaults to `sort: "ending"` and `/upcoming` to
  `"releasing"`, but `FilterBar` only reads the URL, so with no `?sort=` it
  renders "Newest" as the selected option while the grid is ordered by
  `end_date` / `start_date`. The control contradicts the data it labels — the
  page and the query disagree.
- **How to reproduce** (live, verified):
  - `curl /en/active` → first tile `resonance-minotaur-v1`; the Sort `<select>`
    renders `<option value="newest" selected="">Newest`.
  - `curl /en/active` and `curl /en/active?sort=ending` produce the **same**
    first four tiles; `curl /en/active?sort=newest` produces a different set.
    So the applied sort is `ending` while the UI says `newest`.
  - Same for `/en/upcoming`: default order == `?sort=releasing`, control says
    "Newest".
- **Suspected cause**: `FilterBar` has no `defaultSort` prop, so it cannot know
  the page's default; it hardcodes `"newest"` as its fallback.

---

## B2 — a filter that matches nothing plus `?page=2` renders "catalog could not be loaded" instead of the empty state

- **Severity**: medium
- **Confidence**: high (verified on the live site)
- **Where**: `src/lib/queries.ts:214-226` (reached from
  `src/components/badges/BadgeExplorer.tsx:54`)
- **Code**:
  ```ts
  if (error) {
    if (page > 1) {
      const first = await listBadges({ ...filters, page: 1 });
      if (first.total > 0) {                       // ← only recovers if the set is non-empty
        return listBadges({ ...filters, page: Math.min(page, first.pages) });
      }
    }
    throw error;                                   // 0 matches → the error escapes
  }
  ```
- **Why it is wrong**: PostgREST answers a window past the end of the resource
  with 416, which lands in this branch. When the *filtered set is empty*,
  `first.total === 0`, the recovery is skipped and the raw range error is
  re-thrown — so `BadgeExplorer` shows `badges.loadFailed` ("The catalog could
  not be loaded right now. Please try again in a moment.") for a URL that is
  merely empty, not broken. The correct answer is the `badges.empty` card that
  the same URL shows on page 1.
- **How to reproduce** (live, verified):
  - `/en/badges?q=zzzzzznope` → "0 badges found" + "No badges match these
    filters." (correct)
  - `/en/badges?q=zzzzzznope&page=2` → the danger card "The catalog could not be
    loaded right now." (wrong)
  - `/en/badges?status=bogus&page=3` → same wrong error card.
  - Control: `/en/upcoming?page=9` (set non-empty) correctly recovers to 18
    badges — the failure is specific to a zero-result set with `page > 1`.
- **Suspected cause**: the empty-set case is not distinguished from a genuine
  range failure before the error is re-thrown.

---

## B3 — `listBadges`' error path can re-issue the identical failing request forever

- **Severity**: medium
- **Confidence**: medium — the unbounded loop is by inspection; I could not
  provoke a persistent non-first-page error against the live data, so I cannot
  show the hang end-to-end.
- **Where**: `src/lib/queries.ts:219-224`
- **Code**:
  ```ts
  if (page > 1) {
    const first = await listBadges({ ...filters, page: 1 });
    if (first.total > 0) {
      return listBadges({ ...filters, page: Math.min(page, first.pages) });
    }
  }
  ```
- **Why it is wrong**: the retry target is `Math.min(page, first.pages)`. When
  the request failed for a reason **other than** "past the end" (a pooler
  hiccup, an 8 s statement timeout on a slow `ilike` at that offset, a transient
  5xx) and `page <= first.pages`, the retry is the **same page number** — the
  exact request that just failed. Nothing bounds the recursion, so a
  persistently failing non-first page is retried indefinitely (two DB round
  trips per level) until the function's time limit kills the render. The
  documented termination argument ("the recursion terminates because `pages <=
  page` there", `queries.ts:236`) only holds for the 416 case.
- **How to reproduce**: by inspection. The loop is only reachable when a request
  for `page > 1` errors while the page-1 request succeeds; with the current 476
  rows and 10 pages I could not produce that state.
- **Suspected cause**: an unconditional `throw`/retry branch that assumes every
  range error is a 416.

---

## B4 — every catalogue sort orders on a column with huge tie groups and no tie-break, so pagination is unstable

- **Severity**: low
- **Confidence**: medium — the tie groups are measured on the live DB; the
  resulting duplicate/omitted rows are latent (I could not make the live site
  drift, because the table is static between syncs).
- **Where**: `src/lib/queries.ts:180-208` (all `order(...)` calls; contrast with
  `getCatalogKeys`, `src/lib/queries.ts:540-541`, which *does* add an `id`
  tiebreak for exactly this reason)
- **Code**:
  ```ts
  default:
    query = query.order("first_seen_at", { ascending: false });   // no id tiebreak
  ...
  query = query.range((page - 1) * perPage, page * perPage - 1);
  ```
- **Why it is wrong**: the omnipresent sorts are almost entirely ties, so the
  window boundary is undefined. Measured live:
  `first_seen_at` has **3 distinct values for 476 rows — 471 share one
  timestamp** (the default `newest`/`oldest` sort, i.e. `/badges`, `/expired`,
  home); `end_date` has 23 distinct values and one group of 437 (the `ending`
  sort that is `/active`'s default); `rarity_score` has 49 distinct values with
  a 163-row group at 0. Postgres is free to reorder equal keys (any UPDATE
  moves the tuple, autovacuum, or a different plan), and when it does, a page-2
  request repeats rows already on page 1 and drops others — 10 consecutive
  pages are currently one tie group. `getCatalogKeys` guards this; `listBadges`
  does not.
- **How to reproduce**: by inspection + DB evidence. `select
  count(*) total, count(distinct first_seen_at) distinct from badges` → 476 /
  3. Currently the live site returns stable windows (`page1 ∩ page2 = ∅` over
  four consecutive probes), so the defect is latent, not presently visible.
- **Suspected cause**: offset pagination over a non-unique sort key with no
  deterministic secondary key.

---

## B5 — repeated query params reach the query as arrays: `?q=a&q=b` shows the load-error card, others silently show 0 results

- **Severity**: low
- **Confidence**: high (verified on the live site)
- **Where**: `src/components/badges/BadgeExplorer.tsx:7-15` (`ExplorerSearchParams`
  types every param as `string`, but Next 16 hands back `string | string[]`),
  consumed at `:36-44`; the throw happens in `src/lib/queries.ts:145-148`
- **Code**:
  ```ts
  // BadgeExplorer.tsx
  export interface ExplorerSearchParams { q?: string; status?: string; /* … */ }
  const filters: ListFilters = { q: searchParams.q, /* … */ };   // may be ["a","b"]

  // queries.ts
  function sanitizeQuery(q: string): string {
    return q.replace(/[,()%]/g, " ").trim();   // Array has no .replace → TypeError
  }
  ```
- **Why it is wrong**: `?q=a&q=b` makes `searchParams.q` an array; `sanitizeQuery`
  throws synchronously inside `listBadges`, the `Promise.all` in `BadgeExplorer`
  rejects, and the page renders the "catalog could not be loaded" card. The
  other repeated params do not throw but are equally unvalidated: `?category=`
  / `?rarity=` / `?status=` arrays are passed to `.eq(...)` and match nothing
  (0 results), and `?price=free&price=paid` matches neither branch so **all 476
  rows** are returned unfiltered.
- **How to reproduce** (live, verified):
  - `/en/badges?q=diablo&q=marvel` → danger card "The catalog could not be
    loaded right now."
  - `/en/badges?category=bits&category=events` → "0 badges found"
  - `/en/badges?rarity=rare&rarity=epic` → "0 badges found"
  - `/en/badges?price=free&price=paid` → "476 badges found" (filter ignored)
- **Suspected cause**: no per-param normalisation (`Array.isArray(v) ? v[0] : v`)
  between `searchParams` and `ListFilters`.

---

## B6 — the home page's Changelog and Blog "view all" links have no accessible name

- **Severity**: low
- **Confidence**: high (verified in the live HTML)
- **Where**: `src/app/[locale]/page.tsx:130-132` and `:153-155`
- **Code**:
  ```tsx
  <Link href="/changelog" className="text-xs font-semibold text-accent hover:underline">
    <span className="dir-arrow" aria-hidden>→</span>
  </Link>
  ```
- **Why it is wrong**: the link's only child is `aria-hidden`, so it has an empty
  accessible name — a screen reader announces just "link" with no destination.
  The four sibling sections (Ending soon / Upcoming / Newest / Rarest) include
  `{tc("viewAll")}` text; these two were missed. WCAG 2.4.4 / 4.1.2.
- **How to reproduce** (live, verified): `curl /en` and compare —
  `<a href="/en/changelog"><span class="dir-arrow" aria-hidden="true">→</span></a>`
  vs `<a href="/en/active?sort=ending">View all<!-- --> <span …>→</span></a>`.
  Same for `/en/blog`.
- **Suspected cause**: the "from changelog"/"from blog" headers were written
  without the `viewAll` label the other four use.

---

## B7 — `getCategories()` is an unbounded select, so it truncates at PostgREST's 1000-row cap; and its failure blanks the whole catalogue

- **Severity**: low
- **Confidence**: medium — the 1000-row cap is verified against this project's
  own API; the truncation itself is latent (476 badges today).
- **Where**: `src/lib/queries.ts:383-391`, bundled at
  `src/components/badges/BadgeExplorer.tsx:49-59`
- **Code**:
  ```ts
  export async function getCategories(): Promise<string[]> {
    const supabase = await createClient();
    const { data } = await supabase.from("badges").select("category").order("category");
    // no .range() / no paging → first 1000 rows only
    const set = new Set((data ?? []).map((row) => row.category as string));
  ```
  ```tsx
  [result, categories] = await Promise.all([ listBadges(filters), getCategories() ]);
  ```
  (two effects, same root: the helper is treated as infallible and exhaustive)
- **Why it is wrong**:
  1. **Silent truncation**: PostgREST caps a single response at 1000 rows —
     verified live: `/rest/v1/badge_stats?select=id` with `Range: 0-4999`
     returns 1000 rows and `content-range: 0-999/7829`. `getCatalogKeys`
     (`queries.ts:527-549`) pages around this cap for exactly this reason
     ("PostgREST caps a single response at 1000 rows, so this silently returned
     a truncated catalog"), but `getCategories` does not. Once the catalogue
     passes 1000 badges, the alphabetically-late categories disappear from the
     Category dropdown, and no error is raised anywhere.
  2. **Bundled failure**: `getCategories` sits in the same `Promise.all` as
     `listBadges`, so if the *categories* query alone fails, the assignment never
     happens, `result` stays `null`, and the explorer hides a perfectly good
     result set behind the load-error card.
- **How to reproduce**: (1) by inspection + the verified cap; (2) by inspection —
  one rejected promise discards the other's value.
- **Suspected cause**: an unbounded `select` reused from the pre-1000-row era,
  and a shared try/catch that cannot tell which of the two calls failed.

---

## B8 — unknown `?sort=` / `?category=` / `?rarity=` leave the matching `<select>` with no selected option (blank control)

- **Severity**: low
- **Confidence**: medium — verified in the shipped HTML (the `selected`
  attribute is absent); the blank appearance depends on the browser's
  `selectedIndex = -1` behaviour, which I did not drive in a browser.
- **Where**: `src/components/badges/FilterBar.tsx:44-51` (values read straight
  from the URL are handed to `value=`) and `:173-186` (the sort `<select>`)
- **Code**:
  ```tsx
  const current = { sort: params.get("sort") ?? "newest", /* … */ };
  ...
  <select value={current.sort} onChange={…}>
    <option value="newest">…</option>   // no option matches "bogus"
  ```
- **Why it is wrong**: `?sort=bogus` (or a stale `?category=`/`?rarity=`) is not
  validated against the option allowlist, so the controlled `<select>` has a
  value with no matching `<option>`; React ends with `selectedIndex = -1` and the
  control renders empty, while `listBadges` silently falls back to `newest`
  (`queries.ts:206-207`) — an empty control over a list it does not describe.
- **How to reproduce** (live, verified): `curl /en/badges?sort=bogus` — the
  Category and Rarity selects carry `selected=""` on their `all` options, the
  Sort select carries **no** `selected` attribute at all. Also
  `/en/badges?rarity=bogus&category=bogus` leaves both of those blank.
- **Suspected cause**: URL values are passed to `value=` without checking them
  against `statusOptions`/`priceOptions`/`RARITY_TIERS`/`SortKey`.

---

## Checked and found clean

So that "nothing" means something, these were verified and are **not** defects:

- **i18n (mechanically)**: every key this surface uses exists in all 11
  `messages/*.json` — `badges.{title,subtitle,activeTitle,activeSubtitle,
  upcomingTitle,upcomingSubtitle,expiredTitle,expiredSubtitle,results,empty,
  loadFailed,owners}`, `common.{filterStatus,filterPrice,search,category,rarity,
  sort,all,free,paid,active,upcoming,expired,removed,newest,oldest,rarest,
  mostOwned,endingSoon,releasingSoon,name,clear,page,prev,next,viewAll,setupHint}`,
  `home.*` (16 keys), `rarity.{common,uncommon,rare,epic,legendary,mythic}`,
  `countdown.*`. Placeholders match (`{count}` plural in `badges.results`,
  `{page}`/`{pages}` in `common.page`). The four countdown unit labels are
  distinct in every locale (no React-key collision in `Countdown.tsx:76`).
- **Countdown arithmetic**: `Math.max(0, …)` clamp, `days/hours/min/sec`
  decomposition, UTC-agnostic `new Date(target).getTime()`, server/client
  agreement via `useState<number|null>(null)` + `requestAnimationFrame`
  (`Countdown.tsx:35-51`) — no hydration drift, no negative/NaN path for
  well-formed dates. Live data has no status/date divergence (0 active with a
  past `end_date`, 0 upcoming with a past `start_date`), so the `mode="starts"`
  "00:00:00 forever" case is unreachable today.
- **Live schema vs `BadgeRow`** (`queries.ts:3-39`): every column the type (and
  the render path) declares exists on `public.badges` (verified column by
  column); `owner_count`/`active_count`/`percentage` arrive as JSON numbers, not
  strings, so `formatCompact` (`BadgeCard.tsx:13-23`) cannot fall into its
  `—` branch. `rarity_tier`/`status`/`category` values in the DB are all inside
  the declared unions (no tier that would miss a `t(tier)` key); no null/empty
  `slug`/`title`/`first_seen_at`; no empty-string image URL (so the
  `?? `-vs-`""` chain in `BadgeImage.tsx:25-26` is not currently masking a valid
  fallback).
- **Search-filter robustness**: 17 hostile `q` values through the live endpoint
  (backslash, `"`, `*`, `(`/`)`, `,`, `%`, `|`, `:`, `/`, `[`, accents,
  whitespace) produced **no** error card and no filter breakout — only
  over-matching for `_`/`*`, which is the already-open `L11` finding (LIKE
  wildcards not escaped) and is not re-reported here.
- **Rendering/hydration**: no `Date.now()`/locale formatting in a client
  component on this surface (`BadgeCard`/`RarityChip`/`Pagination` are server
  components; `Countdown` defers to `requestAnimationFrame`); every mapped list
  has a stable key (`badge.id`, `p`, `option.value`, `unit.label`, `post.id`,
  `entry.id`, `stat.label`); `useSearchParams()` sits in a dynamically rendered
  route (the pages `await searchParams`), so no Suspense bailout.
- **Fixes from earlier rounds present and effective**: page clamping
  (`queries.ts:234-245` — `/en/upcoming?page=9` serves page 1, `/en/badges`
  serves the last page), the distinct `loadFailed` card, `alt=""` on tiles,
  `key={current.q}` on the search box, `aria-pressed` + distinct group labels on
  the chips, `first_seen_at <= now` on the NEW marker.
