# Verification round 18 — commit `96a1519` (docs `89bf252`)

Scope: the diff of `96a1519` (stats page, `health.ts`, the three badgebase call
sites, the two i18n scripts, README) plus the out-of-band database edits it
claims (six changelog titles, seven changelog bodies, README).

Method: source read of every touched file and every caller; `npx tsc --noEmit`
(0 errors) and `npx eslint` on the five changed TS files (0 errors);
read-only PostgREST scans (anon key; service-role used only for the three
RLS-protected tables, read-only) of all 23 public tables and the `stats_*`
views; live fetch of `/en/stats`, `/de/stats` and `/api/changelog/rss`.
No production row was modified.

Severity counts: **1 medium, 2 low.** Three of the seven requested areas are
clean (the two functional ones and the two i18n scripts).

---

## v18-01 — MEDIUM — source (dormant writer) — `scripts/i18n-stats-keys.py:192-203`

**Evidence.** This is a **third** one-off i18n generator that hardcodes the old
achievement count and writes `messages/*.json` directly, in all 11 locales:

```
192:    "achSubtitle": [
193:        "125 goals across three tiers",
194:        "125 Ziele in drei Stufen",
...
203:        "125 هدفًا على ثلاث درجات",
```

Its write loop (lines 447–458) does `data.setdefault("stats", {})` and then
`stats[key] = values[index]` for every key in `TR`, i.e. it overwrites
`stats.achSubtitle` in all 11 message files.

`v17-02` corrected **two** scripts (`i18n-complete-translations.py`,
`i18n-faq-customizer.py`) and the commit message asserts "Both now carry the
templated values". `grep -rn "i18n-stats\|stats-keys" bugreports/` returns
nothing, so this third writer was never reported. It is the only remaining
source file in the repo that carries the literal `125`
(`grep -ln "125" scripts/*.py`), and it is exactly the defect class v17-02 fixed.

**Why it is a bug.** The live `stats.achSubtitle` is the ICU-template
`"{total} goals across three tiers"` and the page feeds it
`ACTIVE_ACHIEVEMENTS.length`. Re-running this script would write the literal
`"125 goals across three tiers"` back into all 11 message files. `{total}` would
no longer be substituted, so `/stats` would once again show a KPI of **123** and a
subtitle of **125** — re-creating verbatim the self-contradiction that was the
round-17 **HIGH** (v17-01). The commit's stated fix ("prevent a re-run from
reverting the templating") is incomplete, and its completeness claim ("No stale
achievement count remains in source, messages …") is false.

**Confidence.** High — file read; write path read; the key name and the page's
namespace/placeholder match; AST-verified that the array has 11 entries in
`LOCALES` order (`en,de,es,fr,pt,it,ru,zh,ja,ko,ar`).

**Fix direction.** Replace the 11 hardcoded strings with the templated live
values (`"{total} goals across three tiers"`, `"{total} Ziele in drei Stufen"`, …),
matching `messages/*.json`, or delete the script now that it has served its
purpose. Add the `scripts/*.py` generators to the grep gate the "no stale count"
claim is based on.

---

## v18-02 — LOW — source (fresh-install seed) — `scripts/seed-gamification-blog.ts:56`

**Evidence.** The Trophy Wall seed post's `excerpt` still states the retired tier
split while its own title states 123:

```
54:  slug: "achievements-system-125-trophies",
55:  title: "123 Achievements: The Complete Trophy Wall",
56:  excerpt: "50 common milestones, 50 creative challenges and 25 truly unexpected specials — each with its own sparkle badge.",
57-... content: "… The forty-eight creative achievements …"   (correct)
```

50 + 50 + 25 = 125. The real active split is 50 common / 48 creative / 25
special = 123.

Round-16's `v16-05` fixed the seed scripts' `125` occurrences and the prose split
inside `content`; round-17's "checked clean" list (item 9) explicitly verified
`seed-gamification-blog.ts:55,59,132,135` — line **56** (the `excerpt`) is not in
that list, and no report mentions it (`grep` of `bugreports/` for `50 creative`
returns only the live-post findings v16-01 and the round-16 fix direction). It is
therefore unreported.

