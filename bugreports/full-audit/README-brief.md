# Full-project bug hunt — shared brief

You are auditing **Twitch Badges Database** — the whole project, client and
server — for real bugs. You are a **collector**: you document findings and
nothing else.

## Hard rules

- **Do not modify any file.** Not one line, not "just to test". You may read
  anything and run `npx tsc --noEmit`, `npx eslint <path>`, `grep`, and
  `node -e …`.
- **Do not touch the database.** One exception: read-only `SELECT` queries may be
  run to check that code assumptions match the live schema (credentials in
  `.env.local`; the project's own pattern is a small `tsx` script using
  `postgres`). Never run `npm run db:apply`, never write, never `INSERT`.
- **Do not fix anything and do not write patches.** The orchestrator verifies and
  implements. One sentence of direction is welcome; a diff is not.
- **Evidence or it did not happen.** Every finding needs `path:line`, the exact
  code, and the concrete failure (input → wrong outcome). If you could not
  confirm it, mark `CONFIDENCE: low — unverified` and say what you could not
  check. An unverifiable claim costs the review more than it is worth.
- **Real defects only.** Crashes, wrong output, security holes, data loss, broken
  flows, races, contract mismatches, unhandled errors, i18n breakage,
  accessibility defects that block use, hydration mismatches, stale data that
  should be fresh. Not naming, not formatting, not "could be cleaner", not
  missing tests.

## Already known — do NOT report these again

Two earlier rounds are on disk; read them before writing so you do not re-report
settled work:

- `bugreports/acp-bugs/VERIFIED.md` — the admin-panel round: what was fixed
  (authorization ranks, the profiles.role guard, anon grants, the beacon insert
  hole, newsletter honesty, changelog payload loss, NaN guards, phantom writes,
  and more) and **what is still open** (games master switch and bet bounds, the
  `feed` flag's page and endpoint, several analytics-panel details, client-side
  and accessibility items). The open list is fair game; the fixed list is not.
- `bugreports/FIXES.md` and `bugreports/AGENT-AUDIT.md` — earlier rounds.
- **Maintenance mode has been removed** entirely (migration 0031). Do not report
  anything about it.
- The 20 `planned` entries on the idea board and the limitations section of
  `docs/ACP.md` are accepted by the operator, not bugs.

## Environment facts that produce false positives

- Next.js **16**: `params`/`searchParams` are Promises and must be awaited. The
  middleware file is `src/proxy.ts`, not `middleware.ts`.
- Client components may not import `src/lib/supabase/admin.ts` (service role). A
  `"use client"` module's exports may only be **rendered** from server code,
  never **called**.
- `NEXT_PUBLIC_*` values must be read as static `process.env.NEXT_PUBLIC_X`
  member expressions in client code; `envOr("…")` returns undefined in the
  browser bundle (this once killed the Twitch login button silently).
- React Compiler lint rules: no synchronous `setState` inside an effect body
  (wrap in `setTimeout`/`requestAnimationFrame`); no `Date.now()` during render.
- `.catch(() => …)` around catalogue queries is a deliberate empty-state pattern
  for a possibly un-migrated database, not a swallowed error.
- `next-intl` throws `MISSING_MESSAGE` for an unknown key, and a page that builds
  keys dynamically fails **silently per locale** while the build stays green.
- Scripts run under `tsx` in CJS mode and must `config({path:".env.local"})`
  before a **dynamic** `import()` of `@/lib/…`; no top-level await in scripts.
- The project's own gotchas are listed in `AGENTS.md` — read it. Anything it
  documents as already-hit-and-fixed is not a new bug.

## What to hunt

1. **Authorization and privacy**: a route or page that should be gated and is
   not; RLS or a grant that exposes another member's data; a column readable by
   `anon` that should not be.
2. **Input handling**: unvalidated body/search/route params reaching a query or a
   write; `Number()` without a finite check; a string used as a PostgREST filter
   fragment (`or`, `like`, `ilike`) without escaping; a client-supplied id used
   without verifying it exists.
3. **Data integrity**: a write that can lose data; a counter updated absolutely
   instead of relatively; a delete that orphans rows; an upsert with the wrong
   conflict target; a mutation that reports success without checking `error`.
4. **Error propagation**: a Supabase/`fetch` call whose `error` is ignored; a
   thrown validation error turned into a 500; a silent `catch` hiding a failure
   from the operator or the member.
5. **Races and state**: a read-modify-write that loses updates; a double-submit;
   a `useEffect` with a missing/wrong dependency (stale closure, refetch loop);
   a response arriving for a selection the user has already changed; a state
   update after unmount.
6. **Rendering/hydration**: a server/client mismatch (dates, `Math.random`,
   `Date.now`, locale-formatted numbers), a `key` missing in a mapped list, a
   controlled input that cannot represent the server value, an image without
   dimensions, a `suspense` boundary missing around `useSearchParams`.
7. **Cross-surface consistency**: the same value computed two ways (list vs
   detail, card vs page, one locale vs another) that disagrees; a cached page
   that should have been revalidated; two sources of truth for one fact.
8. **i18n**: a key used somewhere that is missing from one of the eleven
   `messages/*.json`, or a placeholder mismatch (`{count}` vs `{n}`). Check it
   mechanically across all locales rather than by eye.
9. **Accessibility**: only where it genuinely blocks use — an interactive control
   with no accessible name, a click-only control that keyboard cannot reach, a
   dialog that never traps or returns focus, text that fails contrast to the
   point of being unreadable.
10. **Integration contracts**: the code's assumptions about the live schema —
    a column, view, function or constraint that does not exist or does not match
    — and the shape of the third-party feeds it parses.

## Output

Write `bugreports/full-audit/<your-file>.md` (your prompt names it):

```markdown
# <scope>

Audited: <the files you actually read>
Method: <what you ran; what you could not run>

## B1 — <short title>
- **Severity**: critical | high | medium | low
- **Confidence**: high (verified by reading/running) | medium | low (unverified)
- **Where**: `path/to/file.ts:123`
- **Code**: <the exact snippet, 3-15 lines>
- **Why it is wrong**: <the concrete failure: input → wrong outcome>
- **How to reproduce**: <steps, or "by inspection: …">
- **Suspected cause**: <one line>
```

Then **report the findings back to me in your final message**, compactly — one
line each: `severity | file:line | title | confidence`. I work from that report
and open the file only for detail, so it must stand alone. If you found nothing,
say so explicitly **and list what you checked**, so that "nothing" means
something.
