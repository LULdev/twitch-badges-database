# Verification report — commit `bb7fe91` (round 8)

Adversarial verification of the 14 audit fixes in `bb7fe91`. Method: read the
full diff, enumerated every call site of the changed symbols, read the RLS /
grant migrations (0001, 0003, 0008, 0009, 0010, 0011) against the actual
queries, and ran read-only probes against the live project with the anon and
service-role keys (never printed). Also ran `tsc --noEmit` (exit 0) and
`npm run lint` (0 errors, 9 pre-existing warnings).

Line numbers refer to the tree at `bb7fe91` (HEAD).

---

## New defects / incomplete fixes

### R8-1 — `cat-9` fix is incomplete: `BadgeImage` still double-announces the title on four other surfaces
- **Severity**: low (accessibility)
- **Side**: UI / a11y
- **File**: `src/components/badges/BadgeCard.tsx:69`, `src/components/badges/BadgeImage.tsx:45`,
  `src/app/[locale]/leaderboards/page.tsx:134`, `:166`,
  `src/app/[locale]/compare/page.tsx:202`,
  `src/app/[locale]/profile/[username]/page.tsx:475`,
  `src/components/account/AccountSettings.tsx:180`, `:213`
- **Evidence**: the only call site that now passes the decorative override is
  `BadgeCard` (`alt=""`). The other five render `<BadgeImage badge={...} />`
  with the default `alt={alt ?? badge.title}` **inside the same link/button as
  visible `{badge.title}` text**:
  - `leaderboards/page.tsx` "most owned" (line 134) and "rarest" (line 166):
    `<Link ...><BadgeImage badge={badge} size={28} /><span>{badge.title}</span>…`
  - `compare/page.tsx:202`: `className="badge-tile …"` link with image + `{row.title}`.
  - `profile/[username]/page.tsx:475`: `className="badge-tile …"` link with image + `{badge.title}`.
  - `AccountSettings.tsx:180` and `:213`: `<button>` with image + `{badge.title}`.
  The reported problem ("the tile printed the title as text inside the same
  link, so the image was announced twice") is exactly the same markup on the
  `badge-tile`-classed surfaces in `compare` and `profile`, and the same
  link-with-text pattern in `leaderboards`/`AccountSettings`.
- **Why it is a bug**: the audit finding was about duplicated accessible names
  for a badge tile; fixing only one of six instances leaves the defect live
  wherever the same tile markup is reused.
- **Confidence**: confirmed.
- **Fix direction**: pass `alt=""` (or `aria-hidden`) wherever the image is
  adjacent to the title text in the same interactive element — the new optional
  `alt` prop already supports it; alternatively default to decorative when a
  sibling title is present.

### R8-2 — blog view counter's 5-minute dedup is broken; the `pg-8` fix now *displays* the inflated count
- **Severity**: medium (user-visible wrong data)
- **Side**: data-quality / correctness
- **File**: `src/lib/gamification/visits.ts:51` (write path),
  `src/app/[locale]/blog/[slug]/page.tsx:66,71` (read/display path)
- **Evidence**:
  1. `blog_views` has **no `id` column** (`0003_gamification.sql:111-115`:
     columns are `post_id, ip_hash, created_at`).
  2. Live probe (anon key): `GET /rest/v1/blog_views?select=id` → **400**
     `{"code":"42703","message":"column blog_views.id does not exist"}`; same
     result with the service-role key.
  3. `recordBlogView` therefore runs
     `supabase.from("blog_views").select("id", {count:"exact", head:true})`
     (line 51), gets `{count:null, error}`, and `(count ?? 0) > 0` is always
     false → **every request inserts a new row**.
  4. Live data: of 19 `blog_views` rows, **7 pairs are the same
     `(post_id, ip_hash)` within a 5-minute window** — directly impossible if
     the dedup worked.
  5. Before this commit the page read the count with the *same* `select("id")`
     on the admin client, so it was a 400 too and `viewCount` was always `0`.
     The `pg-8` change to `select("post_id")` (line 66) is what makes the count
     non-zero — and the number shown to readers is now this un-deduped total,
     which grows on every reload and bot hit.
- **Why it is a bug**: the commit's own comment on the page still says
  "View counter (5-minute per-IP dedup)"; after the fix the page publishes a
  counter that no longer dedups, so the feature is measurably wrong instead of
  silently zero. The commit touched the neighbouring read in the same feature
  and missed the identical broken read in `visits.ts`.
- **Confidence**: confirmed.
- **Fix direction**: change `visits.ts:51` to
  `.select("post_id", { count: "exact", head: true })` (the column the table
  actually has), matching the page's read; re-verify with a repeat request.

### R8-3 — `cat-4` removes the only graceful failure path with no error boundary in the tree
- **Severity**: low (resilience / UX)
- **Side**: page behaviour
- **File**: `src/app/[locale]/badges/[slug]/page.tsx:73`; no `error.tsx` anywhere
  (`find src/app -name "error.tsx" -o -name "global-error.tsx"` → empty)
- **Evidence**: `getBadgeBySlug` now throws (`src/lib/queries.ts:262`), and the
  page no longer catches, so any transient pooler/DB error for a valid badge
  URL renders Next's default unhandled-error page. Previously the same error
  produced a 404 with the site chrome. There is no `error.tsx` in
  `src/app/[locale]/`, so there is no branded fallback and no retry surface.
- **Why it is a bug**: strictly this is the requested trade-off (surface the
  error, don't fake a 404), but the commit replaces a wrong-but-graceful
  response with an unbranded 500 and no `error.tsx` to soften it. Worth
  knowing before calling cat-4 "done".
- **Confidence**: confirmed (absence of `error.tsx` and the removed `.catch`
  are both verifiable; severity depends on how transient errors are tolerated).
- **Fix direction**: add `src/app/[locale]/error.tsx` (client) that renders the
  shell + a "try again" action, so a real DB error no longer drops users onto
  the framework error page.

### R8-4 — migration 0011 omits the `notify pgrst, 'reload schema';` every other migration uses
- **Severity**: low (consistency; no live impact observed)
- **Side**: database / ops
- **File**: `supabase/migrations/0011_public_read_blog_engagement.sql` (34 lines,
  ends at the changelog insert; no `notify`)
- **Evidence**: `0008_grant_hardening.sql`, `0009_integrity_indexes.sql` and
  `0010_profile_column_grants.sql` all end with `notify pgrst, 'reload schema';`
  before their changelog row. `0011` changes `blog_views`/`blog_reactions`
  privileges (the exact class of change PostgREST caches) and does not notify;
  `scripts/db-apply.ts` does not issue one either.
- **Why it is a bug**: PostgREST caches per-column privileges; a missing reload
  is the documented way to leave the API serving a stale privilege view. Live
  probes are currently correct (`select=post_id` → 200, `select=ip_hash` → 401),
  so the impact today is nil — hence the low severity.
- **Confidence**: mechanism confirmed; live impact unconfirmed (none visible).
- **Fix direction**: add `notify pgrst, 'reload schema';` to 0011 (or emit one
  from `db-apply.ts` after applying migrations).

### R8-5 — `GameIcon` silently falls back to the "shoot" (crosshair) icon for any unknown id
- **Severity**: low (informational)
- **Side**: UI
- **File**: `src/components/GameIcon.tsx:110` (`PATHS[id] ?? PATHS.shoot`)
- **Evidence**: all 13 `GAMES` ids plus `wheel` have entries today (verified
  against `src/lib/gamification/games.ts:20-32`), so nothing falls back now.
  The previous hub fallback was a neutral 🎮 (`GAME_ICONS[…] ?? "🎮"`); the new
  fallback is a crosshair, which is the *wrong* glyph for an unmapped game.
- **Why it is a bug**: the next game added to `GAMES` without a `PATHS` entry
  renders as "Shoot the Badges" instead of a generic marker, and silently —
  no warning, no neutral placeholder.
- **Confidence**: confirmed for the mechanism; no live defect (all keys exist).
- **Fix direction**: make the fallback a neutral "game" glyph, or have the
  loader throw/warn on an unmapped id so the omission is caught.

---

## Checks that found nothing (explicit)

1. **Other callers of `getBadgeBySlug` / `BadgeImage` / `BadgeCard` — none break.**
   Repo-wide grep finds exactly two `getBadgeBySlug` call sites, both in
   `src/app/[locale]/badges/[slug]/page.tsx`: `generateMetadata` (line 30)
   still wraps it in `.catch(() => null)` and returns `{}`; the page (line 73)
   intentionally does not. `slug` is `unique` (`0001_init.sql:44`), so
   `maybeSingle()` returns `null` only for a missing slug — the added comment
   holds. `BadgeImage`'s `alt?: string` is optional, so all seven existing call
   sites compile unchanged (`tsc --noEmit` exit 0). `BadgeCard` is consumed
   only via `BadgeGrid` (`badge`, `showCountdown`) — unaffected; its named
   exports `formatCompact`/`StatusChip` are untouched. The new `now` bound is
   well-formed and `now` is defined (line 59).

2. **Anon-client swaps return the rows the pages need; no query selects a now-unreadable column.**
   Live probes with the anon key: `blog_views?select=post_id,created_at` → 200,
   `blog_views?select=ip_hash` → 401, `blog_reactions?select=emoji` → 200,
   `blog_reactions?select=ip_hash` → 401, `activity_events?select=<feed cols>` →
   200, `user_achievements?select=achievement_id` → 200,
   `badges?select=slug,title,image_url_2x` → 200, and the page's HEAD count
   (`blog_views?select=post_id&post_id=eq.…` with `Prefer: count=exact`) → 206
   with a valid `content-range`. `user_achievements` and `activity_events` have
   public-read policies (`0003_gamification.sql:161-167`) and `0003` revoked
   only insert/update/delete. `profiles` column grants (0009/0010) are not
   touched by these pages. Every other `blog_views`/`blog_reactions` read in the
   repo (`api/blog/react`.ts, `lib/gamification/visits.ts`,
   `lib/gamification/achievements.ts:327`) uses the service-role client, which
   is unaffected by the grant revokes.

3. **Changelog `kind` allowlist is complete — no dead chip.**
   The CHECK constraint (`0001_init.sql:229`) allows exactly
   `badge_added, badge_updated, badge_removed, data_sync, feature, bugfix, blog,
   push`; `ChangelogKind` (`src/lib/changelog.ts`) is the same set; the page's
   `kinds` array (`changelog/page.tsx:47-58`) contains all eight + `all`. Live
   distinct kinds: `{feature:16, data_sync:33, badge_added:1, badge_updated:4,
   blog:139, bugfix:60}` — no value outside the allowlist. `listChangelog`
   special-cases `"all"` correctly (`queries.ts:486`). `changelog.emptyFilter`
   exists in all 11 `messages/*.json` (key parity verified, 660 keys each).

4. **`--sparkle` light override and the `[dir="rtl"]` overrides.**
   `.light { --sparkle: var(--accent) }` resolves to `#7c3aed` (`.light`'s
   `--accent`, `globals.css:65,86`), which is ~5.9:1 on a white card — the
   sparkle shapes sit on the surface (`.rarity-sparkle` at negative offsets,
   `.level-sparkle` on the translucent shield, `.bcoin-sparkle` around the gold
   coin), so contrast is adequate in both themes; dark mode still uses
   `rgba(255,255,255,.92)`. Cascade: `[dir="rtl"] .grow-bar-fill` (0,2,0) beats
   the base `.grow-bar-fill` (0,1,0, `globals.css:1190`) regardless of source
   order, and `[dir="rtl"] .rank-row` (0,2,0) sets `animation-name` over the
   base `.rank-row`'s shorthand (0,1,0, line 1372) while the shorthand's
   duration/fill/delay still apply — the mirrored `rank-in-rtl` keyframe runs.
   `dir="rtl"` is actually emitted (`[locale]/layout.tsx:90`).

5. **`GameIcon` keys complete.** `PATHS` has exactly the 13 `GAMES` ids
   (`rps, slots, shoot, memory, quiz, coinflip, hilo, roulette, blackjack,
   vault, scratch, tower, catcher`) plus `wheel` — no missing key, so no live
   silent fallback (see R8-5 for the latent risk).

6. **`cron/global` flag and 207 body are correct.** `badgebaseFailed` is set
   only in the `catch` (route lines ~44-52), so a falsy-but-successful
   `runBadgebaseSync()` result no longer records "degraded"; `withHeartbeat`
   (`health.ts`) itself records "ok" unconditionally on success, so the route is
   the only place that derived status from truthiness and it is fixed. The 207
   path returns `Response.json({...}, {status: 207})` — a valid JSON body with a
   2xx status, so cron callers see a success with `badgebaseFailed: true`. No
   consumer in the repo parses the old `badgebaseFailed: !badgebase` shape.

---

## Summary

| ID | Severity | Confidence | One line |
|---|---|---|---|
| R8-1 | low | confirmed | cat-9 fixed only BadgeCard; 5 other `BadgeImage` call sites still duplicate the title for screen readers |
| R8-2 | medium | confirmed | blog-view dedup broken (`select("id")` on a table with no `id`); the fixed page now displays the inflated count |
| R8-3 | low | confirmed | cat-4 throws with no `error.tsx`, so a DB hiccup gives an unbranded 500 |
| R8-4 | low | mechanism confirmed, no live impact | migration 0011 lacks `notify pgrst, 'reload schema';` |
| R8-5 | low | mechanism confirmed, no live defect | `GameIcon` falls back to the crosshair for unknown ids |

No high-severity regression was found: the throwing `getBadgeBySlug`, the new
`alt` prop, the changelog allowlist, the RTL/`--sparkle` tokens and the cron
flag all behave as the commit claims.