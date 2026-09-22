# Verification — Round 22

Scope: commit `33d7eb9` ("fix(scripts): close the class — no unguarded message
writer remains"). Read-only. No project file was modified; `messages/*.json`
was hashed before and after every probe and stayed byte-identical.

Verdict up front: **no live defect**. Every guard added by this commit fires
before every write, all six files still parse, the classification claim
("no unguarded message writer") reproduces exactly, and nothing in the app,
cron, CI or `package.json` can reach the guarded files. The findings below are
one low (an undocumented operational knob) and two informational
(docstring/commit-wording accuracy) — none of them changes behaviour.

---

## Findings

### v22-01 — `ALLOW_ONE_OFF_MIGRATION` is not documented in `.env.example` — low

- **Side:** ops / documentation
- **File:** `.env.example` (missing entry); guard at
  `scripts/i18n-badges-owners.py:8` (and 9 other `.py` files, plus
  `scripts/seed-xp-research.ts:13`, `scripts/seed-gamification-blog.ts:15`)
- **Evidence:** `.env.example` contains no `ALLOW_ONE_OFF_MIGRATION` line.
  `grep -rn ALLOW_ONE_OFF_MIGRATION src/ package.json .github/ vercel.json`
  returns nothing — the only readers are the one-off `.py` scripts and the two
  `.ts` seeds. `.env.example` already documents script-only knobs
  (`SUPABASE_DB_URL` "Only needed for `npm run db:apply`"), so a new
  script-facing variable belongs there.
- **Why it is a bug:** this is a brand-new operational knob introduced by the
  commit. A maintainer who trips a guard has no `.env.example` entry to consult;
  they must open a script to learn the variable exists. Worse, the six `.py`
  guards read `os.environ` directly and do **not** load `.env.local`, so the
  variable only works if exported in the shell (`ALLOW_ONE_OFF_MIGRATION=1 python
  scripts/…`) — the two `.ts` seeds do `config({path:".env.local"})` before their
  guard, so for them `.env.local` *does* work. Documenting it removes that
  asymmetry of expectation.
- **Confidence:** high (deterministic grep).
- **Fix direction:** add a commented block to `.env.example`, e.g.
  `# One-off migration/seed override (scripts only, never the app): set to 1 to let a guarded one-off script run. ALLOW_ONE_OFF_MIGRATION=`
- **Note:** round 21's `v21-02/v21-03` (info) already observed the variable
  appears in no config and judged "no change needed". It is re-raised here
  because item 4 of this round explicitly classifies an undocumented knob as a
  small defect. If the project prefers to keep it undocumented, this is a
  deliberate accept, not a miss.

### v22-02 — `i18n-faq-customizer.py` docstring overstates what it writes — info

- **Side:** scripts / documentation
- **File:** `scripts/i18n-faq-customizer.py:1-2` (docstring), body at `:485-513`
- **Evidence:** the docstring says "FAQ (40) + customizer (27) for the 9 locales
  …". An AST count of the script's data shows `FAQ` = **39** keys and **zero**
  keys whose name starts with `customizer.`; the body writes only `FAQ` entries
  plus `faq.dataA`. The "customizer (27)" half lives in the sibling
  `scripts/i18n-customizer.py` (`TR` = 27 keys, verified).
- **Why it is a bug:** item 1 of this round asks that each guarded script's
  docstring match what it does. This one names work it does not perform and a
  count that is off by one. It is documentation drift only — the guard text
  inserted by the commit is itself accurate for this file (all 39 FAQ values and
  all 11 `dataA` values match live; see the table below), and the script is
  guarded, so there is no runtime effect.
- **Confidence:** high.
- **Fix direction:** correct the docstring to "FAQ (39) for the 9 locales, plus a
  vendor-free `faq.dataA` in all 11", and drop the `customizer (27)` clause
  (that belongs to `i18n-customizer.py`).

### v22-03 — commit's "a re-run would currently be a no-op" is imprecise for two of the five — info

- **Side:** scripts / commit reasoning
- **File:** commit `33d7eb9` message; `scripts/i18n-badges-owners.py:41`,
  `scripts/i18n-faq-fair.py:107`, `scripts/i18n-rename-vendor-keys.py:41`
- **Evidence:** the commit says the five newly guarded scripts' "values match
  live today, so a re-run would currently be a no-op". Values do match (0 diffs,
  table below), but:
  - `i18n-badges-owners.py` does `data["badges"] = dict(sorted(badges.items()))`
    and live `badges` is **not** sorted (`en/de/ar` all `sorted? False`) — a run
    would reorder keys;
  - `i18n-faq-fair.py` does `data["faq"] = dict(sorted(faq.items()))`, live `faq`
    is **not** sorted — a run would reorder keys;
  - `i18n-rename-vendor-keys.py` would **abort** (`raise SystemExit("… potatLevel
    missing")` at `:41`) because the old keys are already gone in all 11 locales.
  Only `i18n-customizer.py` and `i18n-faq-customizer.py` are literal no-ops.
