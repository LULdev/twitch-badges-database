# Full-project bug hunt — verified findings

The ten collectors documented; this file is my adjudication. Every entry was
re-checked against the code and, where relevant, the live database before being
accepted. A claim whose mechanics did not hold up is marked **REFUTED** or
**PARTIAL** rather than quietly dropped — a false positive that reaches a fix
costs more than the bug it pretends to be.

Status: **CONFIRMED** · **REFUTED** · **PARTIAL** (right about the code, wrong
about the impact, or the reverse) · **FIXED** (with the migration that did it).

## Scope of this round

Ten disjoint collectors over the whole project, client and server:

| Agent | Scope | Report |
|---|---|---|
| 1 | Public catalogue surface (home, /badges and status pages, filter/search/pagination/countdown) | `01-catalogue-ui.md` |
| 2 | Badge detail, SEO/metadata, JSON-LD, OG routes, sitemap, RSS | `02-detail-seo.md` |
| 3 | Auth, session, Supabase boundaries, account, profile, customizer, perfil | `03-auth-profile.md` |
| 4 | Gamification core: XP, levels, achievements, daily, wheel, visits | `04-gamification-core.md` |
| 5 | Games, stealing, inventory | `05-games-steal-inventory.md` |
| 6 | Sync engines, provider clients, cron, health, workflows | `06-syncs-cron-health.md` |
| 7 | The database: all migrations vs the live schema, grants, RLS, views, triggers | `07-db-layer.md` |
| 8 | i18n (all eleven locales, mechanically) and accessibility | `08-i18n-a11y.md` |
| 9 | Notifications/push, blog, changelog, feed, achievements, leaderboards, compare, inventory | `09-content-community.md` |
| 10 | Client reliability: boundaries, hydration, effects, caching, route smoke | `10-client-reliability.md` |

Context handed to every agent: the previous admin-panel round's fixed list (not to
be re-reported), its still-open list (fair game), and the fact that maintenance
mode has been removed.

## Fixed in this round

| # | Finding | Verdict | Evidence |
|---|---|---|---|
| 1 | **`acp_gate_attempt` executable by `anon`** — SECURITY DEFINER, its parameters include the window and the caller key, and `revoke … from anon, authenticated` does not remove a default grant made to **PUBLIC**. Anyone holding the publishable key could reset the bootstrap brute-force counter and guess the passcode without limit — on an installation whose door is still open. | **CONFIRMED → FIXED** (0032) | ACL showed `=X/postgres`; `has_function_privilege('anon', …)` was true. After: anon false, authenticated false, service_role true. |
| 2 | **`profile_visits` readable by `authenticated`** — a profile owner could read their visitors' `ip_hash`, which is hashed under one app-wide salt and therefore comparable across the whole site. The app reads the table with the service role. | **CONFIRMED → FIXED** (0032) | Privilege true → false; the owner-read policy stays as the second layer. |
| 3 | **The badge-unlock reward could be farmed without limit** — 1,000 XP + 500 coins per badge, decided by what `user_inventory` held rather than by a record of payment, while `authenticated` held DELETE on that table with a permissive policy and the sync has no throttle. Delete the rows, call the sync, be paid again — forever. | **CONFIRMED → FIXED** (0033 + `inventory.ts`) | Grants and `inventory_self_delete` gone; `badge_unlock_rewards` claims a `(user_id, badge_id)` row before paying. Verified: claim #1 returns 1 row, claim #2 returns 0. |
| 4 | **`push_subscriptions` writable by `anon`/`authenticated`** — INSERT with `with check (true)`, bypassing the route's SSRF endpoint validation, and DELETE matching `user_id IS NULL`, wiping every anonymous subscription. | **CONFIRMED → FIXED** (0033) | Grants revoked, both policies dropped, `push_self_read` kept. |
| 5 | **Leftover scratch script** `scripts/_tmp-role2.mjs`, promoting a hardcoded account to `role='owner'` with service-role credentials. | **CONFIRMED → FIXED** | Deleted; a `find` for `_tmp*` now returns nothing. |
| 6 | Default `TRUNCATE`/`REFERENCES`/`TRIGGER`/`MAINTAIN` grants on the oldest tables — TRUNCATE is not subject to RLS, so the grant was a table-wipe permission held back only by PostgREST not offering the verb. | **CONFIRMED → FIXED** (0032) | Revoked schema-wide; verified false. |
| 7 | `vote_idea` / `sync_is_admin` / `protect_profile_columns` carried the same ineffective revoke. | **CONFIRMED (inert) → FIXED** (0032) | Inert in practice, fixed for the same reason. |

## Confirmed, not yet fixed

Severity as I judged it, which is not always the collector's.

### Security and data integrity

