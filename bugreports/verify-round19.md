# Verification round 19 — commit `4901eb2` (docs `1020962`)

Scope: the diff of `4901eb2` (`scripts/i18n-stats-keys.py`,
`scripts/seed-gamification-blog.ts`, `bugreports/verify-round18.md`) and the
**exhaustiveness claim** it makes: "all message files, every script that writes
them, every text column of the blog posts, changelog title+body, and the whole
source tree, case-insensitively. Nothing stale remains except the four
documented narration rows and one post slug."

Method (all read-only; no row or file modified):
- `git show 4901eb2`; full read of the three changed files and their diffs.
- AST/`compile()` checks of all 10 `scripts/i18n-*.py` message writers; array
  length vs. their own locale-convention check for every writer.
- Case-insensitive repo-wide greps for `125`, `12[0-9]`, `50/50/25`,
  `50 common`, `50 creative`, `fifty creative`, and the localized tier words
  (`50 comunes/creativos`, `50 комuni/обычных/творческих`, `50 普通/创意`,
  `50 コモン`, `50 일반`, `50 محطة/عادية/إبداعية`, `50 hitos/jalons/comuns/
  traguardi`) across `messages/**`, `scripts/**`, `src/**`, `supabase/**`,
  `README.md`, `AGENTS.md`.
- Read-only PostgREST sweep (service-role, SELECT only) of **all 46
  tables/views** returned by the OpenAPI root, first downloading the whole
  `definitions` map so nothing was omitted; every column of every row
  (`select=*`, paged, up to 6,000 rows/table) was walked recursively, including
  jsonb (`changelog.payload`, `profiles.customization`, `showcase_slots`,
  `potat_connections`) and text arrays (`blog_posts.tags`).
- Independent execution of the achievement module (`npx tsx`): `ACHIEVEMENTS`
  = 125 (50/50/25), `ACTIVE_ACHIEVEMENTS` = 123 (50 common / 48 creative / 25
  special).
- Live fetches of `/en/stats`, `/de/stats`, `/en/achievements`.

Severity counts: **1 medium, 0 high, 0 low.** The data-side sweep holds; the
defect is in one of the three files the commit changed.

---

## v19-01 — MEDIUM — source (dormant writer; the fix is self-contradictory) — `scripts/i18n-stats-keys.py:192-201` vs `:440-442`

**Evidence.** This commit's v18-01 repair rewrote `TR["achSubtitle"]`, and in
doing so **dropped two entries**: the array went from 11 values to 9.

```
192:    "achSubtitle": [
193:        "{total} objetivos en tres niveles",      # es
...
201:        "{total} هدفًا على ثلاث درجات",            # ar
202:    ],
```

The file's locale convention is unchanged and is 11-wide — `LOCALES` at line 6
is `["en","de","es","fr","pt","it","ru","zh","ja","ko","ar"]`, and the writer
enforces it:

```
440: missing = [key for key, values in TR.items() if len(values) != len(LOCALES)]
441: if missing:
442:     raise SystemExit(f"translation length mismatch: {missing}")
```

AST evaluation of `TR` (127 keys) reports **exactly one** non-11 array:
`achSubtitle` = 9. So `missing == ["achSubtitle"]` and the script now aborts
with `SystemExit: translation length mismatch: ['achSubtitle']` **before
writing anything**. Pre-commit (`4901eb2^`) the same check reported `non-11: []`;
this commit introduced the mismatch.

`grep -n achSubtitle` in the two scripts repaired in round 17 shows the cause:
`i18n-complete-translations.py:13` and `i18n-faq-customizer.py` use a **9**-locale
convention (`es…ar`), and the 9-value `achievements.subtitle` /
`faq.achievementsA` arrays are correct there. This third file, `i18n-stats-keys.py`,
uses the **11**-locale convention (every other array in it, e.g. `subtitle` at
:9, has 11 entries) — the 9-value pattern was copied onto a file that requires 11.

**Why it is a bug.** Two ways:
1. The script's documented purpose ("Adds the new /stats dashboard keys to all
   11 locale files", header line 1) can no longer be served — it exits
   immediately, in every invocation. The commit's statement "the values are
   taken from the live message files and the Python parses" is only half true:
   `compile()` succeeds, but the module cannot run, and the en/de live values
   (`"{total} goals across three tiers"` / `"{total} Ziele in drei Stufen"`) are
   not carried at all, so the array is not a faithful copy of the message files.
