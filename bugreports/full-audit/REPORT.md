# Full-project bug hunt — what was found, verified and fixed

Ten read-only collectors audited the whole project, client and server, in disjoint
scopes; the reports are the `0N-*.md` files in this directory and my adjudication of
every one of their findings is in `VERIFIED.md`. This file is the account of what
happened to those findings.

Around **90 findings** were reported. Each was re-checked against the code and, where
relevant, the live database before anything changed — that step is not a formality:
it corrected four of the collectors' claims and downgraded two findings whose
mechanism was right but whose impact was overstated (all recorded in `VERIFIED.md`).

**Fixed and verified: 42 findings.** **Confirmed and still open: 20**, listed at the
end with the fix already designed. No finding was silently dropped.

## Critical — exploitable

**The badge-unlock reward could be farmed without limit.** `syncUserInventory` paid
1,000 XP and 500 coins per badge it found newly present in `user_inventory`, and
"newly present" was decided by the table's contents rather than by a record of what
had been paid. `authenticated` held DELETE on that table with a permissive policy,
and the sync endpoint has no throttle: delete your rows, call the sync, be paid again
for every badge you own — repeatedly. Fixed by revoking the delete grant and dropping
the policy (the sync is the only writer, with the service role) **and** by making the
payment idempotent: a `badge_unlock_rewards` row keyed on `(user_id, badge_id)` is
claimed before anything is paid. Verified: claim #1 returns one row, claim #2 returns
zero, so a badge can never pay twice however its row churns.

**`profiles.role` was missing from the column guard.** Migration 0025 added the
column; `protect_profile_columns` was never extended, and `viewerRole` authorises on
that column alone — so one PATCH to the public REST API could have made any signed-in
member an owner, able to demote or delete the real owner. Confirmed by reading the
guard and the grants. It was **not exploitable as deployed**, for an unrelated reason:
the guard is not `SECURITY DEFINER` and reads `is_admin`, which `authenticated` may
not SELECT, so the whole UPDATE was refused. That is protection by accident — and
marking the trigger `SECURITY DEFINER`, the natural fix for that very error, would
have armed it. Migration 0030 restores `role` in the guard, so the protection no
longer depends on the accident.

**`acp_gate_attempt` was executable by `anon`.** It is `SECURITY DEFINER`, writes
`site_settings`, and takes the window and the caller key as parameters — so anyone
holding the publishable key could call it with a fresh key to reset the bootstrap
brute-force counter and guess the passcode without limit, on an installation whose
bootstrap door is still open. The cause is worth remembering: `revoke … from anon,
authenticated` does **not** remove a default grant made to **PUBLIC**. Fixed by
revoking from PUBLIC; verified anon false, authenticated false, service_role true.

**`push_subscriptions` was writable by `anon` and `authenticated`** — INSERT with
`with check (true)`, which bypasses the route's SSRF endpoint validation, and DELETE
matching `user_id IS NULL`, which wipes every anonymous subscription.

**All six ACP tables carried blanket grants** inherited from Supabase's default
privileges, including TRUNCATE — which is *not* subject to row-level security, so it
was a table-wipe permission held back only by PostgREST offering no truncate verb.

**A leftover scratch script of mine**, `scripts/_tmp-role2.mjs`, promoted a hardcoded
account to `role='owner'` with service-role credentials. Deleted.

**`profile_visits` was readable by `authenticated`.** A profile owner could read
their visitors' `ip_hash` values, which are hashed under a single app-wide salt and
are therefore comparable across the whole site — enough to tell that the same visitor
browsed two profiles. The app reads that table with the service role, so the grant was
pure exposure.

## High — broken features and silent data loss

**Every notification link 404'd.** The URL was stored as `/en/badges/<slug>` and
rendered through next-intl's `Link`, which prepends the active locale — so it became
`/en/en/badges/…` on the English page and `/de/en/badges/…` on the German one: one
click, wrong every time, for every visitor in every language. Fixed on both sides: the
sync now stores a locale-less path (which also fixes the empty-slug case, `/en/badges/`,
itself a 404), and the page strips a leading locale segment so the rows already in the
table resolve too. Verified: the stored row still carries the old prefixed URL, the
English, German and Arabic pages now render no doubled prefix, the target answers 200
in both locales, and the old doubled form still 404s.

**Saving the profile customizer wiped the member's name, bio and banner.** The
account page mounts two forms against one route; `AccountSettings` seeds the columns,
the customizer seeded the same four fields from the `customization` document — empty
for anyone who never opened it — and shipped all four on every save. Because the route
writes any string field it is handed, toggling one effect overwrote `display_name`,
`bio` and `banner_url` with empty strings and reverted a colour set in the sibling
editor. The customizer now sends only what it owns and no longer offers the four
inputs, so nothing looks editable but does nothing; the four keys stay on the type so
existing documents still round-trip.

