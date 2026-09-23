# Admin Control Panel

The ACP is the operator surface for this site: members, content, the badge
catalog, syncs, settings, statistics, service status, the newsletter, the idea
board and the audit trail. It lives at `/[locale]/admin` in all eleven locales,
is never indexed (`robots: noindex`), and is reachable only by a signed-in
member whose `profiles.role` is `moderator`, `admin` or `owner`.

Everything in this document was built and verified in one session against the
live Supabase project. The verification section says exactly what was exercised
and what was not.

## How access works

Two doors, and only one of them can be open at a time.

**1. Bootstrap (the first run).** With no owner registered, `/[locale]/admin`
shows a passcode form. The passcode exists nowhere in the repository, the
database, the changelog or this document — `src/lib/admin.ts` holds only a
salted HMAC-SHA-256 digest of it, compared in constant time. A correct entry
sets a two-hour HMAC-signed `httpOnly` cookie, which reveals the second step: a
form that names the owner by Twitch username (optionally by numeric Twitch ID).
That flips the chosen profile to `role = 'owner'` and records the owner in
`site_settings.admin`; from that moment the passcode door answers `410 Gone`,
permanently.

Five wrong attempts in fifteen minutes are refused with `429`. The counter lives
in `site_settings` so it survives cold starts.

A bootstrap session is deliberately **not** an admin session. It is accepted by
`/api/admin/setup` alone; every other admin route answers `403` for it. Treating
it as a general session would have let a short, rate-limited passcode manage the
whole installation.

**2. Role.** Everyone else authenticates with Twitch as usual. There is no
second password: the login is the authentication, the role is the authorization.
The owner grants further moderators and admins in the Settings tab (by Twitch
username; the member must have logged in once so a profile exists). The write
sets both `profiles.role` (the enforcement) and the `grants` list (the record the
panel renders).

Verified live: with no owner present, the passcode form renders; a wrong
passcode sets no cookie; the correct one reveals the owner form; a bootstrap
cookie can open `/api/admin/setup` but gets `403` from `/api/admin/users`.

### The passcode's real strength — be aware

The digest is in the repository, and its salt with it (the salt must be
somewhere for the comparison to work). That makes the passcode brute-forceable
offline by anyone with a copy of this repository: a five-digit code is 100,000
guesses. Offline guessing is not limited by the five-attempt throttle.

The design limits the damage rather than pretending otherwise: the passcode only
ever opens the owner-registration form, and only while no owner exists. **Register
the owner as soon as the panel is deployed**; after that the digest is inert.

## The ten tabs

| Tab | What it does |
| --- | --- |
| **Users** | Search by username, display name or Twitch ID; edit every profile field, set XP/coins/level/streak exactly, change the role, ban (with reason and optional duration) or lift a ban, grant and revoke achievements, delete a member with their data. |
| **Content** | Blog posts (title, slug, excerpt, Markdown body, cover, author, locale, tags, draft/published) and changelog entries (kind, title, explanation, JSON payload). |
| **Badges** | Create and edit hand-made catalog entries, search the catalog. |
| **Sync** | Run the catalog diff, the drop-window enrichment and the owner statistics immediately, and read their raw summaries. |
| **Settings** | Feature flags, economy values, per-game switches and bet ranges, admin/moderator grants. |
| **Statistics** | Visitor analytics: online now, views today/7d/30d/90d, unique visitors, a 30-day trend, device, browser, page, referrer and language distributions, average time on page. |
| **Status** | Recorded heartbeat history per service (availability 24h/7d/30d, average duration, last run, last message) plus a live probe of the database, Twitch, badgebase and potat. |
| **Newsletter** | Drafts, audience counts, and delivery. |
| **Ideas** | The brainstorm board: categories, statuses, voting. |
| **Audit** | Every admin mutation, filterable by action and actor, payload expandable. |

### Behaviour worth knowing

**Banning is enforced, not just cosmetic.** A banned member is refused with
`403` at every mutating endpoint — games, steals, daily claim, wheel, account,
inventory sync, coin rain and blog reactions all pass through a shared
`playerGate`. A session that already exists cannot keep playing.

**Safety rails.** An admin cannot demote, ban or delete themselves; a non-owner
cannot touch an owner account; the owner cannot be removed from the Settings
list.

**Catalog safety.** Badges with `source = 'custom'` are shielded from the global
sync: the sweep that marks disappeared badges as removed skips them, and a
provider badge that would collide on `(set_id, version)` is skipped instead of
overwriting the hand-made entry. `status` is refused as a custom category,
because the sync deletes role badges on every run.

