# Agent 20 — remaining pages (blog, changelog, faq, compare, leaderboards, achievements, games, inventory, wheel, feed, 404)

Scope: `src/app/[locale]/{blog,blog/[slug],changelog,faq,compare,leaderboards,achievements,games,games/[game],inventory,wheel,feed,not-found}.tsx`,
`src/lib/blog.ts`, `src/lib/changelog.ts`, `src/components/EmojiReactions.tsx`,
`src/components/compare/CompareForm.tsx`, `src/components/inventory/SyncButton.tsx`.
Already-fixed items (per lead) not re-reported. i18n key parity was checked for all 11
locales across the `blog, changelog, faq, compare, leaderboards, achievements, games,
inventory, wheel, feed, common, meta` namespaces — no missing keys found.

## pg-1: Blog post reactions are counted globally across every post (missing `post_id` filter)

- **Severity**: high
- **Side**: server
- **File**: `src/app/[locale]/blog/[slug]/page.tsx:63`
- **Evidence**:
  ```ts
  const [viewsRes, reactionsRes] = await Promise.all([
    admin.from("blog_views").select("id", { count: "exact", head: true }).eq("post_id", post.id),
    admin.from("blog_reactions").select("emoji"),     // <- no .eq("post_id", post.id)
  ]);
  ```
  The table is per-post (`supabase/migrations/0003_gamification.sql:120-128`:
  `post_id uuid not null references public.blog_posts (id) … unique (post_id, ip_hash, emoji)`).
  Production confirms the effect — three different posts return identical counts:
  ```
  /en/blog/badge-quiz                      -> like 0, love 1, laugh 0, fire 1, wow 0
  /en/blog/badge-memory                    -> like 0, love 1, laugh 0, fire 1, wow 0
  /en/blog/achievements-system-125-trophies-> like 0, love 1, laugh 0, fire 1, wow 0
  ```
- **Why it is a bug**: every post shows the site-wide reaction total, not its own. A post with
  zero reactions shows `1`, and a reaction added on one post appears on all of them. The query is
  also unbounded, so PostgREST's default row cap (1000) silently truncates the counts as the table
  grows, and the service-role client makes the whole `blog_reactions` table part of this page's data.
- **Confidence**: confirmed (code + schema + production output)
- **Fix direction**: add `.eq("post_id", post.id)` to the `blog_reactions` select (and rely on
  `head: true`/count or an aggregate rather than pulling every row).

## pg-2: Reaction button decrements on any error response

- **Severity**: medium
- **Side**: client
- **File**: `src/components/EmojiReactions.tsx:32-47`
- **Evidence**:
  ```ts
  const res = await fetch("/api/blog/react", { method: "POST", … });
  const data = (await res.json()) as { added?: boolean; removed?: boolean };
  setCounts((prev) => ({ ...prev, [emoji]: Math.max(0, (prev[emoji] ?? 0) + (data.added ? 1 : -1)) }));
  ```
  `res.ok` is never checked, and every failure branch of the route returns a body without
  `added` — `{ error: "invalid payload" }` 400, `{ error: "post not found" }` 404,
  `{ error: error.message }` 500 (`src/app/api/blog/react/route.ts`).
- **Why it is a bug**: a 404/500 (or a rate-limited/HTML error body that still parses) is treated as
  a removal: the displayed count goes *down* and the chip is flipped to the "active" state for a
  reaction that was never recorded. Repeated failures drive the count to 0 permanently for that
  visitor. Only a rejected `fetch` (network error) is handled.
- **Confidence**: confirmed
- **Fix direction**: bail out unless `res.ok`, and apply `data.added ? +1 : data.removed ? -1 : 0`.

## pg-3: Inventory page has hardcoded English copy that bypasses the message files

- **Severity**: medium
- **Side**: server
- **File**: `src/app/[locale]/inventory/page.tsx:164-169`
- **Evidence**:
  ```tsx
  {totalCatalog > ownedIds.size + missingBadges.length && (
    <p className="mt-3 text-center text-xs text-muted">
      +{totalCatalog - ownedIds.size - missingBadges.length} more —
      sorted by rarity
    </p>
  )}
  ```
  `messages/*.json` `inventory` has 15 keys (title, subtitle, owned, missing, sync, syncing,
  synced, syncFailed, lastSync, neverSynced, loginRequired, progress, emptyOwned, emptyMissing,
  channelNote) — none of them covers this line.
- **Why it is a bug**: on all 10 non-English locales this sentence renders in English next to
  translated content, breaking the i18n convention that *all* UI strings come from
  `messages/<locale>.json` (`AGENTS.md` Conventions). It cannot be translated without a code change.
- **Confidence**: confirmed
- **Fix direction**: add an ICU key (e.g. `inventory.moreRarity` with `{count}`) to all 11 message
  files and render it via `t("moreRarity", { count: … })`.

## pg-4: Changelog accepts any `?kind=` value and answers with the "no data" empty state

- **Severity**: low
- **Side**: server
- **File**: `src/app/[locale]/changelog/page.tsx:46-47`, `src/lib/queries.ts:472-485`
- **Evidence**:
  ```ts
  const kind = sp.kind;                            // no allowlist check
  const entries = await listChangelog(kind, 150).catch(() => []);
  // queries.ts: `if (kind && kind !== "all") query = query.eq("kind", kind);`
  ```
  `curl -s -o /dev/null -w "%{http_code}" "…/en/changelog?kind=bogus"` → `200`, and the body contains
  `card p-10 text-center text-sm text-muted">No entries yet.</div>`.