**Editing any badge relabelled it `custom`.** The payload carried `source: "custom"`
and the update branch wrote the whole payload, despite a comment claiming the field
was not editable. The catalogue sync treats `source='custom'` as admin-owned — so the
row stopped being refreshed *and* stopped being swept when the badge disappeared, and
the delete guard then permitted deleting a provider badge. That inverts the protection
the feature exists for.

**The badgebase sweep had the same gap in a second place:** it demoted hand-made
badges to `expired` within 24 hours (they are active and dateless, and never appear in
badgebase's `/active` listing). Now exempted, exactly as `global.ts` already did.

**A failed reward consumed the day.** The daily and wheel gates commit their
once-per-day claim in a separate transaction from the award, so a transient failure
spent the whole day — and the wheel left `wheel_spins` incremented for a spin that
never paid. Migration 0034 adds two service-role-only functions that release a gate
still pointing at today in one atomic statement (the wheel release also undoing the
counter), so the caller can release it from a `catch` and the member can retry.

**Five achievements unlocked on a losing round.** The skill games emit `sharp`,
`perfect`, `fast`, `streak10` and `hundred` from a client-reported score, and the flag
was written on every round — so one 10-coin POST banked ~2,500 XP. The flags are now
gated on the win the server itself decided. This **mitigates** rather than eliminates:
the forge cost rises from one request to about 22 coins. Retiring the five
achievements or making the games server-authoritative are the complete fixes; both are
larger and are named in the proposal rather than done quietly.

**Three achievements could never unlock and two mis-fired:** Vault Cracker read a flag
nothing ever wrote; Marathon counted rounds from the same 60-row window it was bounded
by; Time Traveler read the catalogue's detection year (2026 for every badge) instead
of the release date; Scatter! tested the truthiness of a column *count* so one scatter
sufficed; Golden Scratch fired on a 1.4× three-of-a-kind while claiming 20× — the
payout caps at `min(20, base*2)` with base ≤ 5, so 10× is the ceiling and the copy now
says so.

**Three arcade switches disagreed with each other.** The master switch and
`features.games` were honoured by the hub and the API route while the engine settled
rounds regardless, so an arcade switched off stayed playable from a game URL; and
`features.games` was honoured by the API but not the hub, leaving a fully listed
arcade whose every round 403'd. The engine now enforces all three, the pages agree
with it, and the switch matrix is verified against the live database: master off → 0
tiles and the arcade-off card, feature off → 0 tiles (previously 13), one game off →
12 tiles and a 404 on its page, default → 13.

**The `/api/feed` flag and the `features.feed` page** left the feed fully readable and
rendered with the feature switched off; both now 404. **Vault** could charge a second
round while the first settled (a synchronous ref guard, since a state transition can
re-enter before `busy` re-renders). **StealPanel** advertised a hardcoded 100/250
while the engine charged the configured economy values.

**The database invariants** the app clamps on every path it owns are now CHECK
constraints: non-negative game XP, achievement points, coins won/lost, games
played/won, wheel spins, steal counters; and games won never exceeding games played.
Four columns (coins, XP, level, streaks) already had them — the collector reported the
table as having none, which is why each constraint is written idempotently.

## Medium — correctness, honesty and reachability

Seven achievements and economy values were corrected as above; the rest:

- **`/active` and `/upcoming` said "Newest"** while the query sorted by `end_date`/
  `start_date`. The sort control now reflects the query.
- **An unknown `?sort=` blanked the control** while the query silently fell back to
  `newest`. Only a known key reaches the switch now, and a repeated parameter uses the
  first value — the one the control shows.
- **A badge with no end date counted down to its start date** in the past, beside its
  "Live" chip, and a non-null assertion hid the missing case from the type checker. It
  now reads "No expiry / Live now", and a badge that does have an end date keeps its
  working countdown (both verified against the live catalogue).
- **143 game URLs canonicalised to the locale home page** because the rendering branch
  of `generateMetadata` returned no `alternates`, contradicting the sitemap. Fixed.
- **`createFeaturePost` wrote its changelog row unconditionally** while the upsert
  above it discards duplicates — the live changelog held 139 such rows under 24
  distinct titles. The row is written only when the insert actually landed.
- **The compare chip counted badges the grid does not render** (capped at 48 tiles);
  it now says `48+`.
- **The account save result** was a bare "✗" that appeared and cleared on its own,
  with no live region. Both outcomes are announced now, and the failure says something
  (`errors.generic`, already complete in all eleven locales).
- **The profile customizer's 28 option labels and 3 placeholders were hard-coded
  English**, so ten of the eleven locales showed an English control panel. They are
  message keys now — 33 new keys, merged into all eleven files and verified
  key-identical (1,055 keys, nothing overwritten).
- Four more literals became keys, reusing existing ones rather than duplicating them
  (`common.new`, `games.spin`, `changelog.rss`, plus one new `games.scatter` whose
  value is identical in every language because it is a symbol name).
- **Fourteen pages declared a `revalidate` window that could never take effect** — the
  locale layout awaits `cookies()`, so the segment is dynamic. Removed rather than left
  looking load-bearing; the reason is recorded in the layout, and the two genuinely
  cached routes (sitemap, OG image) keep theirs.

## Accessibility

The mood input had no accessible name. Both navigation menus expose the current page
with `aria-current` instead of only a colour difference. The language switcher no
longer drops focus to `<body>` after a change — focusing a control and then disabling
it in the same transition makes the browser blur it, so the trigger is `aria-disabled`
and re-entry is guarded in the handler. The Catcher game is now playable from the
keyboard (the basket moves on one axis, so the arrow keys map onto it directly, with
`role="application"` so assistive technology passes the keystrokes through) and it
also works on touch — it listened to `onMouseMove`, which never fires for touch or
pen. The leading sign on a coin amount is wrapped in an LTR island so it stops
painting on the wrong side in Arabic.

For **Shoot the Badges** the collector's honest answer is preserved rather than papered
over: a faithful keyboard path would need a 2D arrow-key crosshair in a 30-second
reflex game, which would be so much slower than a pointer that the game would be
effectively unwinnable while still charging a bet. It stays pointer-only, and the
limitation is recorded instead of shipped as a worse game.

## Gates and regression check

`lint` 0 errors (5 pre-existing warnings, down from 7 — two unused-variable warnings
disappeared with the fixes), `typecheck` clean, `build` 238 pages with no
`MISSING_MESSAGE`.

A regression smoke ran over 31 routes plus the inventory page and a blog slug after
all changes — every one answered 200. The functional checks recorded above (arcade
switch matrix, notification links in three locales, the badge expiry strip, the
reward-idempotency claim, the gate functions) were each run against the live database
or a running server, not inferred.

## Still open — confirmed, with the fix designed

These are real and verified; their proposals are written and await implementation.
None is a security hole: the two genuine ones were fixed above.

| Finding | Why it is not done yet |
|---|---|
| `showcase_slots` accepts arbitrary unowned slugs, with no length bound | Needs both a route guard and a database constraint (migration 0035) |
| The visit-dedup window is a read-then-insert with no unique constraint, so overlapping requests double-count | Needs the same migration; the proposal documents the residual honestly |
| `perfil.normalize()` never checks `Array.isArray`, so a malformed provider body throws (a silent 404 on a real profile on the GQL leg) | Small, but it changes a third-party parsing path |
| The GQL fallback hardcodes `revalidate: 0`, so a badges.blog outage turns every profile view into an uncached Twitch call | Small |
| Reaction buttons cannot represent server state, and the route ignores its dedup error | Needs a server read plus a client rework |
| Unpaged reads in `achievements.ts` and two syncs truncate at PostgREST's 1,000-row cap | Each site needs its count/max semantics re-derived |
| The badgebase rewrite: proportional incident guard, confirmation past the 45-card cap, `resolveStatus` everywhere, bulk upserts, honest `inserted` | One full rewrite of `runBadgebaseSync`; the most substantial item left |
| The cron returns 500 before the badgebase half, freezing the activity state for the day | Restructures the route's status contract |
| One failed `manual/*` sync pins `/stats` to "degraded" | Small, but it needs a decision about what a manual run should count towards |
| The catalogue UI: a zero-result filter past page 1 shows the error card, the retry can loop, no sort has an id tiebreak, repeated params arrive as arrays | Interacting changes to `listBadges` |
| SEO: all 100 RSS items share one `<link>`; `Product` JSON-LD lacks `offers`/`review`; badge detail emits no `og:type`/`og:url`; blog/profile Twitter cards inherit the site name; the OG font subset misses seven script groups | Independent, cheap, and none is user-visible |
| Panel UI: missing in-flight guards on some save buttons, shared error state across sub-tabs, click-only member rows, numeric fields that coerce an empty string to 0 | Carried over from the previous round's open list |

**The loop the operator asked for is therefore not closed.** One more hunt round —
looking both for these and for anything the 42 fixes introduced — is still owed, and
the open list above is what it should start from.
