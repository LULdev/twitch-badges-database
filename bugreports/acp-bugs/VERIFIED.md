# ACP bug hunt — verified findings

The eight collectors document; this file is my adjudication. Every entry was
re-checked against the code (and the live database where relevant) before being
accepted. A finding whose mechanics did not hold up is marked REFUTED, not
quietly dropped — a false positive that reaches a fix costs more than the bug it
pretends to be.

Status legend: **CONFIRMED** (reproduced by reading/querying) · **REFUTED** ·
**PARTIAL** (the claim is right about the code but the impact was overstated, or
the reverse).

## Round 1 (three reports: newsletter/ideas/audit, content/badges, users)

### Critical

| # | Finding | Verdict | My verification |
|---|---|---|---|
| C1 | **Role action has no rank check — any moderator can promote themselves (or anyone) to `owner`** (`src/app/api/admin/users/route.ts:97-110`) | **CONFIRMED** | The only guards are `self && role === "user"` (blocks self-*demotion*) and `ownerProtected` (a non-owner cannot touch the owner target). Nothing compares the actor's rank to the role being assigned, so `self && role === "owner"` passes and `setUserRole` writes it. A moderator becomes owner in two requests. |
| C2 | **Editing any badge rewrites `source = "custom"`** (`src/lib/admin-content.ts:268-277` + `:295-302`) | **CONFIRMED** | `payload` includes `source: "custom"` unconditionally and the update branch writes that same object, despite its comment saying source "is not editable". Effect, traced through `syncs/global.ts`: the row joins `customKeys`, so the catalogue sync stops refreshing it *and* stops sweeping it when the badge disappears, and `deleteBadge`'s guard then permits deleting it. This inverts the protection documented in `docs/ACP.md`. Introduced by me. |

### High

| # | Finding | Verdict | My verification |
|---|---|---|---|
| H1 | **`IDEA_CATEGORIES` in the server lib still lists 7 categories while migration 0028, the panel and the DB accept 13** (`src/lib/admin-brainstorm.ts:10-18`, rejected at `:56`) | **CONFIRMED** | `saveIdea` throws `unknown category` for `addon`, `performance`, `usability`, `xp`, `coin`, `admin` — so creating or editing any of the ~180 ideas now in those categories fails from the panel. Regression from migration 0028: I updated the constraint and `BrainstormPanel.tsx` but missed this allowlist. |
| H2 | **Editing a changelog entry silently erases its JSON payload** (`ContentPanel.tsx:397-405` + `admin-content.ts` update path) | **CONFIRMED** | The payload input is rendered only for new entries (`draft.id === undefined`), and save sends `payload: null` when the field is empty — and for an existing entry the field is empty by construction. `upsertChangelog` writes `payload: null`. Every edit destroys the stored payload. |
| H3 | **`sendDraft` marks a draft `sent` even when nothing was delivered** (`admin-newsletter.ts:158-169`) | **CONFIRMED** | The condition is `result.channel !== "none"`, and `sendEmail` returns `channel: "email"` even when every batch failed. A total Resend outage marks the draft sent and it cannot be retried. The function's own docblock claims the opposite. |
| H4 | **Newsletter batches put 50 addresses in `to:`, exposing each recipient's email to the other 49** (`admin-newsletter.ts:198-213`) | **CONFIRMED** | `to: batch` with up to 50 addresses. A privacy defect regardless of provider behaviour, and a bulk-mail anti-pattern. |
| H5 | **`voteIdea`'s comment claims a relative update but the code is read-modify-write** (`admin-brainstorm.ts:86-105`) | **CONFIRMED** | `.select("votes")` then `.update({ votes: next })` — an absolute write. Two concurrent votes lose one, and the floor-at-zero check races. The docblock asserts the safe behaviour the code does not have. |

### Medium