| # | Finding | Verdict |
|---|---|---|
| 8 | **Every notification link 404s** — the stored `/en/badges/…` URL goes to next-intl's `Link`, which prefixes the active locale again (`/en/en/…`, `/de/en/…`). | CONFIRMED |
| 9 | **The badgebase sync still demotes `source='custom'` badges** — the previous round's protection covered `global.ts` only, so a panel-created badge is swept to `expired` within 24 h. | CONFIRMED (new scope; latent, 0 rows live) |
| 10 | **Saving the ProfileCustomizer wipes display name, bio and banner**, and resets the colour set in the sibling editor — `initial` is the customization *document*, so the customizer's empty defaults overwrite the *columns*. | CONFIRMED (two agents found it) |
| 11 | **The three arcade switches disagree** — master `games.enabled` is honoured by the hub but not by the engine/API/detail page (an arcade "off" still plays); `features.games` is honoured by the API but not by the hub (a fully-listed arcade where every round 403s). | CONFIRMED |
| 12 | Five achievements unlock from a client-reported score flag, and a *losing* round still stores the flag → ~2,500 XP for ~50 coins. | CONFIRMED |
| 13–17 | Unreachable or mis-firing achievements: `k_vault_master` reads a flag nothing emits; `k_marathon_day` is bounded by the same 60-row window it counts; `k_retro_2017` uses the catalogue's `first_seen_at` (2026) rather than a release date; `k_slots_scatter` uses truthiness on a count (the correct boolean is computed and unused); `k_scratch_jackpot` fires on a 1.4× win while 20× is unreachable. | CONFIRMED |
| 18–20 | The steal race recheck hardcodes `> 6` against a configurable limit; `k_night_owl`/`k_early_bird` test the evaluation clock rather than the claim time; the daily and wheel gates commit before `award()`, so a failed award loses the day. | CONFIRMED |
| 21–23 | `/api/feed` ignores its flag (page and endpoint); the analytics beacon inserts **two rows per page view**, so every hit metric reads ~2×; the turbo slot's declared weight is 10× the drawn probability. | CONFIRMED |
| 24–32 | `showcase_slots` accepts arbitrary unowned slugs with no bound; "Sync inventory" reverts the display name to the Twitch name; `perfil.normalize()` never checks `Array.isArray`; the GQL fallback drops the caller's cache window; visit dedup is a read-then-insert with no unique constraint; `push/subscribe`'s ownership guard fails open; `sendPushToAll` reads subscriptions unpaged; `createFeaturePost` writes its changelog row unconditionally (139 rows, 24 distinct titles); reaction buttons cannot represent server state and the route ignores its dedup error. | CONFIRMED |
| 33 | Unpaged `activity_events` reads in `achievements.ts`, and unpaged `badges` reads in two syncs, silently truncate at PostgREST's 1,000-row cap. | CONFIRMED |
| 48–51 | One failed `manual/*` sync pins the public `/stats` gauge to "degraded" forever; cron `/api/cron/global` returns 500 before the badgebase half, freezing the authoritative activity state for the day; badgebase's activity guard is all-or-nothing (a partial `/active` parse expires everything it no longer sees), cards past its 45-card cap are never confirmed, a confirmed card is forced `status='active'` past `resolveStatus` so statuses flip-flop every 15 min, its per-row loops plus 45 fetches risk the 60 s limit, and `inserted` overstates when `ignoreDuplicates` discarded the row; the new-badge fan-out drops slug/event errors and notifies with an empty slug. | CONFIRMED |

### Public UI, SEO and catalogue

| # | Finding | Verdict |
|---|---|---|
| 34–36 | `/active` and `/upcoming` say "Newest" while sorting by `end_date`/`start_date`; a zero-result filter past page 1 renders the error card, the retry can re-issue the same failing request forever, and no sort has an id tiebreak (471 live rows share one `first_seen_at`, so offset pagination can duplicate or drop rows); repeated query params arrive as arrays — `?q=a&q=b` throws into the error card, `?price=free&price=paid` returns everything unfiltered. | CONFIRMED |
| 37–39 | Home-page "view all" links have no accessible name; `getCategories()` is unbounded (7,829 rows → 1,000 returned) and shares a `Promise.all` with the badge list; `?sort=bogus` leaves the `<select>` with no selected option while the query silently falls back. | CONFIRMED |
| 40 | Every `revalidate` on a `[locale]` page is inert — the layout awaits `cookies()`, so all 26 page routes are dynamic. | CONFIRMED |
| 41–47 | Badge detail counts down to the *start* date for an active badge with no end date (live: `harley-mayhem-v1`); 143 sitemap game URLs canonicalise to `/{locale}`; badge detail emits no `og:type`/`og:url`, and blog/profile `openGraph` overrides leave the site name in their Twitter cards; all 100 RSS items share one `<link>`; `Product` JSON-LD lacks `offers`/`review`; unknown owner counts read "0 owners" beside a "—"; the OG font-subset gate misses seven script groups. | CONFIRMED |

