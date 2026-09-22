# Verification round 20 — commit `c1ffa34` (round-19 finding)

Scope: the diff of `c1ffa34` (`scripts/i18n-stats-keys.py` only, +2 lines) and the
question it opens — whether the ten `scripts/i18n-*.py` message writers can be
re-run without reintroducing stale or wrong values.

Method (all read-only; no message file, DB row or script modified, no writer
executed):
- `git show c1ffa34`, plus the file lists and diffs of `96a1519`, `4901eb2`,
  `52aa2b9`, `8dd69ac`.
- An AST parser (custom literal evaluator handling `["x"] * 11`) that loads each
  script's `LOCALES` / `NINE` / `ALL` and its translation container **without
  executing the write loop**, then compares, for every key and every locale, the
  script's value against the live `messages/<locale>.json`.
- Cross-checks with `git log -S` to date each divergence.

Severity counts: **2 medium, 3 low, 0 high.**

---

## Part 1 — `scripts/i18n-stats-keys.py` (the commit under review)

The c1ffa34 repair itself is **correct**:

- Every one of the **127** arrays in `TR` now has length **11** = `len(LOCALES)`,
  so the file's own `translation length mismatch` guard (`:442-444`) passes.
- `achSubtitle` (`:192-204`) is in `LOCALES` order (`en, de, es, fr, pt, it, ru,
  zh, ja, ko, ar`) and **all 11 values equal the live file**, including the
  restored `en` (`"{total} goals across three tiers"`) and `de`
  (`"{total} Ziele in drei Stufen"`). The round-19 finding v19-01 is genuinely
  closed.

But the commit message's stronger claim — "**every value** is compared against
the live message file" — does not hold, and the script still disagrees with live:

## v20-01 — MEDIUM — source (dormant writer; re-run reverts live) — `scripts/i18n-remove-vendor-texts.py:55,68,81` (+ write loop `:165-183`, raise `:200-201`)

**Evidence.** `WHOLE` contains `profile.potatLevel` (`:55`), `profile.potatoes`
(`:68`) and `profile.potatSince` (`:81`). All three keys are **absent from all 11
live message files** (verified per locale), because
`scripts/i18n-rename-vendor-keys.py` renamed them to
`communityLevel` / `communityPoints` / `communitySince`. The write loop runs
`put(data, key, values[locale])` and `json.dump(...)` for every locale *before*
the trailing `if problems: raise SystemExit(...)`.

**Why it is a bug.** Re-running this script would (a) re-add the three
vendor-named `profile.potat*` keys to all 11 files — the exact payload-vendor
string phase 4 removed and which `AGENTS.md` treats as forbidden — and (b)
because the `badges.rarityFormula` fragments it looks for no longer exist in any
locale, it appends 11 `problems`, writes **all 11 files anyway**, then exits
non-zero. The abort is cosmetic; the damage is already on disk. The live code
reads only `t("communityLevel"|"communityPoints"|"communitySince")`
(`src/app/[locale]/profile/[username]/page.tsx:349,357,369`), so the re-added
keys are orphans that still ship a vendor string in the rendered payload.

**Confidence.** High (AST parse + per-locale live diff + `git log -S`).
**Fix direction.** Delete the three `profile.potat*` entries from `WHOLE` (they
are historical), or convert the trailing `raise` into a pre-write validation so
a re-run cannot write partial state.

## v20-02 — MEDIUM — source (dormant writer; re-run reverts live) — `scripts/i18n-complete-translations.py:267`

**Evidence.** `"games.blackjackTitle": ["Badge Blackjack"] * 9` while live holds
the localised titles for all nine locales it targets:
`es "Blackjack de insignias"`, `fr "Blackjack de badges"`, `pt "Blackjack de
emblemas"`, `it "Blackjack dei badge"`, `ru "Блэкджек со значками"`,
`zh "徽章 21 点"`, `ja "バッジブラックジャック"`, `ko "배지 블랙잭"`,
`ar "بلاك جاك الشارات"`. The divergence dates to `52aa2b9` — the same commit
that *added this script* also added `scripts/i18n-short-labels.py` with the
localised titles (`i18n-short-labels.py:70`) and wrote the localised values into
`messages/*.json`. So two scripts shipped in one commit contradict each other on
this key.

**Why it is a bug.** Widths are fine (9 = `len(LOCALES)`), so the script's own
guard passes; a re-run after `i18n-short-labels.py` would silently revert nine
localised game titles to the English placeholder. Order-dependent correctness is
not correctness.

**Confidence.** High.
**Fix direction.** Drop the `games.blackjackTitle` entry from `TR` (it is a
no-op key that only exists to write English), or align it with the live values.