- **Why it is a bug:** it is a wording/claim defect, not a behavioural one. No
  value would have been reverted (item 5's actual test), so the commit's core
  reasoning stands and the guard protects the files regardless. Recorded so the
  audit trail does not carry a claim that a future reader could test and find
  false.
- **Confidence:** high.
- **Fix direction:** none required; if the audit is amended, say "values match
  live; two of them would additionally re-sort an object and one would abort".

---

## Independent classification table

Re-derived from the files, not from the commit text.

### Scripts that write `messages/*.json`

10 total. All guarded; **no unguarded message writer exists** — the commit's
claim reproduces.

| Script | Guard | Guard line | First write | Notes |
|---|---|---|---|---|
| `i18n-badges-owners.py` | yes (this commit) | 8 | 42 | re-sorts `badges` |
| `i18n-customizer.py` | yes (this commit) | 8 | 236 | 27 keys × 9 locales, all match live |
| `i18n-faq-customizer.py` | yes (this commit) | 14 | 498 | 39 FAQ × 9 + dataA × 11, all match live |
| `i18n-faq-fair.py` | yes (this commit) | 8 | 109 | re-sorts `faq` |
| `i18n-fix-placeholders.py` | yes (this commit) | 13 | 40 | re-sorts `steal` (the v21-01 file) |
| `i18n-rename-vendor-keys.py` | yes (this commit) | 14 | 45 | aborts on re-run (old keys gone) |
| `i18n-complete-translations.py` | yes (round 20, `9f57f09`) | — | — | |
| `i18n-remove-vendor-texts.py` | yes (round 20) | — | — | |
| `i18n-short-labels.py` | yes (round 20) | — | — | |
| `i18n-stats-keys.py` | yes (round 20) | — | — | |

Non-writers checked and cleared: `bugreports/audit-*.mjs` (read-only; no
`writeFile`/`appendFile` anywhere), `src/i18n/request.ts` (dynamic `import()` of
the JSON only). No `.py` file exists outside `scripts/`.

### Scripts that write the database

| Script | Kind | Guard | Classification |
|---|---|---|---|
| `scripts/db-apply.ts` | schema migrations | no | **Correctly unguarded** — `supabase_migrations` ledger (`db-apply.ts:29-53`); documented `npm run db:apply` |
| `scripts/log-change.ts` | changelog insert | no | **Correctly unguarded** — appends a row by design; documented `npm run log:change` (AGENTS.md). Not idempotent, but it is the intended manual tool, not a one-off migration |
| `scripts/seed-gamification-blog.ts` | content seed | **yes** | one-off seed; appends changelog row per run |
| `scripts/seed-xp-research.ts` | content seed | **yes** | one-off seed |
| `scripts/sync-global.ts` | sync (via `src/lib/syncs/global`) | no | **Correctly unguarded** — idempotent upserts; `npm run sync:global` + cron |
| `scripts/sync-badgebase.ts` | sync | no | idempotent; `npm run sync:badgebase` |
| `scripts/sync-potat.ts` | sync | no | idempotent; `npm run sync:potat` + 15-min GitHub Action |
| `scripts/send-push.ts` | web push | no | not a one-off; documented `npm run send:push` |
| `scripts/verify-atomic-economy.ts` | test (writes + restores) | no | **Deliberate** (known, per instructions) |
| `scripts/verify-game-economy.ts` | test | no | read-only — stubbed Supabase proxy, 0 real writes |

**Difference from the commit's list: none.** My message-writer set is exactly the
commit's (4 prior + 6 now = 10), and my DB-writer reasoning matches (syncs
idempotent, migrations ledger-protected, `verify-atomic-economy.ts` deliberate).
The only nit is that the commit's blanket "the database writers … are idempotent"
technically over-covers `log-change.ts`, which is append-only — but it is the
documented manual changelog tool, so leaving it unguarded is right.