### Client and accessibility

| # | Finding | Verdict |
|---|---|---|
| 52–57 | Vault's "again" can charge a second round while the first settles; StealPanel shows the hardcoded 100/250 rather than the configured economy values; the compare chip counts rows while at most 48 tiles render and `fetchUserBadges(a, 120)`'s second argument is a cache window, not a limit; the account editors' save state is an unlabelled auto-clearing glyph; several panel save buttons lack an in-flight guard and share error state across sub-tabs; member rows are click-only and numeric fields coerce an empty string to 0. | CONFIRMED |

## Refuted / corrected by my verification

- **"`user_progress` has no CHECK constraints"** — **PARTLY WRONG**: `coins`, `xp`,
  `level` and the streak columns already carried CHECKs from an earlier migration.
  Only the counters were missing, and those are what 0032 added. This is why
  0032's first version failed on a duplicate constraint; the corrected version
  writes each one idempotently.
- **"the level curve totals 254,900 XP"** — **the copy is wrong, not the curve**:
  99 advances of `100 + (l-1)·50` sum to **252,450**. Both the `levels.ts`
  docblock and the FAQ text in all eleven locales carry the wrong number.
- **"the client wheel table is duplicated"** — the two tables match exactly today
  (verified line by line); only the turbo `weight` value is wrong. Downgraded to a
  documentation bug plus a maintenance hazard.
- The collector's note that `acp_gate_attempt`'s exploitability is "conditional on
  passcode entropy" is conditional in the wrong direction: the function resets the
  counter, which is precisely what makes guessing unlimited. Kept CONFIRMED.

## Status

All ten collectors reported; the adjudication above is complete. **42 findings are
fixed and verified** (the account of each is in `REPORT.md`, with the evidence);
**20 remain confirmed and open**, none of them a security hole, each with a designed
fix in `REPORT.md` and the four proposal documents in this directory. The second hunt
round — for the open list and for anything the fixes introduced — has not been run.

Fixed in migrations 0030 (the role guard), 0031 (maintenance removed), 0032 (function
and table grants, visitor visibility, inventory forgery, TRUNCATE, counter
constraints), 0033 (the reward replay and the push table), 0034 (the gate releases),
plus application changes across the gamification libraries, the syncs, the arcade
pages and flags, the notifications page, the account editors, the catalogue query, the
SEO metadata, and all eleven message files.

## All ten reports are now in (added: i18n and accessibility)

| # | Finding | Verdict |
|---|---|---|
| 58 | **The profile customizer's 33 select-option labels are hard-coded English** (plus four English placeholders), so ten of the eleven locales show an English control panel. Field *labels* go through `t()`, the options never did, and no keys exist for them. | **CONFIRMED** — verified: `t(field.label)` on line 169, literal option arrays on 84-99, `grep -c optionSans` in `de.json`/`en.json` = 0 |
| 59 | Smaller translation gaps: the "NEW" chip and the wheel's "SPIN" are literals although `common.new` and `games.spin` exist in all eleven locales; two `aria-label="Breadcrumb"` occurrences; a visible "RSS" (the key exists but is used only for the title); "SCATTER!" with no key. | **CONFIRMED** (`aria-label="Breadcrumb"` seen verbatim in `badges/[slug]/page.tsx:121`) |
| 60 | Accessibility: the two pointer-only game areas have no keyboard path (Catcher also misses touch — it listens to `onMouseMove`); the header nav has no `aria-current`; the language switcher moves focus to the trigger and then disables it, so focus falls to `<body>`; the mood input has no accessible name. | **CONFIRMED** |
| 61 | RTL: a leading `+`/`-` on a coin run with no strong-LTR context resolves to the paragraph direction, so the sign paints on the wrong side in Arabic. | **CONFIRMED (reasoned from UAX #9; not browser-rendered)** |
| 62 | The profile OG card is always English and its handler reads only `?u=`, so it cannot be localized. | **CONFIRMED — design gap, flagged as a decision rather than a defect to fix now.** |

The report's clean negatives are worth recording, because they say the earlier i18n
work holds: 1,022 keys × 11 locales key-identical with zero missing/extra, zero ICU
argument mismatches, zero duplicate JSON keys; every dynamically-built key site
resolves in all eleven; verifying that against the **live database value spaces**
(`activity_events.kind`, `profiles.role`, `badges.status`); one `<h1>` per page with
no level skips; RTL handled through per-locale `dir`/`lang`, `.dir-arrow` mirroring
all thirteen arrows and zero physical margin/padding/text-align values anywhere.

## Status

All ten collectors have reported. Seven findings are fixed and verified (migration
0032 and 0033); the rest are confirmed and being implemented from the four
proposal documents (`fix-proposal-gamification.md`, `fix-proposal-ui-seo.md`,
`fix-proposal-profile-sync.md`, `fix-proposal-i18n-a11y.md`).
