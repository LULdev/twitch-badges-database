# Round 16 verification — `269d0b0` (round-15 fixes) + `18ea886` (docs)

Verifier pass over the newest code commit. Read-only review plus live probes:
PostgREST/Postgres reads with the service role, direct execution of
`src/lib/gamification/achievements.ts`, a grep of every message file, and two
sanctioned idempotent sync runs. No project file was modified except this report.

Result: **0 high, 1 medium, 4 low.** The two headline fixes (badgebase skip
visibility, FAQ//stats templating) are functionally correct; the residual
defects are the *claims of completeness* the commit makes and the one repair
that still does not do what its own comment says.

---

## Findings

### v16-01 — medium — content — `blog_posts.slug = "badge-arcade-grand-opening"` (`excerpt`)

**Evidence.** The commit's own changelog row is id 296, body ending
`"Kein Blog-Eintrag enthält noch 125."` ("no blog entry contains 125 any more").
That is false. Live row (published, `is_auto = true`, `updated_at`
`2026-09-22T13:47:28.890798+00:00` — i.e. edited by this very commit):

```
excerpt: "Everything launches today — XP, BadgesCoins, the wheel, 125 achievements, heists and the full arcade."
content: "… a one-in-a-hundred-million Twitch Turbo jackpot, 123 achievements across three rarity classes …"
```

The body was corrected to 123 but the **excerpt was not**. A repo-wide scan of all
26 `blog_posts` rows (title + excerpt + content) leaves exactly this one literal
`125`, plus the tier-breakdown issue in v16-02.

**Why it is a bug.** `excerpt` is not decorative: it is rendered on the blog index
(`src/app/[locale]/blog/page.tsx:78–80`) and is the page's meta/OpenGraph/Twitter
description (`src/app/[locale]/blog/[slug]/page.tsx:29,37,83`). So a public,
indexable page states 125 achievements while the catalog and the same post's body
say 123 — the exact "description does not match content" class this commit set out
to remove, and it contradicts the commit's own changelog claim.

**Confidence.** High (row queried; both corrected/uncorrected fields printed).

**Fix direction.** Update the excerpt (or drop the number) in the DB row; the
in-repo seed is not the write path (see v16-05) so it must be a direct row update.

---

### v16-02 — low — content — `blog_posts.slug = "achievements-system-125-trophies"` (excerpt + content)

**Evidence.** Row queried (published, `updated_at 2026-09-22T13:47:28.687`):

```
title:   "123 Achievements: The Complete Trophy Wall"
excerpt: "50 common milestones, 50 creative challenges and 25 truly unexpected specials …"
content: "There are exactly 123 of them … The fifty common achievements … The fifty creative achievements … The final twenty-five are the specials …"
```

The active catalog is **50 common / 48 creative / 25 special = 123** (two creative
entries retired: `k_faq_scholar`, `k_sharer`; confirmed by executing the module —
see clean list #3). The post's own breakdown states 50/50/25 = **125** and so
contradicts the "exactly 123" sentence in the same page, in both the excerpt and
the body.

**Why it is a bug.** Public, indexable page whose headline number and tier
breakdown disagree; the excerpt is again the meta description, where a reader (or
a crawler) sees "50 creative" summing to the retired 125. The commit fixed only
the literal `125`→`123` occurrences, not the enumerated tiers that encode the same
count.

**Confidence.** High (row queried; module executed for 48 creative).

**Fix direction.** Change "fifty creative / 50 creative" to 48 in the excerpt and
the body paragraph, or drop the per-tier counts.

---

### v16-03 — low — server — `src/lib/gamification/achievements.ts:196–201, 262–268`

```ts
const RETIRED_ACHIEVEMENT_IDS = new Set(["k_faq_scholar", "k_sharer"]);   // :262
export const ACTIVE_ACHIEVEMENTS = ACHIEVEMENTS.filter(
  (a) => !RETIRED_ACHIEVEMENT_IDS.has(a.id),                              // :264
);
export const ACH_BY_ID = new Map(ACTIVE_ACHIEVEMENTS.map((a) => [a.id, a]));  // :268
```

**Evidence.** The commit restored the `k_sharer` line with `() => false` and its
docblock now claims the lines "keep the entries' metadata **so an unlock already
stored in the database can still be rendered**". Executing the module:

```
ACHIEVEMENTS = 125, ACTIVE_ACHIEVEMENTS = 123, ACH_BY_ID = 123
hasKsharerInMap = false, hasKfaqInMap = false, hasKsharerInAll = true
```

`ACH_BY_ID` — the **only** map the UI uses — is built from `ACTIVE_ACHIEVEMENTS`,
which filters both retired ids out, so the restored metadata is unreachable. A
stored `k_sharer`/`k_faq_scholar` unlock still: disappears from the profile hero
(`profile/[username]/page.tsx:407–408`, `ACH_BY_ID.get` → `undefined` →
`return null`) while the header chip counts it (`:402`), and renders the **raw id**
in the `/stats` "rarest" list (`stats/page.tsx:862, 869`, `meta?.title ??
row.achievement_id`).

**Why it is a bug.** It is precisely the outcome round-15's v15-03 described, and
the commit's stated reason for the restore is false. Latent today — 0 `k_sharer`
/ 0 `k_faq_scholar` rows in `user_achievements` (13 unlock rows, all active ids) —
so nothing renders wrong right now, but the fix is cosmetic and the docblock
misleads the next reader. The chosen "restore the tombstone" branch of the v15-03
fix direction is fine only if the UI reads `ACHIEVEMENTS`; it does not.

**Confidence.** High (module executed; both UI call sites read).

**Fix direction.** Either build `ACH_BY_ID` from `ACHIEVEMENTS` (retired entries
then still render and are simply never newly unlocked), or delete the docblock's
"can still be rendered" claim and drop the restored line's implied purpose.

---

### v16-04 — low — server — `src/lib/syncs/badgebase.ts:121–138` + `src/lib/health.ts:56–61`

**Evidence.** Only `cron/global` was given the `summarize`
(`route.ts:51–55`). The other two callers of `runBadgebaseSync` are untouched:
`src/app/api/cron/badgebase/route.ts:15` and `scripts/sync-badgebase.ts:8` still
call `withHeartbeat("sync/badgebase", () => runBadgebaseSync())` with two
arguments, and `cron/badgebase/route.ts:17` unconditionally records
`{ source: "cron/badgebase", status: "ok" }` after it resolves. Moreover the
inner `withHeartbeat` hardcodes `status: "ok"` on success (`health.ts:57–61`);
`summarize` only fills `payload`, and that payload is never rendered — the
`/stats` source table prints `last_status`, `last_message` and counts, not
`payload` (`stats/page.tsx:1049–1075`). So on a skip the global path writes
`sync/badgebase = ok` **and** `cron/global = degraded` simultaneously, and the
two non-scheduled callers remain entirely green (only the changelog row in
`badgebase.ts:121` records them).

**Why it is a bug (partial fix).** The round-15 finding was that "every caller
omits it"; the commit fixed one of three and the underlying per-sync heartbeat is
still green in all three. The new summarize payload has no reader, so the
visibility that actually exists comes solely from the `cron/global` row. Not
reachable from a schedule other than the daily global cron, hence low.

**Confidence.** High (all call sites grepped; heartbeat/UI data flow read).

**Fix direction.** Move the visibility into the sync itself (record a
`degraded`/message heartbeat in the guard, or have `withHeartbeat` accept a
status), and/or add the summarize to the other two callers; otherwise drop the
dead payload.

---

### v16-05 — low — repo/content drift — `scripts/seed-gamification-blog.ts:54–56,132,135`, `scripts/seed-xp-research.ts:22`, `supabase/migrations/0003_gamification.sql:214`

**Evidence.** The 125→123 correction exists **only in the database** — the commit
touches no seed, migration or SQL file (diff stat: messages, faq, stats, cron,
TowerGame, achievements, badgebase, and the round-15 report). Repo sources still
carry the old claim:

```
seed-gamification-blog.ts:55  title: "125 Achievements: The Complete Trophy Wall"
seed-gamification-blog.ts:132 excerpt: "… the wheel, 125 achievements, heists …"
seed-gamification-blog.ts:135 content: "… 125 achievements across three rarity classes …"
seed-xp-research.ts:22        "… summed from all 125 trophies."
0003_gamification.sql:214     "… 125 achievements …" (seeded changelog body)
```

**Why it is a (low) bug.** The fix is not reproducible and would not survive a
fresh environment: a new DB seeded from this repo gets the 125 copy again. It is
inert against the *live* DB only because `createFeaturePost` upserts with
`ignoreDuplicates: true` (`src/lib/blog.ts:80–92`), so re-running the seed does
not overwrite the existing rows — but the repo is now the *stale* side of the
drift, and `0003` is the documented seed for the changelog entry still shown as
"125 achievements" on `/changelog`.

**Confidence.** High (seed lines grepped; seed writer inspected; no migration in
the commit).

**Fix direction.** Update the two seed strings and the `0003` seed text (the
latter only if the project accepts post-hoc edit of an applied migration's seed
literal; otherwise note it as historical).

---

## Checked and found clean

1. **`runBadgebaseSync` skip path (`badgebase.ts:111–138`).** `logChange(...)`
   sits at `:121–129`, before the `return` at `:130`, so it runs. `logChange`
   wraps its insert in `try/catch` and returns `void` (`changelog.ts:26–42`), so it
   cannot turn a skip into a crash. The call is inside the guard, so a normal run
   does not emit it (re-run confirmed: summary had no `skipped` key). It cannot
   spam: the only scheduled caller is `vercel.json`'s `/api/cron/global` at
   `0 6 * * *` (daily) — the 15-minute GitHub action hits `/api/cron/potat`, and
   `runBadgebaseSync` has exactly three callers, none sub-daily. One row per
   incident-day, no dedup needed.
2. **`cron/global` summarize + detection (`route.ts:43–99`).** The cast
   `summary as unknown as Record<string, unknown>` only feeds `recordHeartbeat`'s
   `payload`, and the summary is a flat object of numbers plus an optional string
   → valid jsonb. `badgebaseSkipped` is `typeof …skipped === "string"`: true for
   the skip summary (`"empty-listing"`), `undefined`→false for the normal summary,
   and unreachable on a throw (the `catch` leaves `badgebase = null` and sets
   `badgebaseFailed`). 207/200 is unchanged: 207 only when `badgebaseFailed`, and
   a skip keeps `ok:true`/`200` with the skip carried by `badgebaseSkipped` and
   the degraded `cron/global` heartbeat. Note (not a defect): the inner
   `sync/badgebase` row is still `ok` — see v16-04.
3. **FAQ `answerFor` (`faq/page.tsx:62–71,73–81,106`).** All 20 `FAQ_KEYS` × 11
   locales resolve; no answer besides `achievementsA` contains an ICU placeholder
   (scripted check of every locale: 0 problems), so the un-valued `t(\`${key}A\`)`
   branch cannot throw. The JSON-LD `acceptedAnswer` (`:79`) and the visible
   `<p>` (`:106`) both go through `answerFor`, so they cannot diverge.
4. **`generateMetadata` (`faq/page.tsx:32–47`).** Uses only `t("title")` and
   `t("subtitle")`; neither carries a placeholder (`faq.subtitle` is
   "The complete guide…", no count). It never touches `achievementsA`.
5. **`/stats` achievements subtitle (`stats/page.tsx:5,820–822`).** `ACTIVE_ACHIEVEMENTS`
   is imported into an async **server** component (page.tsx, no `"use client"`);
   the module was already imported there for `ACH_BY_ID` (`:8`), so no new
   boundary, and `achievements.ts` has no top-level side effects (`createAdminClient`
   is only called inside functions). The subtitle now equals
   `ACTIVE_ACHIEVEMENTS.length` = 123, the same value as `achievementCatalogSize`
   (`:288–292`, from `ACH_BY_ID`) printed at `:844`. The two same-path imports
   (`:5`, `:8`) are cosmetically redundant, not a defect. `npx tsc --noEmit` → 0.
6. **Achievement catalog (executed module).** `ALL 125 / ACTIVE 123 / MAP 123`,
   `common 50 / creative 48 / special 25`. `RETIRED_ACHIEVEMENT_IDS` names exactly
   the two entries now present (`k_faq_scholar`, `k_sharer`); `ACHIEVEMENTS` is
   imported nowhere outside its own module; `evaluateAchievements` loops
   `ACTIVE_ACHIEVEMENTS` (`:292`) and `ACH_BY_ID` is derived from it, so neither
   retired id can ever be newly unlocked and `() => false` cannot lock a live entry.
   (The rendering half is v16-03.)
7. **Message files.** No `125`/`124`/`123` literal remains in any of the 11
   `messages/*.json`; the only braced `stats.*`/`achievements.*` strings are
   `achSubtitle`, `achievements.subtitle` and `faq.achievementsA`, all four
   placeholders present in all locales. No other page/component/OG/SEO code
   carries an achievement count (grep of `src/app`, `src/components`,
   `src/lib/seo.ts`, `src/app/api`).
8. **TowerGame (v15-04).** `playedFloor = last ? last.floor : cashoutAt`
   (`:43`) with `floor` the reached floor from the resolver — the crash marker is
   back on the floor the round died on, matching the server semantics; the
   redundant `cashoutAt` field is gone and no reference to it remains.
9. **Live syncs (sanctioned, idempotent).**
   `sync-badgebase` → `{activeCards:23,upcomingCards:18,enriched:41,inserted:0,demotedToExpired:0,errors:0}`
   (no `skipped`); `sync-global` → `{source:"ivr",versions:476,added:0,updated:0,removed:0,statusChanged:0}`.
   Catalog stayed 476; the new `logChange` import did not break the normal path.

## Production writes left by this verification

My two sanctioned runs wrote `changelog` ids **297** ("Drop-window listing sync
completed") and **298** ("Catalog sync completed"), and `system_heartbeats` ids
**79** (`sync/badgebase`) and **80** (`sync/global`), all neutral `data_sync`
rows the syncs emit themselves. No badge, profile, progress, unlock or visit row
was changed; the four 125-claims reported above were left in place (read-only).