# Bug Hunt Brief — shared context for all Bug-Hunter agents (2026-10-06)

Project: Twitch Badges Database — Next.js 16 App Router + TypeScript + Tailwind v4 + next-intl (11 locales) + Supabase/Postgres + Vercel. Repo root: `C:\Users\LUL\Twitch-Badges-Database`. **Read `AGENTS.md` at repo root FIRST** — it defines architecture rules and known gotchas (all previously hit and fixed; do not re-report those).

## Rules for every agent
- **READ-ONLY HUNT**: never modify/create/delete files, never run `npm run build|dev|verify`, no `git` write commands, no network (skip WebFetch/WebSearch). Read/Grep/Glob only; Bash only for read-only inspection (e.g. `ls`, `wc -l`, `grep`).
- Stay inside your assigned scope. Other agents cover the rest — no gaps needed.
- Report **specific** findings with exact `path:line`. No style nits, no speculative "could be slow".

## Known false-positive traps (do NOT re-report)
- PostgREST returns bigint counts as **strings**; `.then()` on a PostgrestBuilder yields PromiseLike **without** `.catch` (needs `Promise.resolve()` wrapper) — flag MISSING wrappers as bugs, but the pattern `await` directly is fine.
- stats views may be absent on un-migrated DBs; pages that `.catch(() => …)` into empty states are intentional.
- `admin_adjust` activity rows are deliberately excluded from feed/SSR/counter but included in aggregates — by design.
- Ordinary arcade rounds deliberately write NO feed row (inventory unions `game_rounds`); theft victim rows come from `steal_attempts` — by design.
- `data-reset` parsing is forbidden by doctrine (badgebase) — code must NOT read it; if it doesn't, fine.
- Per-user badge ownership has no official API (perfil + GQL fallback is the design).
- React Compiler lint rules (no sync setState in effects, no Date.now() in render) are known — report violations not covered by existing `eslint-disable` comments with a reason.

## Severity scale
- **P0** = security hole, data loss, economy exploit/ledger corruption
- **P1** = user-visible bug or broken feature
- **P2** = edge-case bug / wrong behavior under conditions
- **P3** = latent risk / smell that will bite
- **P4** = DESIGN, ui/ux fixes

## Report format (your ENTIRE final message — dense, max ~45 lines)
```
FINDINGS (n):
1. path:line — [P0-P3] — one-line issue — fix hint — (verified: yes|likely|no)
...
COVERAGE: <files/areas actually read> | SKIPPED: <anything> | COUNT: n
```
`verified: yes` = you read enough surrounding code to be confident; `no` = honest unconfirmed lead. Never claim more certainty than you have.