## v20-03 — LOW — source + overclaimed verification — `scripts/i18n-stats-keys.py:177`

**Evidence.** `"hallOfFame"` index 5 (`it`) is `"Hall of fame"`; live
`messages/it.json` `stats.hallOfFame` is `"Albo d'oro"`. It has been
`"Albo d'oro"` since `52aa2b9`; the script's value has been `"Hall of fame"`
since its introduction (`8dd69ac`). This is the **only** `stats.*` key where the
script and live disagree (127 keys checked).

**Why it is a bug.** It falsifies the c1ffa34 claim that every value in this
script was compared against live: a re-run would revert Italian `Albo d'oro`.
The defect is latent (the script is dormant), so it is Low — but the round-19
verification method is overstated and should not be trusted as exhaustive for
this file.

**Confidence.** High.
**Fix direction.** Update the `it` slot to `"Albo d'oro"`, or add a live-file
equality assertion to the script's guard so this class of drift fails loudly.

## v20-04 — LOW — source (dormant writer; re-run reverts live) — `scripts/i18n-short-labels.py:40,121`

**Evidence.** `customizer.font` index 3 (`it`) = `"Font"` vs live `"Carattere"`;
`stats.hallOfFame` index 3 (`it`) = `"Hall of fame"` vs live `"Albo d'oro"`.
Both live values were set by `52aa2b9`, in the same commit that added this
script (the script was not updated). All 111 arrays are 9-wide = `len(LOCALES)`
and every other value matches live.

**Why it is a bug.** Same class as v20-02/v20-03: re-running reverts two Italian
strings. Low because it is dormant and only two strings.

**Confidence.** High.
**Fix direction.** Align the two `it` slots with live.

---

## Part 2 — the two scripts the commit claimed were checked

- **`scripts/i18n-faq-customizer.py`** — claim **holds**. `FAQ` is 39 keys, all
  arrays 9-wide = `len(NINE)`; `DATA_A` covers all 11 locales; every value
  (including `faq.dataA` in `en`/`de`) equals live. Re-running is idempotent.
- **`scripts/i18n-complete-translations.py`** — claim is **half true**. It is
  structurally correct (all 53 arrays 9-wide = `len(LOCALES)`, placeholders
  present), but the "values matching live" half is false: see v20-02 (9 keys
  diverge). The commit checked width and placeholders, not value equality.

---

## Part 3 — the remaining i18n writers

| Script | Parses | Arrays internally consistent | Re-run vs live |
|---|---|---|---|
| `i18n-rename-vendor-keys.py` | yes | `RENAME` 3 entries, `LOCALES` 11 | old keys gone in all 11, new present in all 11 → re-run hits `raise SystemExit` (`:30`) and aborts **before** writing. Safe (guarded), historical |
| `i18n-remove-vendor-texts.py` | yes | `WHOLE` 8 keys ×11, `FRAGMENT` 11 locales | **differs** — re-adds 3 stale keys, writes then aborts (v20-01) |
| `i18n-fix-placeholders.py` | yes | string-replace, no arrays | live `steal.success/failed` already carry `{coins}` (0 hits of `{BadgesCoins}`); re-run is a content no-op but still rewrites all 11 files. Historical |
| `i18n-badges-owners.py` | yes | `OWNERS` keyed by all 11 locales | every value matches live `badges.owners`. Safe |
| `i18n-customizer.py` | yes | 27 arrays 9-wide = `len(LOCALES)` | every value matches live. Safe |
| `i18n-short-labels.py` | yes | 111 arrays 9-wide = `len(LOCALES)` | 2 `it` values diverge (v20-04) |
| `i18n-faq-fair.py` | yes | `QUESTION`/`ANSWER` 11-wide = `len(LOCALES)`, order `en…ar` verified | every value matches live `faq.fairQ`/`faq.fairA`. Safe |
| `i18n-faq-customizer.py` | yes | 39 arrays 9-wide; `DATA_A` 11 locales | matches live. Safe |
| `i18n-complete-translations.py` | yes | 53 arrays 9-wide | 9 `games.blackjackTitle` diverge (v20-02) |
| `i18n-stats-keys.py` | yes | 127 arrays 11-wide = `len(LOCALES)` | 1 `it` value diverges (v20-03) |

No script has an array whose width matches but whose *order* is wrong: every
divergence found is a single stale value, never a shifted assignment.

## v20-05 — LOW — re-run side effect (DB) — `src/lib/blog.ts:94`, callers `scripts/seed-gamification-blog.ts:168`, `scripts/seed-xp-research.ts:55`

