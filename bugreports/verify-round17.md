# Round 17 verification — `0428349` (round-16 fixes) + `5c478f2` (docs)

Verifier pass over the newest code commit. Read-only: direct Postgres reads
(session pooler, port from `SUPABASE_DB_URL`), a full-row scan of every public
table, an exhaustive repository grep, two live WebFetch reads of production, and
source review. No project file was modified except this report; no production row
was written (only SELECTs were issued).

Result: **1 high, 0 medium, 4 low, 1 info.** The three round-16 repairs are real
(this time): the skip is genuinely surfaced in both cron routes, the seed strings
and migration 0003 are corrected, and `ACH_BY_ID` now resolves retired ids — but
that last change is exactly the one that **newly broke `/stats`**, and the
completeness claim in the commit body is false again.

Context: `v16-03`, `v16-04`, `v16-05` are the findings this commit closes
(`AGENT-AUDIT.md:561–563`). Nothing below re-reports them; the items listed under
"still open" are the parts of them the commit did **not** actually fix.

---

## Findings

### v17-01 — HIGH — content/UI — `src/app/[locale]/stats/page.tsx:287–292`, `:497`, `:844` (root cause `src/lib/gamification/achievements.ts:272`)

**Evidence.** The commit changed `ACH_BY_ID` from `ACTIVE_ACHIEVEMENTS` (123) to
`ACHIEVEMENTS` (125):

```ts
export const ACH_BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a])); // achievements.ts:272
```

`/stats` was not touched, and it **iterates the map's values** to build the catalog
size:

```ts
const catalogTotals = { common: 0, creative: 0, special: 0 };
for (const achievement of ACH_BY_ID.values()) {          // stats/page.tsx:288  → now 125
  catalogTotals[achievement.category] += 1;
}
const achievementCatalogSize =
  catalogTotals.common + catalogTotals.creative + catalogTotals.special;   // :291–292 → 125
```

`achievementCatalogSize` (and the per-tier `catalogTotals`) are rendered at
`stats/page.tsx:497` (the "Achievements" KPI hint, `${achievementCatalogSize} ${t("achievementsTotal")}`)
and `:844` (the "rarest" footnote, `… {achievementCatalogSize} achievementsTotal`),
while the same page's section subtitle at `:821` still uses
`ACTIVE_ACHIEVEMENTS.length` = 123.

Live production (`https://twitch-badges-database.vercel.app/en/stats`, fetched
at verification time) confirms the contradiction **on one page**:

```
KPI hint              : "125 Achievements"
rarest footnote       : "13 unlocks · 125 Achievements"
section subtitle      : "123 goals across three tiers"
```

and the tier `hint`s are now 50 / 50 / 25 instead of 50 / 48 / 25. The
`/achievements` page is unaffected and correctly shows "123 achievements to
hunt — 50 common, 48 creative, 25 truly unexpected" (50/48/25), so the site now
states two different totals for the same catalog.

