# Verification round 21 — commit `9f57f09` (round-20 finding)

Scope: the six `ALLOW_ONE_OFF_MIGRATION` guards added to
`scripts/i18n-remove-vendor-texts.py`, `i18n-complete-translations.py`,
`i18n-stats-keys.py`, `i18n-short-labels.py`, `seed-gamification-blog.ts`,
`seed-xp-research.ts`, and the six questions they raise.

Method (read-only; nothing in the project was modified — no message file, DB
row, or script changed, no guarded path executed with the override). All six
scripts were **run without the override** and all six refused; `md5sum
messages/*.json` is byte-identical before and after and `git status` stayed
clean.

Severity counts: **0 high, 0 medium, 1 low, 2 info, 0 live defects.**

---

## v21-01 — LOW — source (latent; unguarded writer stays behind) — `scripts/i18n-fix-placeholders.py:29-31`

**Evidence.** `i18n-fix-placeholders.py` is the one message writer round-20
listed as "historical — one-off placeholder repair, now a no-op; rewrites files
anyway", and it is **not** among the six that got a guard. Its loop writes every
locale unconditionally (`io.open(path, "w", …)` at `:29`, `json.dump` at `:30`),
and it reassigns `data["steal"] = dict(sorted(steal.items()))` at `:27`.

The *values* are indeed a no-op today: `grep -rn "{BadgesCoins}" messages/`
returns nothing, so `changed` stays 0. But the live `steal` object is **not**
sorted —

```
messages/en.json steal = attempt, failed, hint, success, disabled
```

— so a re-run re-sorts it to `attempt, disabled, failed, hint, success` and
rewrites all 11 files. That is a real working-tree diff across 11 files, not the
"byte-identical" outcome the phrase "no-op" implies.

**Why it is a bug.** Same class the commit set out to close: an unguarded
one-off writer that mutates `messages/*.json` on re-run. It is Low because there
is no live trigger (nothing runs it) and no stale *value* is introduced — the
damage is churn/ordering only, and JSON key order is not meaningful to
next-intl. **Confidence.** High (file read + live `steal` inspection).
**Fix direction.** Give it the same guard as the six, or wrap the write in
`if changed:` so a true no-op does not touch the files.

## v21-02 — INFO — source — guard is import-time `SystemExit` / `process.exit` in all six

**Evidence.** The Python guard is a module-level `raise SystemExit(...)`
(`i18n-stats-keys.py:9`, `i18n-remove-vendor-texts.py:16`,
`i18n-complete-translations.py:16`, `i18n-short-labels.py:17`); the TS guard is a
module-level `process.exit(1)` (`seed-gamification-blog.ts:15`,
`seed-xp-research.ts:13`). Neither is behind `if __name__ == "__main__"` / a
`main()` call, so **importing** any of the six would terminate the importing
process.

**Why it is only INFO.** I checked exhaustively: no file in the repo imports any
of the six. `grep -rn "from …seed-|require(...seed-|i18n-remove-vendor-texts|
i18n-complete-translations|i18n-stats-keys|i18n-short-labels"` over all
`*.ts/*.tsx/*.mjs/*.js` finds nothing outside the scripts themselves; there is no
`importlib`/`runpy` use anywhere; the hyphenated Python names are not importable
as modules. So this cannot fire today — it is a constraint on future refactors.
**Confidence.** High. **Fix direction.** None required; if these ever become
importable, move the guard into the entry function.

## v21-03 — INFO — source — the override is env-based, and the TS seeds read `.env.local` *before* the guard

**Evidence.** `seed-gamification-blog.ts:10` and `seed-xp-research.ts:8` call
`config({ path: ".env.local" })` **before** the guard at `:15` / `:13`. Dotenv
loads `.env.local` into `process.env`, so a stray `ALLOW_ONE_OFF_MIGRATION=1` in
`.env.local` (or an inherited shell variable) silently re-arms the seed. The
Python guards use `os.environ` and are not dotenv-coupled, but inherit the same
shell env.

**Why it is only INFO.** The variable is absent today: `.env.local` holds only
the 20 project keys, and `grep -rn "ALLOW_ONE_OFF_MIGRATION" .env*` is empty; no
Vercel/CI/NPM config references it (`package.json`, `vercel.json`, the single
workflow `potat-sync.yml`, and `src/` are all clean). This is the intended
override, working as designed — recorded only so nobody "fixes" a stray run by
adding it to `.env.local`. **Confidence.** High.

---

## Per-script guard table (item 1)

| Script | Guard site | First write | Guard before every write? | Ran without override | Result |
|---|---|---|---|---|---|
| `scripts/i18n-remove-vendor-texts.py` | `:10-20` (`raise` `:16`) | `:193` `open(...,“w”)` | yes — only write is `:193-195`, inside the loop at `:177` | yes | refused, exit 1 |
| `scripts/i18n-complete-translations.py` | `:10-20` (`raise` `:16`) | `:519` `open(...,“w”)` | yes — only write is `:519-521` in the loop at `:513` | yes | refused, exit 1 |
| `scripts/i18n-stats-keys.py` | `:3-12` (`raise` `:9`) | `:468` `open(...,“w”)` | yes — only write is `:468-470` in the loop at `:460` | yes | refused, exit 1 |
| `scripts/i18n-short-labels.py` | `:10-20` (`raise` `:17`) | `:165` `open(...,“w”)` | yes — only write is `:165-167` in the loop at `:159` | yes | refused, exit 1 |
| `scripts/seed-gamification-blog.ts` | `:12-20` (`exit` `:15`) | `:178` `import("../src/lib/blog")` → `createFeaturePost` | yes — all `createFeaturePost` calls are in `main()` at `:188`, invoked `:195` | yes | refused, exit 1 |
| `scripts/seed-xp-research.ts` | `:10-18` (`exit` `:13`) | `:65` `import("../src/lib/blog")` | yes — single `createFeaturePost` in `main()` at `:66`, invoked `:77` | yes | refused, exit 1 |