| # | Finding | Verdict | My verification |
|---|---|---|---|
| M1 | `Number(body.id)` unchecked → `NaN` is falsy, so an intended **edit silently INSERTs a duplicate** (`newsletter/route.ts:28,37`, `ideas/route.ts:34,41`) | **CONFIRMED** | `id` becomes `NaN`; `saveDraft`/`saveIdea` branch on `if (id)`, which is false for `NaN`, so they insert. |
| M2 | Update/delete with no `.select()` **reports success for 0 matched rows** — a phantom audit entry for a row that no longer exists | **CONFIRMED** | PostgREST does not error on a 0-row UPDATE/DELETE. Applies to ideas, drafts, users, changelog, badges. |
| M3 | **`bannedOnly` filters after pagination and `total` stays unfiltered** — banned members past page 1 are unreachable (`admin-users.ts:137-140`) | **CONFIRMED** | The `.range()` runs on the query, the banned filter runs in JS afterwards, and `count` comes from the unfiltered query. |
| M4 | **Ban with a non-numeric `days` throws `RangeError` → 500** (`users/route.ts:116-122`) | **CONFIRMED** | `Number("abc")` is `NaN`, `NaN <= 0` is false, so `new Date(Date.now() + NaN)` → `Invalid Date` → `.toISOString()` throws. |
| M5 | `UsersPanel` can promote but the **route skips `adminAction`, so deliberate validation errors return 500** (`users/route.ts:145-147`) | **CONFIRMED** | Its catch calls `gateResponse`, which maps any non-gate error to 500 — "no editable fields supplied" becomes an internal error. |
| M6 | **`deleteUser` deletes the profile but not the auth user** — the login survives and orphaned writes then report `ok` | **CONFIRMED** | `deleteUser` touches six tables and `profiles` only. `supabase.auth.admin.deleteUser` is never called, so the account can still sign in with no profile, and `/api/account` updates 0 rows without error. |
| M7 | **`deleteBadge` ignores the SELECT error**, so a failed lookup bypasses the custom-only guard and can delete a provider badge (`admin-content.ts:329-339`) | **CONFIRMED** | `const { data: row }` with no error check; on failure `row` is null and `if (row && row.source !== "custom")` passes. |
| M8 | **`BadgesPanel` writes `""` instead of `null`** for optional fields, defeating the 1x image and the how-to-earn fallback | **CONFIRMED** | `newBadge()` seeds `image_url_2x: ""` etc.; empty strings are written, and downstream `?? fallback` does not fire for `""`. |
| M9 | Custom badge **slug can be empty** and collisions surface as 500 rather than "already taken" (`admin-content.ts:273,304-322`) | **CONFIRMED** | `slugify("---")` → `""`, and the clash lookup's error is ignored so a unique violation becomes a 500. |
| M10 | Push broadcast is dispatched **before** `recordNotification` and before the `sent` write; a throw there leaves the draft re-sendable (duplicate broadcast), and the read-then-write on `status` is a TOCTOU | **CONFIRMED** | Dispatch precedes the persistence, and nothing makes the `draft → sent` transition conditional. |

### Low (all CONFIRMED unless noted)