---

## Guard correctness checks (item 3)

- **Guard precedes every write:** guard line < first-write line in all six files
  (`8<42`, `8<236`, `14<498`, `8<109`, `13<40`, `14<45`).
- **Parses:** all six pass `ast.parse`.
- **Fires:** all six run under plain `python scripts/<f>.py` print
  `Refusing to re-run: this is a one-off migration. Set ALLOW_ONE_OFF_MIGRATION=1
  to override.` and exit before any write; `messages/*.json` md5 unchanged.
- **Docstrings vs behaviour:** all six write only `messages/*.json` (no DB, no
  other paths). Only `i18n-faq-customizer.py`'s docstring is inaccurate (v22-02).
- **Too-eager check:** none of the six is referenced by README, AGENTS.md,
  `package.json`, `.github/` (only `potat-sync.yml`, which hits the cron route) or
  any other script — only `bugreports/verify-*.md`. No documented workflow is
  blocked by the guards, so no guard is over-eager.
- **Override path documented where a maintainer looks:** in each script's own
  comment block, and the refusal text names the variable and the value to set —
  actionable. Not in `.env.example`/README (v22-01).

## `ALLOW_ONE_OFF_MIGRATION` reachability (item 4)

- Documented in `.env.example`: **no** (v22-01).
- Cannot affect the running application: **confirmed** — `grep` for the token in
  `src/`, `package.json`, `.github/`, `vercel.json` yields nothing; the token is
  read only inside `scripts/` (10 `.py` guards + 2 `.ts` seeds). The app never
  loads these files.

## Five newly guarded scripts vs live values (item 5)

| Script | Keys compared | Value diffs vs live | Would a run be… |
|---|---|---|---|
| `i18n-badges-owners.py` | `badges.owners` × 11 | **0** | no value change; **re-sorts `badges`** |
| `i18n-customizer.py` | `TR` 27 × 9 locales | **0** | no-op |
| `i18n-faq-customizer.py` | `FAQ` 39 × 9 + `dataA` × 11 | **0** | no-op |
| `i18n-faq-fair.py` | `fairQ`/`fairA` × 11 | **0** | no value change; **re-sorts `faq`** |
| `i18n-rename-vendor-keys.py` | `potatLevel/potatoes/potatSince` → `community*` | old keys absent in all 11 | **aborts** before writing |

No script would have **reverted a value** — the commit's core reasoning holds.
The "no-op" wording is imprecise for two of the five (v22-03).

## Can this commit break the app or the syncs? (item 6)

No. The guards are module-level `raise SystemExit` in files that nothing in
`src/`, the cron routes, CI or `package.json` imports or invokes. `package.json`
has no entry for any `i18n-*.py` (only `db:apply`, `sync:*`, `send:push`,
`log:change`, all untouched). No build/typecheck input is affected (the guarded
files are Python; `tsc` does not see them).

## Surfaces found clean

- Six guards present, correctly ordered, files parse, guards fire, messages
  byte-identical — verified by execution.
- Classification: 10/10 message writers guarded; no unguarded message writer.
- No `src/`, cron, CI, `package.json` or cross-script reference to any guarded
  file.
- `ALLOW_ONE_OFF_MIGRATION` unreachable from the application.
- Five newly guarded scripts: zero value diffs against live.
- `verify-game-economy.ts` and `bugreports/audit-*.mjs` are read-only.
- Working tree: only pre-existing unrelated edits (`src/…`, two new migrations);
  nothing touched by this verification.