**Why it is a bug.** This is the exact "description does not match content"
class the round-15/16 work was meant to eliminate, reintroduced by this very
commit at a second site (`/stats`) that round 16 had explicitly listed as clean
(`verify-round16.md`, clean list #5: "The subtitle now equals
`ACTIVE_ACHIEVEMENTS.length` = 123, the same value as `achievementCatalogSize`").
That statement was true before `0428349` and is false after it. It is public,
indexable, and the page's stated purpose is to publish these numbers.

**Confidence.** High — live production read, exact source lines, and the two
values are computed from the two different lists by inspection.

**Fix direction.** Iterate `ACTIVE_ACHIEVEMENTS` (or filter
`RETIRED_ACHIEVEMENT_IDS`) for `catalogTotals`/`achievementCatalogSize`; keep
`ACH_BY_ID.get(...)` for *resolution* (profile hero, rarest title) — the
distinction the commit's own comment draws but that `stats/page.tsx:288`
violates by enumerating instead of looking up. One-line change plus a grep for
other `.values()`/`.size` uses of the map (there are none today).

---

### v17-02 — LOW — repo/source drift — `scripts/i18n-faq-customizer.py:248–256`, `scripts/i18n-complete-translations.py:412–419`

**Evidence.** Two git-tracked i18n generator scripts still carry the **pre-fix
hardcoded** counts, in all nine non-en/de locales:

```python
# scripts/i18n-complete-translations.py:412 (key "achievements.subtitle")
"125 logros que cazar — 50 comunes, 50 creativos, 25 realmente inesperados.", …
# scripts/i18n-faq-customizer.py:248 (key "faq.achievementsA")
"125: 50 hitos comunes, 50 retos creativos y 25 especiales realmente inesperados. …"
```

Both scripts end by **writing `messages/<locale>.json` directly**, with no
guard:

```python
with io.open(path, "w", …) as handle:      # i18n-complete-translations.py (tail)
    json.dump(data, handle, …)
```

So re-running either script would overwrite the now-templated
`achievements.subtitle` / `faq.achievementsA` with the hardcoded 125 text in nine
locales — reverting v15-02 (round 15/16's fix) and re-introducing the exact
stale-number bug on `/achievements` and `/faq`.

**Why it is a bug.** The commit body (and changelog #300) claims "Kein Quelltext
… enthält noch eine veraltete Errungenschaftszahl" / "No source file … carries a
stale achievement count." These **are** source files, and they do. Round 16's
clean list #7 only scanned `messages/*.json`; the generators that produce those
files were never checked. The write is unconditional (unlike the blog seed's
`ignoreDuplicates`), so the latent regression is stronger than the v16-05 case
that was fixed.

**Confidence.** High — files read; write path read; grep for the literals.

**Fix direction.** Update the twelve strings (or make these one-off scripts
refuse to run / delete them once superseded), and add the `scripts/*.py`
generators to whatever grep gate the completeness claim is based on.

---

### v17-03 — LOW — repo/doc drift — `README.md:72`, `AGENTS.md:30`

**Evidence.** Both still read "**125 achievements**":

```
README.md:72   … unlocking Twitch badges (+1,000 XP / +500 coins each), 125 achievements,
AGENTS.md:30   - `src/lib/gamification/` — XP/coins/levels (xp.ts, levels.ts), 125 achievements
```

`AGENTS.md` is the agent-facing specification for this repo — the first file any
future contributor reads on the gamification module. It states a catalog size
that no longer exists. Round 16's report never mentions README/AGENTS (grep of
`verify-round16.md` + `AGENT-AUDIT.md`: no hits), so this is unreported.

**Why it is a bug (low).** Documentation drift; falsifies the commit's
"no source file" claim for the second time. No runtime effect.

**Confidence.** High — literal grep.

**Fix direction.** 125 → 123 in both lines.

---

### v17-04 — LOW — content (public changelog) — `changelog.id = 155` (rendered at `src/app/[locale]/changelog/page.tsx:146–148`)

**Evidence.** A full-row scan of all 23 public tables for achievement-count
patterns returns exactly one table with hits: `changelog` (16 rows). Of the 150
rows the public page renders (`listChangelog(kind, 150)`, `queries.ts:479–491`;
300 rows total, newest 150 = ids 151…300), **id 155 is on the page** and its body
still claims the old number:

```
id 155 | kind=blog | "Blog post published: The Badge Arcade Is Open: 13 Games, One Economy"
body  : "Everything launches today — XP, coins, the wheel, 125 achievements, heists and the full arcade."
```

The page prints `entry.body` verbatim (`changelog/page.tsx:146–148`). The other
rows containing 125 (`296`, `300`, `292`) are the correction entries, where the
number is quoted deliberately. Older rows (`17`, `22`, `45`, …) also carry 125
but are off the rendered page. The migration-0003 edit in this commit changes the
**fresh-install** seed only; the live row is untouched and no migration
retro-applies it. The RSS feed (`/api/changelog/rss`, limit 100 = ids 201…300)
does **not** include id 155.

**Why it is a bug (low).** Public page currently publishes a stale count; and it
is the concrete residue of v16-05 ("`0003` is the documented seed for the
changelog entry still shown as '125 achievements' on `/changelog`"), which the
commit marked fixed but which is unfixed in production. Historical-log semantics
make rewriting debatable, hence low, but it *is* a live stale number.

**Confidence.** High — row read; page render + limit read; RSS limit read.

**Fix direction.** Either accept the changelog as immutable history and drop the
completeness claim for it, or update row 155's body (a `logChange`-style
correction row would not help — the stale body stays). Do not rely on the
migration edit to fix production.

---

### v17-05 — LOW — server — `scripts/sync-badgebase.ts:9–19` (+ residual of `v16-04`)

**Evidence.** The script's new comment claims a skip is no longer recorded as
healthy:

```ts
// … the summary reaches the heartbeat, so a skipped run (empty /active listing)
// is not recorded as healthy.                                        // :9–10
const summary = await withHeartbeat("sync/badgebase", () => runBadgebaseSync(),
  (result) => result as unknown as Record<string, unknown>);
```

`withHeartbeat` hardcodes `status: "ok"` on success (`health.ts:57–61`) —
`summarize` only fills `payload` — and the script writes **no second, degraded
heartbeat**. So `npm run sync:badgebase` during a skip records
`sync/badgebase = ok` and merely `console.warn`s. (The two cron routes did fix
this, but at a *different* source: they add a `cron/badgebase` / `cron/global`
row and leave the inner `sync/badgebase` row `ok`.)

Secondary: the new `summarize` payload still has no reader — the `/stats` source
table prints `last_status` / `last_message` / counts, not `payload`
(`stats/page.tsx` uptime table; `stats.ts:160–182`). And `serviceStatus`
(`stats.ts:241–252`) returns `degraded` only for `last_status === "error"`, so
even the new `degraded` rows never move the headline gauge — their only effect is
the per-source row text and the `stats_uptime_sources` availability percentage
(`0004_stats_uptime.sql:288` counts only `status = 'ok'` in `ok_total`).

**Why it is a bug (low).** The comment states the opposite of what the code
does; the sync-script path (unlike the cron routes) has no degraded row at all.
This is the part of v16-04's fix direction ("have `withHeartbeat` accept a
status") that was not done.

**Confidence.** High — both files read; view SQL read.

**Fix direction.** Give `withHeartbeat` an optional status/message (or have the
sync's guard itself write a `degraded` heartbeat), or delete the false comment.

---

### v17-06 — INFO — content — `blog_posts.slug = "achievements-system-125-trophies"` (`scripts/seed-gamification-blog.ts:54`)

**Evidence.** The only "125" left in the entire `blog_posts` table is in the
post's **slug** (title/excerpt/content are all 123; verified by full-row scan).
This is a disclosed, deliberate exception — changelog #296: "die Slugs bleiben
unverändert, damit bestehende Links nicht brechen". Not a defect; recorded only
because the commit's claim ("kein Blog-Eintrag enthält noch eine veraltete
Errungenschaftszahl") is absolute and the slug is a field of the blog entry.

**Confidence.** High.

**Fix direction.** None required; optionally narrow the claim to
title/excerpt/content.

---

## Checked and found clean

1. **`ACH_BY_ID` — no reward path for a retired id (item 1a).** `evaluateAchievements`
   loops `ACTIVE_ACHIEVEMENTS` (`achievements.ts:292`); `newly` is populated only
   from that loop plus `META_ACHIEVEMENTS` (all `c_ach_*`, which are active), and
   the award block does `const ach = ACH_BY_ID.get(id); if (!ach) continue;`. No
   id entering `newly` can be retired, so mapping the retired definitions into
   `ACH_BY_ID` cannot pay XP/coins/points for one. `ACH_BY_ID` has exactly three
   call sites (`profile/[username]/page.tsx:407`, `stats/page.tsx:288` and
   `:862`); none awards.
2. **`ACH_BY_ID` — resolution now works (item 1b).** `ACH_BY_ID.get("k_sharer")`
   / `get("k_faq_scholar")` now return a definition, so the profile hero
   (`:407–408`, which drops entries it cannot resolve) renders them and the
   `/stats` rarest list renders a title instead of the raw id (`:862`, `:869`).
   Latent today: `user_achievements` holds 13 rows, **zero** retired ids, so
   nothing yet changes on screen — the fix is correct for the future case.
3. **`/achievements` count (item 1c).** `achievements/page.tsx:24–27,72–75` uses
   `ACTIVE_ACHIEVEMENTS` = 50/48/25 → 123; live page reports 123 (50/48/25). The
   page is correct; only `/stats` diverges (v17-01).
4. **Catalog arithmetic.** `ACHIEVEMENTS` = 50 common + 50 creative + 25 special
   = 125; `RETIRED_ACHIEVEMENT_IDS = {k_faq_scholar, k_sharer}` (both `k_`/creative)
   → `ACTIVE_ACHIEVEMENTS` = 123 = 50/48/25, matching the corrected prose and the
   live site.
5. **Skip detection, every return shape (item 2).** Both cron paths and the
   script derive `skipped` as `typeof summary.skipped === "string"` — `true` for
   the guard's `{…, skipped: "empty-listing"}` return, `false` for the normal flat
   numeric summary (`skipped` absent → `undefined`), and unreachable on a throw
   (the guard is a `return`, not a throw; a real failure — the
   `errors === capped.length` throw at `badgebase.ts:330–334` — travels the
   `withHeartbeat` error path and the route `catch`, producing `status:"error"` +
   HTTP 500). A skip cannot be reported as an error and an error cannot be a
   skip. Consistent with `cron/global`'s `badgebaseFailed || badgebaseSkipped ?
   "degraded" : "ok"` (`route.ts:70–78`).
6. **Heartbeat payload serialisation.** The `summarize` cast
   (`result as unknown as Record<string, unknown>`) hands `recordHeartbeat` a flat
   object of numbers plus an optional string — valid jsonb; `recordHeartbeat`
   (`health.ts:24–43`) wraps its insert in try/catch and never breaks the caller.
7. **Skip-path changelog write cannot crash (item 3a).** `logChange` is called
   with the client at `badgebase.ts:121–129`; `logChange` is `void`-returning and
   internally try/catch (`changelog.ts:26–42`). A skip cannot become a throw.
8. **Skip guard cannot fire on a legitimate run (item 3b).** Condition is
   `activeCards.length === 0 && allBadges.some(r => r.is_confirmed_active === true)`
   (`badgebase.ts:111–114`); a populated `/active` never enters. Round-16's real
   run and this round's DB reads both show `is_confirmed_active` rows present and
   `/active` non-empty, so the normal path was exercised.
9. **Seed scripts now consistent with live (item 4).** `seed-gamification-blog.ts:55,59,132,135`
   and `seed-xp-research.ts:22` all say 123 (with "forty-eight creative");
   `0003_gamification.sql:214` says 123. Repo text now matches the live rows.
10. **Blog metadata agreement (item 5).** The affected post's `excerpt` (the
    blog list card source, `blog/page.tsx:78–80`), the page meta description, the
    OpenGraph description and the Twitter card all read the same field
    (`blog/[slug]/page.tsx:29,37`), and the post's JSON-LD `description` too
    (`:79–83`). All four now say 123; the list page and the post page agree.
11. **`messages/*.json`.** No `125`/`124`/`123` literal in any of the 11 files
    (grep); counts are supplied as ICU placeholders at render, unchanged from
    round 16.
12. **Database full-row scan.** All 23 public base tables scanned for
    `125 achiev|125 troph|125 Errung|124 achiev|50/50/25|125 badges|12[45] achievements`
    → only `changelog` (16 rows, v17-04). `blog_posts` is clean apart from the
    slug (v17-06).

## Changelog-spam question (item 3, explicit)

**Verdict: at the current schedule, one row per skipped tick is acceptable — and
the "every 15 minutes" premise is false for this sync, so de-duplication is not
needed today. It would become necessary the moment `/api/cron/badgebase` is put
on a sub-daily schedule.**

Evidence:

- `vercel.json` crons: `/api/cron/global` at `0 6 * * *` (daily) and
  `/api/cron/potat` at `30 6 * * *`. `runBadgebaseSync` is invoked by
  `cron/global` (`cron/global/route.ts:51–55`).
- `.github/workflows/potat-sync.yml` is the `*/15 * * * *` job, and it hits
  **`/api/cron/potat` only** (`curl … /api/cron/potat`) — never badgebase.
- `runBadgebaseSync` has exactly three callers: `cron/global` (daily),
  `/api/cron/badgebase` (present in no `vercel.json` entry and called by nothing
  in the repo — grep across `.yml/.json/.md/.ts`: no caller), and
  `scripts/sync-badgebase.ts` (manual).

Worst case therefore = **one skip row per day** from the daily global cron (plus
one per manual run), for as long as the provider's `/active` stays empty. One row
per incident-day on a public append-only log is proportionate; a de-dup guard
would add complexity for a case that does not occur at this cadence.

Two caveats worth recording, not fixing:

- If `/api/cron/badgebase` is ever added to the 15-minute workflow or a Vercel
  cron, the guard emits up to **96 identical rows/day** (plus 96 `degraded`
  heartbeats) with no idempotency check — that *would* need de-dup (e.g. skip the
  write when an identical `data_sync` skip row exists in the last N hours).
- The skip is evaluated **after** the detail fetch loop (`badgebase.ts:79–82` runs
  before the guard at `:111`), so each skipped tick still performs up to 45
  outbound detail requests. Harmless at one/day; wasteful if it ever goes
  sub-daily.

## Production writes left by this verification

None. Every database access in this pass was a `SELECT` (information_schema,
`blog_posts`, `changelog`, `user_achievements`, `stats_uptime_sources` view
definition). No heartbeat, changelog, badge, profile, unlock or visit row was
inserted or modified.