2. It is the **third consecutive round** in which this same "hardcoded
   achievement count" class was "fixed" and the fix introduced a fresh defect
   (v17-01 → v18-01 → here). The array is now index-misaligned with its own
   writer: if the guard is removed or relaxed, `values[0]` (Spanish) would be
   written to `en.json` and `values[1]` (French) to `de.json`, cascading
   across all 11 files; the likeliest naive repair (shortening `LOCALES` to 9)
   would break the other 126 keys and corrupt every message file.

**Mitigation that lowers the blast radius (why medium, not high):** because the
guard fires first, a re-run fails safe — it writes nothing and does not
re-create the 123-KPI / 125-subtitle contradiction v17-01 fixed. No production
row or file is affected today.

**Confidence.** High — file read; AST-extracted array length; the guard
evaluated with the file's own `TR` and `LOCALES`; cross-checked against the
pre-commit revision (`git show 4901eb2^:scripts/i18n-stats-keys.py` → no non-11
array) and against the 9 other `i18n-*.py` writers (all internally consistent:
seven 11-wide, three 9-wide).

**Fix direction.** Restore the array to 11 entries in `LOCALES` order, with the
live values — prepend `"{total} goals across three tiers"` (en) and
`"{total} Ziele in drei Stufen"` (de) and keep the nine existing entries
(verified byte-identical to the live `messages/<locale>.json` values, in
`es,fr,pt,it,ru,zh,ja,ko,ar` order). Alternatively convert the whole file to the
9-locale convention used by `i18n-complete-translations.py` (both `LOCALES` and
all 127 arrays), which is a larger, riskier edit. Either way, re-run the guard
mentally (`len(values) == 11` for every key) before committing.

---

## Premise notes (verified, not defects)