| # | Finding | Verdict |
|---|---|---|
| L1 | A handler's early `return { error: … }` is wrapped as **HTTP 200** by `adminAction`, and panels key on `res.ok` → a rejected action shows the success notice (`admin-route.ts:33-40`) | **CONFIRMED** |
| L2 | Validation messages outside the allow-list regex ("draft not found") → **500 instead of 4xx** | **CONFIRMED** |
| L3 | `Number(limit/offset)` unchecked → `NaN` range → PostgREST error → 500 (users, content, ideas GET) | **CONFIRMED** |
| L4 | `recipient_count` stores the **email audience** even for a push send | **CONFIRMED** |
| L5 | Recipient enumeration silently capped at 20×1000 users | **CONFIRMED** (harmless at this scale, but silent) |
| L6 | Audit writes `newsletter.send` even when `channel: "none"` and nothing was sent | **CONFIRMED** |
| L7 | `BrainstormPanel.post` has no try/catch (network failure surfaces nothing) and no busy guard on vote/save | **CONFIRMED** |
| L8 | Expired ban still renders as "ban.active" in the user drawer, while the list correctly says "Active" | **CONFIRMED** |
| L9 | Member rows open the drawer via `onClick` on `<tr>` only — **not keyboard reachable** | **CONFIRMED** |
| L10 | **`/api/push/subscribe` has no ban gate**, while `isUserBanned`'s docblock lists "push" as covered | **CONFIRMED** (comment overclaims; the endpoint is low-risk but the doc is wrong) |
| L11 | Search escaping strips `,()%` but not `_`, a LIKE wildcard → silent over-matching | **CONFIRMED** (no injection; over-match only) |
| L12 | `update`/`role` on a nonexistent userId answer `{ok:true}` | **CONFIRMED** |
| L13 | Blog update never checks slug uniqueness → unique violation becomes a 500 | **CONFIRMED** |
| L14 | Markdown link `href` scheme unchecked (`javascript:`) — admin-authored content only | **CONFIRMED**, low |
| L15 | An admin post can occupy a future auto drop-post slug; `createDropPost`'s `ignoreDuplicates` then suppresses the drop post | **CONFIRMED**, low |

### Refuted

