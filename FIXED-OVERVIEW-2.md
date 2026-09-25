# What was fixed — audit campaign 2 (rounds 1–30)

Second full-project audit campaign, run as the user-mandated loop: read-only
collection agents sweep a scope, the main agent verifies every finding against
the code and the live database, refutes false positives, implements each real
fix himself, then a fresh verification round tries to falsify the fixes. The
loop repeats until a round finds nothing. This file covers rounds 1–30
(changelog rows #360–#433, migrations 0025–0040). The first campaign (258
earlier rows) is documented in `FIXES.md`; per-round evidence lives in
`bugreports/AGENT-AUDIT.md`, every fix has a timestamped changelog entry
(`/changelog`, RSS at `/api/changelog/rss`).

Gates at the end of every round: `eslint` 0 errors, `tsc` clean,
`next build` 238/238 pages with 0 `MISSING_MESSAGE`.

Nothing in this file is aspirational: every item below is shipped and was
re-verified by a later round's agent or a live probe.

---

## 1. Maintenance mode — removed entirely

The maintenance mode built into the ACP (site flag + layout gate + 503s) was
deleted rather than fixed: migrations 0025–0031 dropped the settings section,
the layout branch and the API gate. Rationale and scope are in the ACP notes;
no code path still reads the removed setting.

## 2. Admin Control Panel security (rounds 1–12 highlights)

| Defect | Fix |
|---|---|
| `profiles.role` was missing from the column-protection trigger, so a user could grant themselves `owner` | trigger extended (migration series 0025–0031) |
| Blanket anon grants from the first ACP migration | least-privilege sweeps in migrations 0037–0039: revoked view write grants, ledger access, dead policies, broken SECURITY DEFINER functions; default privileges narrowed |
| `activity_events` was anon-readable in full | migration 0040: table SELECT revoked, 9 specific columns granted |
| Bootstrap passcode door stayed open on a read error (`getAdminIdentityOrNull` returned `{}` on failure, erasing `profileId` and re-opening the door) | fails closed: read error → null → write refused |
| Settings writers accepted a null admin identity | same fix, plus the merge skips null/undefined/"" before `Number` coercion (a null no longer zeroes a key) and round 29 hardened the numeric merge against `false`/`[]`/`" "` coercion |
| Rank ladder had holes | `mayAssignRole` used `>=`, letting a moderator mint peer moderators — now a moderator can only demote, an admin can promote at most an admin (round 29, verified matrix in round 30); the `!self` ladder exemption let a banned moderator unban themselves — self-unban is refused outright (round 25); self-progress stays owner-only |
| Admin users route: progress values not finite-validated, blank fields zeroed economy values via `Number(x) \|\| 0` clamping downstream | supplied fields must be finite numbers (400 otherwise) before `setUserProgress` |

## 3. Games and economy (rounds 13–27)

| Defect | Fix |
|---|---|
| Hilo: fixed payout mispriced long-shot odds | odds-priced payout `min(20, 0.97/winChance)`, score clamped 6..94 BEFORE winChance is computed, impossible-side refund, nextScore drawn 6..94 |
| Slots: pool guard accepted a partial symbol set, cached stale pools | guard requires the COMPLETE preferred set before spinning; the cache is only written after the guard, so a TTL hit can never violate it |
| Settlement: a failed coin bump left a committed round row that polluted streaks/flood window; a failed counter bump did the same; the void delete was unchecked and used a non-null assertion that could swallow the original error | both failure paths void the round row (guarded, error-warned) before rethrowing (round 25, verified round 28) |
| Feed title printed "won -29 coins" for a correctly-called near-certain hilo edge | three-way branch: won+net>0 → "won N coins", won+net<=0 → "called it right", else "played X" |
| SlotsGame compared `lastWin.payout` against the LIVE bet control, not the bet the spin actually charged | all three comparison sites use the `lastWin.bet` snapshot |
| Wheel: jackpot record written AFTER the payout — an insert failure paid the jackpot but lost the record, burned the gate and errored the client | turbo_wins row is inserted BEFORE the award with `.single()` (a no-row insert is an explicit error), and any failure deletes the row and releases the gate (rounds 25/27, verified round 28) |
| Wheel: a failed turbo INSERT itself burned the daily gate | the insert now sits inside the same guarded block as the award (round 27) |
| Achievements: `k_early_bird`/`k_lucky_2500` copy didn't match predicates; `s_level_42/69` used `===` so a level jump skipped them | copy corrected / `>=` predicates (round 24), re-verified across all 125 achievements in round 25 |
| BetBar accepted NaN/empty | string draft clamped on blur/Enter only when finite |

## 4. Syncs (rounds 20–29)