**Maintenance mode was removed on request.** It deserves a note rather than a
silent deletion: the gate lived in the locale layout, so it replaced *every*
page including `/login`, which made it a one-way door — a logged-out admin could
not sign in to switch it off, and recovery meant running SQL. The bug hunt found
that, but the decision was to drop the feature rather than fix it, so the layout
gate, the edge check in `src/proxy.ts`, the `maintenance` settings key, the panel
section and its message keys in all eleven locales are gone, and migration 0031
deletes the stored row. Nothing else referenced it.

**Manual syncs are attributed.** An ad-hoc run is written to the uptime history
under its own `manual/…` source, so pressing a button never disguises a missed
scheduled run.

## Data model

| Migration | Contents |
| --- | --- |
| `0025_acp_foundation` | `site_settings`, `profiles.role` (+ the trigger keeping `is_admin` in step), `bans`, `newsletter_drafts`, `brainstorm_ideas`, `admin_audit`, `analytics_events` and six `stats_analytics_*` aggregate views. |
| `0026_acp_settings_seed` | Writes the default `economy`, `games` and `admin` documents into `site_settings` so the stored value is the value in force, instead of an invisible fallback in code. |
| `0027_grant_profile_role_select` | Grants `SELECT (role)` on `profiles` to `anon` and `authenticated`. |

`role` is public by design — it drives the badge on a member's profile — while
`is_admin` remains unreadable to those roles. That distinction matters: before
0027, reading `role` through the anon client failed, and because the locale
layout reads its columns that way, a failed read left **signed-in members
rendering as logged out**. Migration 0027 exists because of that.

## Visitor analytics and privacy

The beacon (`AnalyticsBeacon` → `POST /api/track`) is deliberately poor at
identifying anyone:

- **not stored:** IP addresses, cookies, query strings, full referrer URLs, user
  agent strings;
- **stored:** a path (query string stripped, truncated), a locale from the known
  list, a referrer *host*, a browser/OS/device class derived server-side from the
  user agent, screen width, timezone offset, and a duration;
- **the visitor identity** is a salted SHA-256 hash of the IP — the same salt
  logic the view-dedup already used. It exists to count distinct visitors and
  "online now" (distinct hashes in the last five minutes), and rotating the salt
  simply resets those counts;
- **`DNT: 1`** records the path and nothing else — no hash, no client class, no
  screen, no timezone;
- a malformed or empty payload is dropped rather than written as a hit on `/`.

Reads go through the `stats_analytics_*` views (`security_invoker = off`, same
contract as the `stats_*` views from migration 0004), which expose aggregates
only.

## Configuration

| Variable | Effect |
| --- | --- |
| `RESEND_API_KEY` | When set, the newsletter sends real email. Without it the panel says so and delivers as a web push instead. |
| `NEWSLETTER_FROM` | From-address for the newsletter (falls back to a placeholder). |
| `CRON_SECRET` | Also salts the bootstrap cookie signature, so a leaked digest alone cannot forge a session. |

## The feature catalogue

Both lists below are the research behind the panel. "Built" means it exists in
the tabs above; the rest are recorded in the Ideas tab with their effort and
rationale, so they are tracked rather than forgotten.

### Standard dashboard features