**Why it is a bug (low).** Live is already correct (the DB excerpt says 48, fixed
by v16-01), so there is no runtime effect today. But the seed is what a fresh
install writes: a new deployment would publish a post whose title says "123
Achievements" and whose excerpt (blog-list card, meta description, OpenGraph and
Twitter card all read this field) says 50/50/25 = 125. This is the same class as
`v16-05` and falsifies the commit's absolute "no stale achievement count remains
in source" claim.

**Confidence.** High — file read; line numbers confirmed; live `blog_posts.excerpt`
differs (48) from the seed (50).

**Fix direction.** Change the seed excerpt's "50 creative" to "48 creative" so it
equals the live row and the `content`.

---

## v18-03 — LOW — content (public changelog) — `changelog.id` 22, 45, 68, 91, 114, 137

**Evidence.** Six `blog` announcement rows carry an announcement `title` already
corrected to 123 but a `body` still stating the old split:

```
id 22/45/68/91/114/137  title: "Blog post published: 123 Achievements: The Complete Trophy Wall"
                        body : "50 common milestones, 50 creative challenges and 25 truly unexpected specials — each with its own sparkle badge."
```

These are the six announcement titles `v17-04` fixed (125 → 123); the commit
message counts "six announcement titles" plus "seven bodies" — the seven bodies
it edited are the ones containing the literal "125 achievements" (rows 17, 40,
63, 86, 109, 132, 155). The tier split in the Trophy-Wall bodies was never
touched. The commit's claim "the same class … All corrected" and the audit line
"No … blog posts and the changelog … stale achievement count" are therefore false
for these six rows.

The rows are currently **not** rendered: `/changelog` prints `listChangelog(kind,
150)` (`queries.ts:479-491`) and the table has 301 rows, so only ids 152–301 are
on the page; `/api/changelog/rss` uses limit 100 (ids 202–301). All six are below
152 and therefore dormant today — hence low, not medium.

**Why it is a bug (low).** Content-only, but the row asserts a catalog size
(implicitly 125) that is not the real one, contradicting the commit's stated
goal and its completeness claim. One page-limit change from public.

**Confidence.** High — rows queried by REST; page and RSS limits read; live RSS
fetched and scanned item-by-item.

**Fix direction.** Set the six bodies' "50 creative" to "48 creative" (bodies are
regenerated nowhere; a direct UPDATE is needed, as with the round-17 body edits).

---

## Premise note (not a defect)

Item 5(b) names rows **292, 296, 301** as the only deliberate 125 mentions.
Row **300** also contains 125 ("… 50/50/25 (=125) …") and, like 292/296/301, is an
accurate narration of the correction — so there are four narration rows, not
three. All four read correctly and must not be flagged. Row 296's closing
sentence "Kein Blog-Eintrag enthält noch 125" is itself corrected by row 300;
that is pre-existing and already on the record.

---

## Areas checked and found clean

1. **`/stats` consistency (v17-01 fix).** `achievementCatalogSize` (stats/page.tsx
   :296 :502 :849) and the section subtitle (:826) are all derived from
   `ACTIVE_ACHIEVEMENTS` = 50/48/25 = 123. Live `/en/stats` reads
   "Achievements unlocked 123 · 123 goals across three tiers · Common 10/50,
   Creative 1/48, Special 2/25 · 13 unlocks · 123 Achievements"; `/de/stats` the
   same in German (123 Errungenschaften / 123 Ziele). **(a) verified.**
2. **`ACH_BY_ID` still the render lookup.** Used at stats/page.tsx:867 (rarest
   rows) and profile/[username]/page.tsx:407 (unlocked rows); never used to
   compute a size. **(b) verified.**
3. **No other wrong-list size.** Repo-wide grep: the only catalog-size
   expressions are `ACTIVE_ACHIEVEMENTS.length` (achievements page :24/:72, faq
   page :63, stats page :826) and `achievementCatalogSize`. `ACHIEVEMENTS.length`
   / `ACH_BY_ID.size` appear nowhere. `/api/*` and `src/components/*` contain no
   achievement-count computation; `achievements.ts:296` iterates
   `ACTIVE_ACHIEVEMENTS` for evaluation and `ACH_BY_ID` only for metadata. **(c)
   verified.**
