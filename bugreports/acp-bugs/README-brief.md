# ACP bug hunt — shared brief

You are auditing the **admin control panel** of Twitch Badges Database for real
bugs. You are a **collector**: you document findings and nothing else.

## Hard rules

- **Do not modify any file.** Not one line, not "just to test". You may read
  anything, run `npx tsc --noEmit`, `npx eslint <path>`, and `grep`.
- **Do not touch the database**, with two exceptions: you may run `SELECT`
  queries to check that the code's assumptions match the live schema, and you may
  read `supabase/migrations/*.sql`. Never run `npm run db:apply`, never write.
- **Do not fix anything, do not propose patches.** The orchestrator verifies and
  implements; a fix suggestion from you is only welcome as one sentence of
  direction, never as a diff.
- **Evidence or it did not happen.** Every finding needs `path:line`, the exact
  code, and *why* it is wrong. A claim you could not confirm reads
  `CONFIDENCE: low — unverified` and must say what you could not check.
- **No style opinions.** Not "this could be cleaner", not naming, not
  formatting, not missing tests. Real defects only: crashes, wrong output,
  security holes, data loss, broken flows, races, contract mismatches,
  unhandled errors, i18n breakage, accessibility defects that block usage.

## Context you must not get wrong (false positives cost real time)

- Next.js **16**: `params`/`searchParams` are Promises and must be awaited. The
  middleware file is `src/proxy.ts`, not `middleware.ts`.
- Client components cannot import the service-role client
  (`src/lib/supabase/admin.ts`); server components and route handlers can.
  A `"use client"` module's exports may only be **rendered** from server code,
  never **called**.
- React Compiler lint rules: no synchronous `setState` in an effect body (wrap in
  `setTimeout`/`requestAnimationFrame`); no `Date.now()` during render.
- `.catch(() => …)` around catalogue queries is a deliberate empty-state
  pattern, not a swallowed error, when the DB may be un-migrated.
- `next-intl` throws `MISSING_MESSAGE` for an unknown key, and a page that builds
  keys dynamically fails **silently per locale** while the build stays green.
- The 20 entries marked `planned` on the idea board and the limitations listed in
  `docs/ACP.md` (passcode strength, no dashboard screenshot with a real session,
  newsletter never sent, global sync never triggered from the panel) are
  **known and accepted**. Do not report them.
- `bugreports/` holds earlier audit rounds. Do not re-litigate what those
  already fixed; audit the code as it is now.

## Where to look

The ACP is roughly 6,000 lines: `src/lib/admin*.ts`, `src/lib/settings.ts`,
`src/lib/maintenance-edge.ts`, `src/lib/analytics.ts`, `src/lib/roles.ts`,
`src/app/api/admin/**`, `src/app/api/track/route.ts`,
`src/components/admin/*.tsx`, `src/app/[locale]/admin/page.tsx`,
`src/components/RoleBadge.tsx`, `src/components/AnalyticsBeacon.tsx`,
`src/proxy.ts`, and `supabase/migrations/0025..0028*.sql`.

Your assignment names the subset you own. Stay inside it — another agent has the
rest, and duplicates waste the review budget.

## What to hunt (the classes that actually bite here)

1. **Authorization**: can a caller reach something they should not? Check every
   path for a `requireAdmin()` gate, the bootstrap-session restriction, role
   escalation (a moderator promoting themselves), self-protection rails, and
   whether the gate's failure paths return the right status.
2. **Input handling**: unbounded or unvalidated `body` fields reaching a query or
   a write; numbers parsed with `Number()` without a finite check; strings used
   as PostgREST filter fragments (`or(...)`, `like(...)`) without escaping;
   an id from the client used without existing-profile validation.
3. **Data integrity**: writes that can lose data, relative vs absolute updates on
   counters, delete paths that orphan rows, missing `updated_at`, upserts with a
   wrong conflict target, or a mutation that reports success without checking
   `error`.
4. **Error propagation**: a failed Supabase call whose `error` is ignored; a
   thrown validation error that the route turns into a 500 instead of a 400;
   `gateResponse` swallowing a non-gate error; a silent `catch` that hides a real
   failure from the operator.
5. **Client-side**: a panel that never surfaces a failed fetch, a double-submit
   that fires a mutation twice, a `confirm` dialog that can be bypassed, a stale
   row after a mutation, a state update on an unmounted component, a select whose
   value cannot represent the server value.
6. **Maintenance/feature flags**: a route that should be gated but is not, a
   loophole that lets a non-admin through during maintenance, a flag that hides a
   nav entry but not the endpoint (or the reverse).
7. **Analytics/telemetry**: an unbounded or unbounded-length field, a coercion
   that loses precision, a boundary that lets a caller poison the aggregate, an
   off-by-one in a time window.
8. **i18n**: a key used by a panel that does not exist in all eleven
   `messages/*.json`, or a key/placeholder mismatch (`{count}` vs `{n}`).
9. **Schema drift**: code reading a column, view or RPC that the migrations do
   not create, or a constraint the code violates. Check against the live DB.
10. **Accessibility in the admin UI**: an interactive control with no accessible
    name, a dialog that traps nothing, a table header missing, a focus loss that
    makes the panel unusable by keyboard — only where it genuinely blocks use.

## Output

Write `bugreports/acp-bugs/<your-file>.md` (your prompt names it):

```markdown
# <scope>

Audited: <the files you actually read>
Method: <what you ran; what you could not run>

## B1 — <short title>
- **Severity**: critical | high | medium | low
- **Confidence**: high (verified by reading/running) | medium | low (unverified)
- **Where**: `path/to/file.ts:123` (+ the other sites, if it is a pattern)
- **Code**: <the exact snippet, 3-15 lines>
- **Why it is wrong**: <the concrete failure: input → wrong outcome>
- **How to reproduce**: <steps, or "by inspection: …">
- **Suspected cause**: <one line>

## B2 — …
```

Then **report the same findings back in your final message**, compactly — one
line each: `severity | file:line | title | confidence`. The orchestrator works
from your report and opens the file only for detail, so the report must stand
alone. State explicitly if you found nothing in your scope, and say what you
checked so that "nothing" is meaningful.