| # | Feature | Status |
| --- | --- | --- |
| 1 | Audit log | Built (tab) |
| 2 | User search and detail | Built |
| 3 | Role management | Built |
| 4 | Bans with reason and duration | Built |
| 5 | Account deletion | Built |
| 6 | Direct XP/coin/level editing | Built |
| 7 | Achievement grant/revoke | Built |
| 8 | Maintenance mode | **Removed** — the gate replaced `/login`, which made it a one-way door; dropped rather than fixed |
| 9 | Feature flags | Built |
| 10 | Economy configuration | Built |
| 11 | Per-game switches and bet limits | Built |
| 12 | Admin/mod grant management | Built |
| 13 | Newsletter composer | Built |
| 14 | Blog CRUD | Built |
| 15 | Changelog CRUD | Built |
| 16 | Custom badge CRUD | Built |
| 17 | Manual sync triggers | Built |
| 18 | Visitor statistics | Built |
| 19 | Service status and live probe | Built |
| 20 | Idea board | Built |
| 21 | Notification broadcast | Built (via the newsletter's push fallback; `recordNotification` writes the in-app feed) |
| 22 | Cron status view | Built (Status tab) |
| 23 | Login attempt log | Partial — the ACP's own gate attempts are throttled and counted; member logins are not logged (Supabase owns that) |
| 24 | Database browser (read-only) | Not built — the Users, Badges and Content tabs cover the tables that need browsing |
| 25 | Environment info | Not built |
| 26 | Cache reset | Not built — Next's revalidation is per-route; a site-wide bust needs an infrastructure hook this deployment does not expose |
| 27 | Impersonation | Not built — deliberately postponed: it needs a full audit trail of its own |
| 28 | Export/import | Not built |
| 29 | SEO settings editor | Not built — the SEO values are derived from content, not stored |
| 30 | Redirect management | Not built — no redirect surface exists yet |
| 31 | Moderation queue | Not built — nothing generates one yet (blog reactions are IP-gated, comments do not exist) |
| 32 | Report system | Not built — same reason |
| 33 | Redirect/404 monitor | Not built |
| 34 | Uptime alerting | Partial — the Status tab shows it; no outbound alerting |
| 35 | Bulk user actions | Not built |
| 36 | Saved admin views/filters | Not built — filters are in the URL of each tab's list |
| 37 | Scheduled publishing | Partial — blog posts have a `draft` status and a `published_at` the editor can set |
| 38 | Media library | Not built — images are URLs today |
| 39 | Two-factor for the panel | Not built — the Twitch login is the second factor; no TOTP |
| 40 | Per-admin permissions | Partial — three roles, not per-action capability flags |

### The less obvious ones

| # | Feature | Status |
| --- | --- | --- |
| 1 | Badge rarity recalculation on demand | Built (Sync → owner statistics) |
| 2 | Achievement re-evaluation for everyone | Not built — evaluation is per-user on action |
| 3 | "Time machine": simulate an economy change before publishing | Not built — the defaults are visible next to every field instead |
| 4 | Idea voting on the board | Built |
| 5 | Sync dry run | Not built — the engines report what they changed, but only after doing it |
| 6 | Visitor replay (anonymised paths) | Partial — top paths are ranked, individual sessions are not reconstructed |
| 7 | Session monitor | Not built |
| 8 | Sync skip diagnostics | Built — a skipped enrichment is surfaced as `degraded` in the Status tab |
| 9 | Anonymous-beacon DNT compliance | Built |
| 10 | Provider-incident guard on the catalog sweep | Pre-existing, kept and documented |
| 11 | Role badges (owner/admin/moderator) | Built (Phase 7) |
| 12 | Custom-badge protection from the sync | Built |
| 13 | Self-demotion / self-ban guard | Built |
| 14 | Owner-protection guard | Built |
| 15 | Honest delivery reporting | Built — the newsletter never claims mail that did not leave |
| 16 | Manual-run attribution in uptime history | Built |
| 17 | Health endpoint exempt from the maintenance gate | **Obsolete** — with the feature gone the endpoint is never gated |
| 18 | Column-level role grant | Built (migration 0027) |
| 19 | Settings cache with write-through invalidation | Built |
| 20 | Row-level "why did this happen" payloads in the audit log | Built |

## Verification performed

Each phase ended with `lint && typecheck && build` (0 errors; the 7 warnings are
pre-existing and unrelated) plus a live check:

- **Gate:** passcode form renders, wrong passcode sets no cookie, correct one
  opens the owner form, bootstrap is refused by the general admin API, and the
  owner-registration route rejects a username that does not exist (404) without
  changing anything. Throttle state cleared afterwards.
- **Users:** a list/search/detail read against the live database, and an
  idempotent progress and profile write that left every value unchanged, with
  the test audit rows removed afterwards.
- **Content:** blog/changelog read paths, custom badge creation and deletion,
  and the guards — `status` category refused, duplicate `(set_id, version)`
  refused, deleting a provider badge refused.
- **Settings:** defaults equal to the previous hardcoded behaviour; maintenance
  mode switched on and off again before the feature was removed (visitors saw the
  notice, the public API answered `503`, the admin API and `/api/health` stayed
  reachable); a
  disabled game disappeared from the hub while the others remained; custom bet
  bounds appeared on the tile that owned them.
- **Analytics:** beacons stored with the query string stripped, the referrer
  reduced to a host, the client class derived server-side; a `DNT: 1` beacon
  stored no hash and no client data; empty payloads written nothing; test rows
  removed afterwards.
- **Newsletter / ideas / audit:** recipient counting, draft creation and
  validation, idea voting (including the floor at zero and the rejection of an
  unknown category), the audit rows those actions produced, and full cleanup.
- **Role badges:** all three variants rendered on a live profile with the
  expected markup, and a regular member showed none; the role was restored.

### What was not verified

- **The dashboard tabs were never loaded in a browser by a signed-in admin.**
  Doing so requires an owner, and registering one is a decision only the operator
  can make (it is irreversible). The panels' data paths were exercised through
  their libraries and endpoints; their rendering was not.
- **The newsletter was not sent.** `RESEND_API_KEY` *is* configured in this
  environment, so pressing send would email real addresses — that needs the
  operator's decision. The push fallback path is therefore untested.
- **`runGlobalSync` was not run** from the Sync tab: it can post blog entries and
  send push notifications for genuinely new badges, which is an outward-facing
  action. The custom-badge protection it depends on was verified at the data
  layer instead.
- **The global sync's skip path** for a colliding provider badge was reviewed but
  not triggered with real provider data, because no such collision currently
  exists.

## The idea board's contents

`npm run import:ideas` fills the board from the research that produced this
panel, so the backlog is browsable and voteable instead of living in markdown
files:

| Source | Ideas |
| --- | --- |
| `bugreports/agent-idea-01..10.md` (the ten idea reports) | 121 |
| `IMPROVEMENTS.md` Part 1 (the ten optimization areas, one idea per bullet) | 38 |
| `IMPROVEMENTS.md` Part 2 (the fifty first-party feature ideas) | 50 |
| Seeded separately by `scripts/seed-acp-ideas.ts` (researched, not built) | 20 |

Each row carries a `Source:` line, so any idea can be traced to the report it
came from. Part 3 of IMPROVEMENTS.md restates the sub-agent ideas in short form
and is deliberately not imported twice; duplicates are filtered by normalised
title, and re-running the import inserts nothing.

### Brainstorming more ideas without collecting duplicates

Three scripts make the backlog expandable without turning the board into a pile
of the same idea in different words:

| Command | Purpose |
| --- | --- |
| `npm run ideas:inventory` | Writes `bugreports/existing-ideas-inventory.md`: every idea on the board with a gist, to hand to whoever (or whatever) proposes more. |
| `npm run ideas:verify` | Validates the proposal files and screens them for duplicates: schema, exact title collisions, and a rewording net that compares each new idea against all existing ones on word overlap. |
| `npm run ideas:import` | Inserts the survivors, skipping anything already on the board and anything listed in `bugreports/new-ideas-rejects.json`. |

The rewording screen is a net, not a verdict: a flagged pair may be two
genuinely different ideas that share vocabulary, and a duplicate that shares no
vocabulary will slip through. The judgement is human — or an adjudicating agent
— and its result is written to the rejects file so the decision is reviewable
and repeatable rather than baked into a script.

Category mapping is the reports' own scope (05 economy → game, 06 data → stats,
07 accessibility → design, 08 growth → content, 09 observability → other,
10 visual → design), with narrow keyword overrides for the four broad-scope
reports. The first attempt used broad keywords and filed 67 of 209 ideas as
"game" because a description happened to mention game modals; the counts now read
badge 51, content 40, other 39, design 31, game 28, stats 28, profile 12.