4. **`health.ts` (item 2).** `npx tsc --noEmit` → 0 errors; eslint on the file →
   0. All six callers (2 cron routes, 3 scripts, 1 initial `cron/global`) that
   pass no derivation keep the default `status: "ok"`. The `message` field is set
   only on the success path (`outcome?.message ?? null`); the catch path still
   writes `errorMessage(error)` and never consults `statusOf`, so a real error
   cannot be overwritten. No call site confuses `summarize` (3rd) with `statusOf`
   (4th). (Note: the two optional params are both `(result: T) => …`, so a
   hypothetical swap in the `statusOf`-as-`summarize` direction would still
   type-check — a latent API wart, not a current defect.)
5. **Badgebase call sites (item 3).** `runBadgebaseSync`'s early return carries
   `skipped: "empty-listing"` and the throw path ("all detail fetches failed") is
   an `Error`; the `typeof result.skipped === "string"` predicate matches the
   first and is never reached for the second (the throw is caught by
   `withHeartbeat`). Statuses are correct in all three: skip → `degraded` +
   message, normal → `ok`, throw → `error`. Row counts are the established
   per-source convention (each route writes one `sync/*` inside `withHeartbeat`
   and one `cron/*`); the commit adds no extra write. The script writes exactly
   one `sync/badgebase` row (previously none on a skip). Live `system_heartbeats`
   shows recent `sync/badgebase` runs as `ok` with no skip rows; no duplication.
6. **i18n Python scripts (item 4).** `ast.parse` on both files succeeds (syntax
   valid). Neither `TR["achievements.subtitle"]` nor `FAQ["faq.achievementsA"]`
   contains the literal `125`/`124`. AST-extracted arrays have 9 entries each in
   `es, fr, pt, it, ru, zh, ja, ko, ar` order (unchanged), and every entry is
   byte-identical to the live `messages/<locale>.json` value. Neither script
   calls `.format()`; both dump the value verbatim, so a re-run would write
   exactly the current live strings. **(a)(b)(c) verified clean** (the third
   writer is v18-01).
7. **Changelog scan (item 5a).** Every row scanned for `125|50/50/25|50 common`:
   the only rows with a literal `125` are the four accurate narrations (292, 296,
   300, 301); the only rows with a wrong size are the six in v18-03; no row
   asserts a current "125 achievements".
8. **RSS (item 5b).** Live `/api/changelog/rss` (100 items) fetched and scanned
   item-by-item: the only `12x` matches are the four narration rows plus
   unrelated numbers (`128/129` "…accepts 8/36/40…", `121 Agenten-Ideen`,
   `+120 bis +200 Prozent`). No stale claim is rendered.
9. **README (item 6).** README.md:72 now reads "123 achievements"; the file
   contains no other achievement count (`grep -niE "achiev|125|123" README.md` →
   one hit). The corrected statement matches the live active catalog (123).
10. **Database-wide falsification (item 7).** All 23 public tables scanned
    case-insensitively for `125|50 common|50 creative|50/50/25|125 troph|…` and
    for any `12x` literal in any column. Hits: `changelog` (v18-03 + narrations),
    `blog_posts` (only the `achievements-system-125-trophies` **slug** — the
    disclosed v17-06 exception — plus the correct 48 excerpt). No hit in
    `changelog.payload`, `blog_posts.content`, `notifications`, `activity_events`,
    `badge_events`, `badges`, `badge_stats`, `user_achievements`,
    `user_progress`, `system_heartbeats`, `game_rounds`, `profile_visits`,
    `steal_attempts`, `turbo_wins`, `push_subscriptions`, `coin_rain_gate`. The
    three anon-401 tables were read with the service role (SELECT only):
    `profiles.customization` (1 row), `blog_reactions` (0 hits), `blog_views`
    (hits are `ip_hash`/timestamp false positives). `stats_*` views carry no
    hardcoded count; the SQL migrations contain one `123` (0003:214, correct).
    `messages/*.json` contain no `12x` literal in any locale.
11. **Gates.** `npx tsc --noEmit` exit 0; `npx eslint` on the five changed TS
    files exit 0.