Automated static check (first write line > guard line) returned OK for all six.
Post-run: `md5sum messages/*.json` identical; `git status --short` empty.

**Placement robustness (item 2).** None of the six has any statement before its
guard other than the module docstring (Python) or `import { config } from
"dotenv"` + `config({ path: ".env.local" })` (TS, read-only). No helper runs at
import time in any of them; the `json.dump`/`createFeaturePost` paths are all
below the guard. No file is imported by another module (see v21-02).

## Every reference found (item 3)

No reference exists in anything the project runs — **no regression**:

- `package.json` scripts: `db:apply`, `sync:global`, `sync:badgebase`,
  `sync:potat`, `send:push`, `log:change` — none of the six. No
  `seed`/`i18n` alias.
- CI: `.github/workflows/potat-sync.yml` (the only workflow) calls
  `/api/cron/potat` only.
- Cron routes `src/app/api/cron/{global,potat,badgebase}` — no reference.
- App / `src/` — no reference; there is no `prebuild`/`postinstall`/
  `buildCommand` hook, and `vercel.json` has cron entries only.
- Other scripts — no reference; `db-apply.ts` applies `supabase/migrations/*.sql`
  and never touches these files.
- Documentation: only `bugreports/AGENT-AUDIT.md` (`:646`, `:675-677`, `:684`) and
  the historical `bugreports/verify-round18..20.md`. `AGENTS.md` and `README.md`
  contain **no** mention of any of the six.
- Self-references only: the `ALLOW_ONE_OFF_MIGRATION` comments/guards in the six,
  and the `Run: npx tsx scripts/…` docstring lines in the two seeds.

## Item 4 — are the guards' values inert?

**Yes.** Every write path in the six now sits behind the guard, and the only way
past it is the explicit `ALLOW_ONE_OFF_MIGRATION=1` (Python `os.environ.get`
`!= "1"`; TS `process.env… !== "1"` — exact match, so `true`/`yes` do not arm
it). I found **no** other path by which a stale value in those six files reaches
`messages/*.json` or the database:

- No other module imports or `exec`s them (v21-02), so no import-time write.
- Nothing in `package.json`, CI, cron, `vercel.json` or `src/` runs them (item 3).
- The DB path (`createFeaturePost`) is reachable only from the two seeds (now
  guarded), the live Turbo-jackpot path in `src/lib/gamification/wheel.ts:90`
  (different content, by design), and nothing else; the new-badge path
  `createDropPost` writes no changelog row.
- `.env.local`, `.env.example`, Vercel and NPM configs carry neither the guard
  variable nor these scripts (v21-03).

The only bypass is the intended override, which is exactly the `!= "1"`/`!== "1"`
gate the commit documents.

## Item 5 — the remaining unguarded writers

Spot-checked, agreeing with round-20:

- `scripts/i18n-rename-vendor-keys.py` — **agree, safe/historical.** Its
  `raise SystemExit(f"{locale}: key {old} missing")` at `:30` fires before the
  write at `:34`. Executed it: `en: key potatLevel missing`, exit 1, messages
  byte-identical, tree clean.
- `scripts/i18n-fix-placeholders.py` — **partly agree.** Values are a no-op
  (verified: no `{BadgesCoins}` remains), so no stale value; but it is an
  unguarded file mutator and does produce a key-order diff on re-run → see
  **v21-01**.

I also independently re-checked round-20's "safe — idempotent, matches live"
verdict for the other four unguarded writers with an AST literal evaluator
(loads `LOCALES`/`NINE`/`ALL`, `TR`/`FAQ`/`DATA_A`/`QUESTION`/`ANSWER`/`OWNERS`
without executing the write loops, compares every value against the live
`messages/<locale>.json`):

| script | keys compared | mismatches |
|---|---|---|
| `i18n-customizer.py` | `TR` 27 × 9 locales | 0 |
| `i18n-faq-customizer.py` | `FAQ` 39 × 9 + `faq.dataA` × 11 | 0 |
| `i18n-faq-fair.py` | `faq.fairQ`/`faq.fairA` × 11 | 0 |
| `i18n-badges-owners.py` | `badges.owners` × 11 | 0 |

Also checked all ten `i18n-*.py` dict literals for **duplicate keys** (which
Python dedupes silently, dropping a locale set with no error): none
(`WHOLE` 8, `TR` 53/27/111/127, `FAQ` 39, `DATA_A` 11, `OWNERS` 11, `FRAGMENT`
11, `RENAME` 3 — all `dups=[]`). And spot-checked one DB writer, `db-apply.ts`:
idempotent via the `supabase_migrations` ledger and one transaction per
migration (`:29-54`) — **agree, safe.**

## Item 6 — convergence: is any *live* defect left?

**No.** Nothing in this commit's scope is a wrong behaviour a user or a sync can
hit today. The guards fire before every write in all six scripts (verified
statically and by executing all six — refusal, exit 1, message files
byte-identical, tree clean); placement is robust (nothing before them writes,
nothing imports them); they are referenced by nothing the project runs, so the
guards cannot break CI, cron, the app or a build; and the values are inert
except behind the explicit override. The three remaining items are latent
hazards only: **v21-01** (an unguarded one-off writer still mutates the files —
low, no live trigger), **v21-02** (import-time abort — info, no importer exists)
and **v21-03** (env-coupled override — info, variable absent everywhere). The
series' trend holds: the round-20 MEDIUMs were genuine live-reachable regressions
of live data, whereas this round closes them and leaves only dormant-writer
housekeeping.