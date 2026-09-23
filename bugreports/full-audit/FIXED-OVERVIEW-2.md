# Full-project audit — rounds 3 to 8

Part two of the overview. Part one (`FIXED-OVERVIEW.md`) covers rounds 1 and 2.
Each round followed the same process the objective prescribes: collectors find and
document only, I re-verify every claim against the code or the live database, a
proposal agent works out the patch, and I review and implement it myself.

## Round 3 — verification of round 2's own fixes

One finding, and it was mine: the status-filter value in `FilterBar` used a
nullish chain ending in `rawStatus`, and an absent `?status=` normalises to `""`,
which is not nullish — so no status chip was pressed on the default catalogue
view. Fixed, verified live (both "All" chips active again, `?status=bogus` still
renders its own chip).

Everything else the verifier checked was confirmed correct: the staff rank ladder
covers every action and breaks no legitimate one, the newsletter claim releases on
every delivery throw, a DNT page view writes exactly one row, the badgebase guard
cannot see zero confirmed badges while confirmed rows exist, every `listBadges`
recursion terminates while real errors still propagate.

## Round 4 — 29 findings

**Syncs.** The badgebase incident guard's denominator counted rows the sweep can
never clear (custom rows and already-removed rows), so it could latch on healthy
data and — because the skip returns before the pass that clears the flag — stay
latched forever; the same denominator in `global.ts` excluded nothing. A run whose
writes landed but whose detail fetches all failed now documents that before it
throws. The potat momentum read throws instead of silently writing neutral rarity
for the whole catalogue, and an owners-feed outage records a degraded heartbeat.

**Admin.** A failed read of the admin identity document could be spread into the
stored document, erasing `profileId` and reopening the one-shot bootstrap passcode
door — the write now refuses and `bootstrapAvailable()` fails closed. An emptied
ban-days field became a PERMANENT ban; it keeps its previous value and `0` now
asks for confirmation in all eleven locales. The sync trigger requires an admin.
A stale detail response can no longer overwrite the editor the operator moved on
to. Profile patches are validated per field, progress values must be numbers, the
revoke ladder uses strict `outranks`, the newsletter no longer reports "no
provider" when only a count failed, every panel's result line is a live region,
and the passcode door writes an audit row on success and on a burned throttle
budget (never per guess).

**Catalogue and analytics.** One resolver feeds both the query and the sort
control; pagination carries the first value of a repeated parameter; a term that
sanitizes to nothing shows the empty state instead of the whole catalogue; `all`
is the clear sentinel only for the enum filters; a fractional `?page=` is floored;
the home page renders a real error card instead of claiming an empty catalogue.
A duration beacon that raced its mount response attaches to its own row; an
implausible duration is discarded rather than clamped to 24 h; migration 0036
stops DNT's empty hash counting as a phantom visitor and publishes
`unique_visitors_30d` (proven in a rolled-back transaction). The badgebase detail
pass was budgeted to 24 fetches / 6 at a time / 8 s each so both cron halves fit
one 60 s function, and a second workflow triggers the badgebase half independently.

## Round 5 — 8 findings

The largest was invisible but public: `stats.ts` read camelCase names off the
snake_case view `stats_gamification`, so every field except `players` was
`undefined` and `num()` turned that into 0 — the XP/coins/games KPIs and the XP
donut centre on `/stats` rendered zero while the database held real values (live:
`total_xp` 3610, `avg_level` 11.00). Also: the markdown renderer emitted an anchor
with an unvalidated href, so `javascript:`/`data:`/`vbscript:` — including a
control character inside the scheme — survived into `dangerouslySetInnerHTML` on
blog pages; the steal victim lookup did not escape `*`, which PostgREST aliases to
`%`; targeting a victim wrote a `user_progress` row through `getProgress`; a
failed coin transfer burned the flood window; `/api/progress` had no ban gate; the
wheel rendered a duplicated client prize table; and a mid-sweep write failure left
a mutation undocumented.

## Round 6 — 8 findings

The bet field clamped on every keystroke, so an arbitrary bet could not be typed
at all. Two game surfaces printed untranslated English to every locale (the
Higher/Lower result token and the scratch card's symbol names — the latter fixed
with the Twitch brand names deliberately left Latin and two new keys added to all
eleven files). The reaction buttons announced an internal key to screen readers.
The countdown's accessible name read "5days"; it now uses `Intl.NumberFormat`'s
unit style, which is correct in every locale. The roulette history used an array
index as its key on a prepended list. The customizer's steal fields coerced an
emptied input to a sentinel. Seven components left a pending `setTimeout` that
wrote state after unmount.

## Round 7 — 13 findings

The first live-schema audit found `anon`/`authenticated` holding
INSERT/UPDATE/DELETE on **every public view** (the `stats_*` set,
`collector_stats`, `badge_momentum`) and on the `supabase_migrations` ledger —
grants no migration ever made, inherited from the platform's default ACL.
Migration 0037 removed them, dropped a dead policy and a broken orphan function
(it selected a `profiles.email` column that does not exist), and changed the
schema default privileges so future objects do not inherit the same surface. The
sitemap omitted the entire public `/profile/[username]` family and advertised
`/feed` unconditionally; `robots.txt` now blocks the thin login pages. The economy
verification script rewrote whichever member happened to be first — it now
refuses to run without an explicit target.

## Round 8 — the grant sweep verified clean

Asked one question: did 0037 break anything? Probed as `anon` and `authenticated`
inside rolled-back transactions. The application has exactly **one**
anon/authenticated write in the whole codebase (the `profiles` UPDATE behind
`/api/account`, whose policy and column-protection trigger are intact); every
other mutation and all 15 RPC call sites use the service role. No view lost a
read, no existing object lost a privilege. Three leftovers of the same class were
closed by migration 0038: `user_sync_state` still carried write grants, sequences
still inherited USAGE/UPDATE (which would let a caller rewind an identity), and
two policies had outlived the grants that made them reachable.

## Open, and honestly not fixed

- **Repo state, not code:** six npm scripts and the badgebase-sync workflow
  reference files that exist only in the working tree (`git ls-files` knows 20
  scripts; `badgebase-sync.yml` is untracked). A fresh clone fails those commands.
  Fixed by committing, which is the user's call.
- **Platform-managed:** the `supabase_admin` grantor's default ACL still grants the
  old surface to objects created through Supabase rather than through
  `npm run db:apply`. `postgres` is not a member of `supabase_admin`, so a
  migration cannot alter it.
- **Accepted by design:** the bootstrap passcode's salted digest is in the
  repository; five digits are brute-forceable offline, which is why the door
  closes permanently once an owner is registered and the throttle is audited.
- **Latent, not observed:** `user_inventory`-driven ordering assumptions, the
  `supabase_admin` sequence default, and the `*`-alias escaping in
  `admin-users.ts`'s search, which strips `_` rather than escaping it (an exact
  username containing an underscore does not match in that one search box).