1. **Narration rows — 4 named + 1 self-referential, all accurate.** Every
   `125` in the live `changelog` occurs in exactly five rows: **292, 296, 300,
   301 and 302** (302 is the entry this commit itself wrote, so the sweep's
   "four" is correct as of the sweep). Every occurrence is narration quoting the
   retired number while explaining a correction — `292` ("123 der ursprünglich
   125 Errungenschaften sind aktiv"), `296` ("von 125 auf 123 korrigiert", plus
   quotes of the old `'125 goals…'` / `'125: 50 common…'` strings), `300`
   ("Dort stand noch 50/50/25 (=125)"), `301` ("sie zeigte danach 125
   Errungenschaften in der Kennzahl"), `302`. **None asserts 125 as the current
   catalog size.** Row 296's closing sentence "Kein Blog-Eintrag enthält noch
   125" is a false meta-claim, but it is historical and explicitly retracted by
   row 300 (already on the record). No finding.
2. **The corrected bodies are accurate.** `changelog` ids 22, 45, 68, 91, 114,
   137 now all read "50 common milestones, 48 creative challenges and 25 truly
   unexpected specials"; `blog_posts.excerpt` for
   `achievements-system-125-trophies` reads 48; the seed excerpt (line 56) reads
   48. The real active split is **50 common / 48 creative / 25 special = 123**
   (executed module), so 50/48/25 is the right correction. **The true numbers do
   not differ from 50/48/25.**
3. **Scope caveats to the "nothing stale" wording (both previously reported /
   deliberate).** (a) `AGENTS.md:30` still reads "125 achievements"; `AGENT-AUDIT`
   v17-03 records this as deliberately left because AGENTS.md is the project's
   instruction file and the decision is the user's. The commit's phrase "the
   whole source tree" therefore overreaches by one known, disclosed line — not a
   new finding. (b) The 125 slug is not only in `blog_posts.slug` but also in
   `changelog.payload.slug` for the six announcement rows (22/45/68/91/114/137);
   same benign link-stability exception. `bugreports/**` is full of 125 by
   design (audit history) and is out of scope.

---

## Surfaces swept and found clean

1. **`messages/*.json` (11 files).** No `125`/`124` and no hardcoded achievement
   count in any key/locale; `stats.achSubtitle`, `achievements.subtitle` and
   `faq.achievementsA` are ICU templates (`{total}`/`{common}`/`{creative}`/
   `{special}`) in all 11. The only other "N common" strings
   (`profileA`, `customizer.*`) describe the 20/15 profile-customization split,
   not achievements.
2. **Message-writing scripts (10).** Only `i18n-stats-keys.py` carries
   achievement-count text (v19-01). `i18n-complete-translations.py`,
   `i18n-customizer.py`, `i18n-faq-customizer.py`, `i18n-short-labels.py`,
   `i18n-badges-owners.py`, `i18n-faq-fair.py`, `i18n-fix-placeholders.py`,
   `i18n-remove-vendor-texts.py`, `i18n-rename-vendor-keys.py`: no `12x`, no
   hardcoded count, and every array matches its own locale convention.
3. **Blog/XP seed and migrations.** `seed-gamification-blog.ts` is
   self-consistent (title 123, excerpt 50/48/25, content "exactly 123" + "fifty
   common" + "forty-eight creative" + "twenty-five specials"); the launch post
   says 123 twice; `seed-xp-research.ts:22` says 123; migration 0003 is clean.
   Only the disclosed slug remains.
4. **`changelog` — all 302 rows, all columns incl. `payload` jsonb.** The only
   `12x` hits are the five narration rows + the 123-correct rows + the six
   `payload.slug`s. No row asserts a stale size; no wrong tier split remains.
5. **`blog_posts` — all rows, all columns (slug, title, excerpt, content,
   cover_url, author, status, locale, tags).** 123/48 everywhere it matters;
   `12x` in other posts is unrelated arithmetic (e.g. "128× fair value").
6. **Every other table/view (all 46).** `profiles` (bio, mood, color, theme,
   banner_url, `customization` jsonb, `showcase_slots`, `potat_connections`),
   `notifications`, `activity_events`, `badge_events`, `user_achievements`,
   `user_progress`, `badges`, `badge_stats` (5,997 rows), `system_heartbeats`
   (81), `game_rounds`, `profile_visits`, `steal_attempts`, `turbo_wins`,
   `push_subscriptions`, `coin_rain_gate`, `blog_views`, `blog_reactions`,
   `follows`, `user_inventory`, `user_sync_state`, `collector_stats`,
   `supabase_migrations`, all `stats_*` views/badge_momentum: no stale
   achievement count. (`12x` matches there are ISO timestamps / unrelated ids.)
7. **`src/**`.** The only `12x` achievement hits are two narration comments
   (`faq/page.tsx:59`, `stats/page.tsx:290-291`) and the structural
   `// ---------- 50 common/creative/special ----------` section headers in
   `achievements.ts` (accurate for the 125 definitions). All render sites derive
   counts from `ACTIVE_ACHIEVEMENTS`: `achievements/page.tsx:24-27,72-75`,
   `faq/page.tsx:63-66`, `stats/page.tsx:292-297,502,825-826,849`.
8. **README.md:72** reads 123; no other achievement count in the file.
9. **Live site (item 4).** `/en/stats` renders "123 goals" with Common / Creative
   / Special tiles, `/de/stats` "123 Errungenschaften · 123 Ziele",
   `/en/achievements` "123 achievements to hunt — 50 common, 48 creative, 25
   unexpectedly special". The number the pages compute (from
   `ACTIVE_ACHIEVEMENTS`) matches the source and the executed module. **The
   pages' 123 is correct.**
10. **Gates claim.** `4901eb2`'s "lint 0 / typecheck 0 / build 227 / 0
    MISSING_MESSAGE" was not independently re-run (a full `next build` is not
    cheap here); it is outside the changed files' risk surface.

**Bottom line on the exhaustiveness claim:** the data-side claim holds — no
stale achievement count remains in any message file, in any database text
column of any table, in any blog post, or in any changelog title/body, other
than the documented slug and the narration rows. It does **not** hold in two
precise senses: the `scripts/i18n-stats-keys.py` repair is itself broken
(v19-01), and the absolute phrase "the whole source tree" is contradicted by
`AGENTS.md:30` (a previously reported, deliberate exception).