**Evidence.** `createFeaturePost` upserts `blog_posts` with
`onConflict: "slug", ignoreDuplicates: true` (idempotent), but then
unconditionally `insert`s a `changelog` row (`src/lib/blog.ts:94`). Re-running
either seed script therefore appends a duplicate "Blog post published: …" row to
`/changelog` while the post itself is unchanged.

**Why it is a bug.** Minor: it pollutes the changelog and its RSS feed, which
`AGENTS.md` says is generated entirely from that table. No data is corrupted.
**Confidence.** High (code read). **Fix direction.** Guard the changelog insert
on whether the blog upsert actually inserted (`ignoreDuplicates` returns no row),
or make the changelog row unique by `payload->>slug`.

---

## Part 4 — re-run safety of every writer in `scripts/`

| Script | Writes to | Verdict |
|---|---|---|
| `i18n-remove-vendor-texts.py` | `messages/*.json` | **needs guard** — re-adds 3 vendor keys, writes before aborting (v20-01) |
| `i18n-complete-translations.py` | `messages/*.json` | **needs guard** — reverts 9 `games.blackjackTitle` (v20-02) |
| `i18n-short-labels.py` | `messages/*.json` | **needs guard** — reverts 2 `it` strings (v20-04) |
| `i18n-stats-keys.py` | `messages/*.json` | **needs guard** — reverts `it` `stats.hallOfFame` (v20-03) |
| `i18n-rename-vendor-keys.py` | `messages/*.json` | **historical** — self-guards (`SystemExit` if old key absent), aborts before write |
| `i18n-fix-placeholders.py` | `messages/*.json` | **historical** — one-off placeholder repair, now a no-op; rewrites files anyway |
| `i18n-customizer.py` | `messages/*.json` | safe — idempotent, matches live |
| `i18n-faq-customizer.py` | `messages/*.json` | safe — idempotent, matches live |
| `i18n-faq-fair.py` | `messages/*.json` | safe — idempotent, matches live |
| `i18n-badges-owners.py` | `messages/*.json` | safe — idempotent, matches live |
| `seed-gamification-blog.ts` | DB (`blog_posts` upsert + `changelog` insert) | **needs guard / one-shot** — duplicate changelog row per re-run (v20-05) |
| `seed-xp-research.ts` | DB (same helper) | **needs guard / one-shot** — same duplicate-changelog side effect |
| `send-push.ts` | external (web push) | **one-shot** — re-run re-notifies every subscriber |
| `log-change.ts` | DB (`changelog` insert) | safe by design — appending is its purpose |
| `db-apply.ts` | DB (migrations + `supabase_migrations` ledger) | safe — ledger makes it idempotent |
| `sync-global.ts` | DB (catalog/badgebase) | safe — sync engine, authoritative & idempotent by design |
| `sync-badgebase.ts` | DB | safe — same engine |
| `sync-potat.ts` | DB | safe — same engine, chunked upserts |
| `verify-atomic-economy.ts` | DB (creates a test profile, deletes it in `finally`) | safe — self-cleaning; only residue risk is a crash mid-run |
| `verify-game-economy.ts` | none (in-process stub) | safe — read-only simulation |

**Bottom line.** Four message writers and the two seed scripts are unsafe to
re-run as-is; two more are historical no-ops that nonetheless rewrite files.
None of these is reachable from CI, a cron route or the app — they are manual
one-off migrations — so this is latent debt, not a live defect. The fix is
uniform: either delete the historical entries or make each script assert its
values against the live file before writing.

---

## Clean surfaces found

- `scripts/i18n-stats-keys.py`: 127/127 arrays 11-wide, own guard passes,
  `achSubtitle` in correct locale order and all 11 values equal live (the
  c1ffa34 fix is correct).
- `scripts/i18n-customizer.py` (27 keys), `scripts/i18n-faq-customizer.py`
  (39 keys + `faq.dataA` ×11), `scripts/i18n-faq-fair.py` (`fairQ`/`fairA` ×11),
  `scripts/i18n-badges-owners.py` (`badges.owners` ×11): all widths match their
  own locale list and **every value equals live** → idempotent.
- `scripts/i18n-rename-vendor-keys.py`: guard intact, rename fully applied in
  all 11 locales, no `potat*` key left in the `profile` namespace.
- `scripts/i18n-fix-placeholders.py`: no `{BadgesCoins}` placeholder remains in
  any locale's `steal.success`/`steal.failed`.
- `db-apply.ts`, the three `sync-*.ts` engines and `log-change.ts`: idempotent
  or append-by-design.