## What is on the board, and how to keep it honest

The board holds the full research backlog: 229 imported from the audits and the
idea reports, plus **444 brainstormed by ten scoped research agents** — badge
catalog, content, design, games, game addons, statistics, profile, performance,
usability, and a combined XP / coin / admin scope. Each idea carries a `Source:`
line naming the file it came from, so nothing is unattributable.

Adding hundreds of ideas to a board is easy; adding hundreds that are not the
same idea in different words is the hard part, and it is worth being precise
about how far the tooling gets:

1. **The inventory first.** `npm run ideas:inventory` exports every existing idea
   with a gist, and each agent is required to read all of it before proposing
   anything. This is the cheapest and most effective step — the agents used it to
   discard their own drafts and said so in their reports.
2. **A schema check** — allowed category, effort estimate, risk note.
3. **An exact-title check** against the board and within the set.
4. **A rewording screen** (`--loose` widens it) comparing each new idea against
   every existing one on title and body word overlap. On the 450 proposals it
   flagged 16 pairs: 11 were vocabulary coincidences and 5 were genuine
   duplicates produced independently by two or three agents.
5. **A final pairwise scan** over the imported set at a lower threshold, which
   caught one duplicate the screen had missed because its body scored 0.51
   against a 0.60 threshold.

The limit is worth stating plainly: **all of this is lexical.** A duplicate that
describes the same idea in entirely different vocabulary will not be caught by
any of it, and the honest answer for that case is a human reading the board. The
screen exists to make that reading cheap, not to replace it. Six duplicates were
excluded, each with its reason in `bugreports/new-ideas-rejects.json`.

## Screenshots

`docs/screenshots/`, captured with `npm run shots` (Playwright, chromium) against
a dev server:

| File | Shows |
| --- | --- |
| `01-admin-gate-passcode.png`, `02-admin-gate-german.png` | The passcode door, in English and German. |
| `03-stats-visitors-block.png`, `04-stats-full.png` | The public statistics page with the visitors block. |
| `05-profile-identity.png` | A profile identity block. |
| `06-changelog.png`, `07-home.png`, `08-games-hub.png` | The public site the panel operates on. |
| `09-role-badge-owner.png`, `09-role-badge-admin.png`, `09-role-badge-moderator.png` | The three role badges, captured with a temporarily granted role on a test profile (restored immediately afterwards). |

The dashboard tabs are **not** in the set, for the reason above: capturing them
needs a signed-in owner. To add them, register the owner, log in, and run
`SHOT_BASE=https://<domain> npm run shots` after extending the page list in
`scripts/screenshots.ts` with authenticated URLs.