None so far. The collectors' reports were accurate on the mechanics they
asserted; their severity calls I adjusted in two places (M5/L1 are the same
root cause — `adminAction`'s error contract — and I treat it as one fix).

## Still open

Five collectors had not reported when this was written: auth/gate, settings and
maintenance, telemetry, the data layer, and the shell/i18n. Their findings are
added here before anything is implemented.

## Round 2 (five more reports: auth/gate, settings/maintenance, telemetry, data layer, shell/i18n)

### Critical

| # | Finding | Verdict | My verification |
|---|---|---|---|
| C3 | **`profiles.role` was absent from `protect_profile_columns`, so any signed-in member could set their own role to `owner` through the public REST API** (`0025:27-46` + `0006:22-42`) | **CONFIRMED as a code hole; PARTIAL on exploitability** | Verified directly: the guard restores `id, is_admin, view_count, twitch_id, created_at` and not `role`; `has_column_privilege('authenticated','profiles','role','UPDATE')` is true, the table-level UPDATE grant exists, and `profiles_self_update` matches the caller's own row, so the write passes both privilege and policy. With `viewerRole` authorizing on `role` alone, succeeding means every admin route. **But** the attempt is refused today — as `authenticated`, `update profiles set role='owner'` (by username, by role, unfiltered) returns "permission denied for table profiles", because the guard is not `SECURITY DEFINER` and reads `old.is_admin`, which `authenticated` may not SELECT. So it was not exploitable as deployed; the protection was an accident of an unrelated privilege denial, and marking the trigger `SECURITY DEFINER` — the natural fix for that very error — would have armed it. Fixed structurally in migration 0030. |

### High

| # | Finding | Verdict | My verification |
|---|---|---|---|
| H6 | anon holds blanket grants (DELETE/INSERT/UPDATE/TRUNCATE) on all six ACP tables, and `analytics_events` had a permissive INSERT policy → anyone with the publishable key could write raw rows and poison the aggregates | **CONFIRMED** | Live query listed anon/authenticated with every privilege on all six tables, and the policy list showed `analytics_anon_insert … with check (true)`. PostgREST exposes no truncate verb, which was the only thing making TRUNCATE unreachable — and TRUNCATE is not subject to RLS. |
| H7 | `site_settings` was world-readable in full, exposing the `admin` document (owner profile id + username + grant roster) and `acp_gate_state` | **CONFIRMED** | Live anon read returned the other keys; the policy is `using (true)` with no key filter, so `admin` and `acp_gate_state` were included. |
| H8 | The role action had no rank check — a moderator could promote themselves to owner | **CONFIRMED** | (Round 1, C1.) |
| H9 | Maintenance mode is a **one-way door**: the gate lives in the locale layout, so `/login` and `/auth/callback` render the notice too and a logged-out admin cannot sign in to switch it off | **CONFIRMED, NOT YET FIXED** | Read the gate: `lockedOut = maintenance.enabled && !user?.isAdmin` replaces `<main>` for every child of the layout, and the header's login link points at `/login`, whose content is thus replaced. Recovery needs SQL. **The top open item.** |
| H10 | The bootstrap throttle was a global read-modify-write: concurrent guesses cost one increment, a failed write failed open, and five guesses from anywhere locked the operator out | **CONFIRMED, FIXED** | Verified against the live database after the fix: five attempts allowed, then refused, per caller (`acp_gate_attempt`). |
| H11 | The bootstrap cookie was forgeable when `CRON_SECRET` was unset (`?? ""` degraded the HMAC key to the repo-committed digest) | **CONFIRMED, FIXED** | The key now requires a server secret and the door refuses to open without one. |
| H12 | `isBootstrapSession` threw a RangeError on a 64-character non-ASCII cookie → unauthenticated 500 | **CONFIRMED, FIXED** | Byte-length comparison; expiry bounded. |
| H13 | `audit()` never read the insert error (supabase resolves, does not throw) → audit loss was completely silent | **CONFIRMED, FIXED** | |
| H14 | Five detailed analytics views were granted to anon with no public reader; `top_paths` published raw paths (including `/xx/profile/<username>` URLs) and `referrers` published hosts | **CONFIRMED, FIXED** | Live: anon now gets 401 on those views; the panel reads them with the service role. |

### Medium

Grants written before `profiles.role` (divergence on failure) and a moderator able to self-grant `admin` from the settings route — both **CONFIRMED** and fixed by the same rank ladder as C1. Games master switch read only by the hub while the engine consulted the per-game flag; `maxBet` settable below `minBet`; the per-game bet bounds ignored by the game pages' own BetBar; `features.feed` hiding the nav entry but not the page or endpoint — all **CONFIRMED**, not yet fixed. The `stats_analytics_daily` visitor count collapsing all DNT visitors into one; `avg_duration_s` coalescing to 0 while the type says null; probes reporting any status under 500 as healthy; the database probe having no timeout — all **CONFIRMED**, not yet fixed.

### Low

`—%` from a null percentage; unused `platform` payload shipped by the stats route; BadgesPanel offering six categories while the catalogue has twelve and cannot represent the rest; the detail-drawer response race (row A shown while row B is selected); click-only member rows; numeric fields that coerce an empty string to 0; shared error state across the blog and changelog sub-tabs; a swallowed edit-fetch failure; buttons without an in-flight guard; a stale edge maintenance cache (10 s); maintenance pages answering 200 with the real canonical; unlabelled controls in the games table — all **CONFIRMED**, none yet fixed.

### Refuted / corrected

- **02-users.md's assertion that a client-side role write is "not a schema violation"** was wrong, and it is why round 1 missed C3. Corrected here.
- **07-data-layer.md's claim that the four detail views were the only exposure** — the summary view was granted too; all six are now revoked.
- The telemetry agent's `/api/admin/stats` "mismatched `system` field" is real but cosmetic (an unused key), downgraded from its reported severity.

## Status at the end of this round

Fixed: 2 critical, 8 high, 12 medium, 13 low — migrations 0029 and 0030 plus changes across
`admin.ts`, `admin-route.ts`, `admin-users.ts`, `admin-content.ts`, `admin-newsletter.ts`,
`admin-brainstorm.ts`, `settings.ts`, `analytics.ts`, the auth/users/content/ideas/newsletter/settings
routes. Gates: lint and typecheck clean, build generates 238 pages.

**Still open** (verified, not yet fixed): the maintenance one-way door (H9, the most serious),
the games master switch and bet-bound validation, the `feed` flag's page and endpoint, the
per-game BetBar bounds, the analytics view/panel details, and the client-side and accessibility
items in the last paragraph. A second hunt is needed to confirm the fixes and to look for anything
they introduced — that round has not been run.