- **Why it is a bug**: an unvalidated/typo'd/malicious filter does not produce an empty *filter*
  state ("nothing matches") but the generic "No entries yet" message, which asserts the changelog
  itself is empty. Combined with the chip group, where no chip is highlighted because `kind`
  matches none of the seven values, a user who follows a stale/hand-edited link concludes the
  changelog feed is broken. The same `.catch(() => [])` also renders DB failures as "empty".
- **Confidence**: confirmed
- **Fix direction**: validate `kind` against the same `kinds` list before querying (otherwise treat
  it as `all`), and use a distinct "no entries for this filter" message.

## pg-5: `/games/quiz` renders a blank body when the badge pool is too small or the query fails

- **Severity**: low
- **Side**: server
- **File**: `src/app/[locale]/games/[game]/page.tsx:60-72, 91`
- **Evidence**:
  ```tsx
  {game === "quiz" && quizBadges.length >= 4 && <QuizGame badges={quizBadges} />}
  ```
  `quizBadges` is filtered to rows that have an image (`:71`) and comes from an unguarded query
  (`:64-68`, no `.catch`, so a Supabase error yields `data: null` → empty array).
- **Why it is a bug**: for the quiz page the header renders and then nothing — no game, no message,
  no disabled state. A logged-in user on a fresh/un-migrated catalog (or after a query error) sees a
  page that looks broken rather than an explanatory empty state, unlike every other game page which
  always renders its component.
- **Confidence**: likely (depends on the live catalog having <4 image-bearing rows or a query error)
- **Fix direction**: render an explicit "not enough badges to play yet" card instead of an empty
  fallback condition, and wrap the query in `.catch(() => ({ data: null }))`.

## pg-6: Emoji glyphs used as UI icons (project rule: no emojis in UI)

- **Severity**: low
- **Side**: shared
- **File**: `src/app/[locale]/games/page.tsx:16-18, 94`, `src/app/[locale]/wheel/page.tsx:35`,
  `src/app/[locale]/blog/[slug]/page.tsx:117`, `src/app/[locale]/games/page.tsx:82`
- **Evidence**:
  ```ts
  const GAME_ICONS: Record<string, string> = { rps: "✊", slots: "🎰", … };   // games/page.tsx:16
  <span className="text-3xl" aria-hidden>{GAME_ICONS[game.id] ?? "🎮"}</span> // :94
  <h1 …>🎡 {t("title")}</h1>                                                  // wheel/page.tsx:35
  <span className="tabular-nums">👁 {viewCount.toLocaleString(locale)}</span> // blog/[slug]/page.tsx:117
  <Link href="/wheel" …>🎡 {t("wheelLink")}</Link>                            // games/page.tsx:82
  ```
- **Why it is a bug**: `AGENTS.md` Conventions states "No emojis in UI; inline SVG icons" — these
  four spots (game tiles, game→wheel button, wheel heading, blog view counter) violate it. Beyond
  the rule, emoji glyphs render differently per OS/font (a Windows/Linux/Android user sees different
  artwork) and are outside the `--accent` token system, so the icon set is not themeable or
  consistent with the inline-SVG icons used elsewhere on these same pages.
- **Confidence**: confirmed
- **Fix direction**: replace with inline SVG icons (reuse the icon set already used on the badge and
  stats pages) and drop `GAME_ICONS`.

## pg-7: Auto-generated drop posts hardlink the English locale

- **Severity**: low
- **Side**: server
- **File**: `src/lib/blog.ts:48`
- **Evidence**:
  ```ts
  `View the full details on the [badge page](/en/badges/${badge.slug}).`,
  ```
  (The row also stores `locale` on `blog_posts` — `0001_init.sql:216` — but the body link is fixed.)
- **Why it is a bug**: `createDropPost` runs once per new badge and the post body is rendered as-is by
  `renderMarkdown` on `/[locale]/blog/[slug]`, so a reader on `/de/blog/drop-…` is sent to
  `/en/badges/…` — a locale switch on click, contradicting `localePrefix: "always"` and the
  language switcher's promise to stay in-locale.
- **Confidence**: confirmed (the string literal is unconditional)
- **Fix direction**: emit a locale-relative link (`/badges/${badge.slug}`) so the reader's current
  locale is preserved, or rewrite the link per locale at render time.

## pg-8: Render pages import the service-role admin client

- **Severity**: low
- **Side**: server
- **File**: `src/app/[locale]/feed/page.tsx:3,38`, `src/app/[locale]/achievements/page.tsx:4,45`,
  `src/app/[locale]/blog/[slug]/page.tsx:10,60`, `src/app/[locale]/games/[game]/page.tsx:5,63`
- **Evidence**: `import { createAdminClient } from "@/lib/supabase/admin";` used inside page
  (request-time) code. `AGENTS.md` Architecture rules: "**Service-role client** … only in scripts,
  cron routes and server push code. Never import it from client components."
- **Why it is a bug**: these are server components, so nothing leaks to the bundle — but the stated
  rule exists so that RLS bypass is confined to a small, auditable surface. Four public pages now
  read with RLS disabled, which is why pg-1 could pull the entire `blog_reactions` table onto a
  public page and why any future column added to `activity_events`/`blog_posts` (e.g. an
  author-only or moderation column) is published on the first `select("*")`-style change.
- **Confidence**: confirmed (policy violation; no direct data leak today)
- **Fix direction**: read these public tables with the anon/server client (they have public-read RLS
  policies) and keep `createAdminClient()` for the write paths only.