| Defect | Fix |
|---|---|
| badgebase sweep could mass-demote on a partial listing | proportional incident guard (distinct confirmed keys vs parsed cards, denominator excludes custom+removed, MIN_INCOMING floor, never trips on an empty parse) |
| Syncs crashed mid-chunk → earlier chunks committed with no changelog row | compensating changelog rows in badgebase, global AND potat (round 29 closed potat, the last one); failure rows are flagged and the count semantics are honest ("in flight" vs committed) |
| potat upsert reverted columns owned by global/badgebase (the 06:00 UTC collision) | narrowed payload: `id` + potat-owned columns only, conflict target `id`, dedup keyed on `row.id`; counts (rarityUpdated/statusSweeps) taken from the deduplicated rows, not the raw feed |
| global.ts: the badge_added changelog was skipped when the fresh-row lookup or the events/drop-post fan-out threw; the rethrow then also skipped the removal changelog | the lookup and fan-out feed one captured error, every committed mutation class gets exactly one changelog row (added/updated/removed, flagged `fanoutFailed`/`historyFailed`), the rethrow happens after the last block and before the summary (rounds 25→26→27, adversarially verified rounds 27–28) |
| badgebase `enriched` counted pre-dedup and missed pass-2 patches | count taken from the deduplicated write map (round 29) |
| `data-reset` parsing (the site's channel-points overlay attribute) | never parsed — the real claim window comes from the detail page's schema.org `temporalCoverage` (fixed in the first campaign; re-verified here) |

## 5. Web security (rounds 22–29)

| Defect | Fix |
|---|---|
| Raw `error.message` (PostgREST constraint/table text) returned to clients from health, push subscribe ×2, blog react, feed, account, inventory sync | detail goes to server logs / heartbeat payload; clients get generic strings (rounds 26/29) |
| Health route leaked the DB error again through the uptime view's `last_message` (rendered publicly on /stats with a full tooltip) | raw detail moved to the heartbeat payload, which `stats_uptime_sources` does not expose (round 29, verified round 30) |
| Push subscribe accepted unbounded p256dh/auth/user_agent (multi-MB junk rows degraded every broadcast) | crypto keys rejected above 512/128 chars, userAgent truncated to 300 |
| Markdown renderer: `java\u0001script:` passed the leading-only control strip | C0 controls stripped ANYWHERE in the URL before scheme detection; allowlist http/https/mailto |
| Track: DNT duration beacon without an id inserted a second row per page view | DNT id-less duration beacons are dropped (they carry no information; the shared empty hash could never scope a fallback) |
| Track: one row per page view contract | mount POST returns the id, pagehide updates the same row scoped by visitor_hash, MAX_DURATION_S discards >30 min sessions |

## 6. i18n (all 11 locales key-identical — verified programmatically)

| Defect | Fix |
|---|---|
| Steal copy claimed "failed attempts pay the price to the victim" in `faq.stealA` (8 locales), `customizer.stealHint` and `steal.hint` (all 11) — the mechanic pays on EVERY attempt | all three keys corrected in all 11 locales (round 25; the first pass silently missed 8 locales — the failed script taught the verify-the-script lesson) |
| Hardcoded "Network error" in StealPanel and WheelOfFortune | `steal.networkError`/`wheel.networkError` keys ×11 (round 26) |
| Server error sentences rendered raw (victim not found, cost, flood, feature disabled, gate codes) | APIs return stable `code` fields, components map codes through new keys ×11 (8 steal + 3 wheel), English strings stay as fallback (rounds 29/30) |
| FeedList timeAgo used hardcoded "s"/"m"/"h" | locale-aware `Intl.RelativeTimeFormat` (round 26) |
| Stats view read camelCase from snake_case Postgres views | mapped correctly |

## 7. Changelog/logging integrity

Every sync mutation now writes exactly one changelog row under every failure
mode (mid-write, fan-out, history insert); compensating rows are flagged;
`logChange` never throws so it can't derail an error path. Counts in changelog
bodies match what the database actually received (committed-only or explicitly
"in flight").

## 8. Accepted residuals (documented, not bugs)

- **supabase_admin default ACL** and the **bootstrap passcode digest in the
  repo** — known, risk-assessed, mitigated by throttle + auto-expiry.
- **Analytics flood inflation**: the hit counter counts every beacon by design;
  fields are bounded, data is aggregate-only. A rate limit would need per-beacon
  queries and change hit semantics.
- **Clock skew in the games flood pre-check** (DB-ahead clock fails a legit
  strict-1Hz player once) — documented 100 ms slack covers the recheck, not the
  pre-check.
- **Award-after-settlement transient failure** in games: client sees a 500 for a
  settled round; coins stay consistent, no compensation is possible without
  risking double-pay.
- **EmojiReactions** renders emoji glyphs — the emoji IS the feature content
  (like badge images), not decoration; the AGENTS.md no-emoji rule targets
  decorative UI.
- **blog/react toggle** has no flood window: the (post, ip, emoji) unique row
  bounds state; churn is the only cost.
- **DNT foreign-update scope** on track: the shared empty hash can match another
  DNT row, but the only writable value is `duration_s: null` over null.
- **Push fan-out wall-clock cap**: batches past 25 s are skipped rather than
  guaranteed-delivered; the cap exists so a broadcast can't exceed the
  serverless limit.

## 9. Final state

Rounds 28 and 30 verified their predecessor fixes adversarially; the only
defects they found were fixed and re-verified in the following round. Round
29's regression sweeps over the previously-audited surfaces (all 13 games, all
125 achievements, 20 non-admin API routes, client components, all 11 locale
files at 1067 leaf keys each) came back clean on every angle except the five
items in sections 5–6, all fixed. The loop terminates with a clean
verification pass and green gates (eslint 0 errors, tsc clean, build 238/238,
0 MISSING_MESSAGE).
