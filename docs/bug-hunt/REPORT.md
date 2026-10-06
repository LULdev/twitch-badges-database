# Bug Hunt Report — 2026-10-06

**Method:** 10 parallel Bug-Hunter chains × 5 generations = 50 read-only agents. Each wave ran a different lens (1 correctness, 2 security/authz, 3 concurrency & economy invariants, 4 edge cases, 5 verification + integration seams). Chains had disjoint file scopes; later waves received the earlier waves' findings to avoid re-reporting. No code was changed, no DB touched, no builds run.

**Raw output:** [raw-wave-1.md](raw-wave-1.md) · [raw-wave-2.md](raw-wave-2.md) · [raw-wave-3.md](raw-wave-3.md) · [raw-wave-4.md](raw-wave-4.md) · [raw-wave-5.md](raw-wave-5.md)

**Totals:** 244 agent findings → ~230 unique after cross-chain dedup. Wave 5 re-verified the top claims: 29 of 30 CONFIRMED, 1 REFUTED (noted below), 2 quantitative corrections applied. Severity tags are the agents'; the highest-stakes items carry wave-5 verification.

---

## P0 — exploit paths, fix first (3 clusters)

### P0-1 · Anon-callable SECURITY DEFINER economy RPCs (PUBLIC default EXECUTE) — VERIFIED authoritative
Three functions are executable by anyone holding the publishable anon key via `/rest/v1/rpc`, because every post-0041 migration revokes only `anon, authenticated` and PostgreSQL's default `PUBLIC EXECUTE` survives (drop/recreate re-arms it; `create or replace` keeps it):
- `purchase_item(uuid,text,int,int)` — final state 0059:15; lapse sites 0052:61, 0053:65, 0059:89. Caller-supplied `p_price`: a **negative price mints unlimited coins** for any profile uuid (`coins = coins - p_price`); arbitrary `p_item_key` floods the public feed (0059:79-80).
- `grant_starter_items(uuid)` — final 0049:29, lapse 0049:58. Anon mints 2 Streak Freezes for any uuid (profiles.id is anon-readable).
- `game_streak_gate(uuid,date)` — final 0050:9 (`create or replace`, NO revoke at all), lapse sites 0047:62, 0049:132. Anon forges/resets ANY player's streak, burns/earns freezes, feeds the streak bonus.

Root cause: migration 0037's default-privilege change (0037:63,68) strips only `anon, authenticated` and its comment falsely claims objects "start from nothing" — the authors of 0047–0059 relied on that claim (doctrine: 0032:20, 0041:177-178, 0019 precedent).

**Fix (must be atomic — see P0-3 trap):** per-function `REVOKE ALL ON FUNCTION public.<fn>(...) FROM public;` after each create/recreate (plus service_role grants, already present); fix 0037's default privileges to also revoke from `public` and correct its comment; add a migration-level ACL audit.

### P0-2 · Parallel theft mints coins (`apply_pair_deltas`) — VERIFIED (path traced end-to-end)
`daily.ts:168-280` + `0015_pair_deltas:29-42`: the thief's `tooPoor` is a separate pre-read; flood guards are per-victim (`racedPair > 1`) and per-hour (`> stealPerHour=6`), so two **parallel** steals against two different victims both pass; `apply_pair_deltas` clamps each side independently (`greatest(0, coins + delta)`), no cross-side affordability check. Balance in `[price, 2·price)` → thief pays `balance` while both victims are credited `price` → ≈price minted per pair (~10k max), sustainable by rotating alts (6 attempts/h each).

**Fix:** one guarded UPDATE checking `coins >= -p_a_delta` under the row lock, or assert sum-of-deltas = 0 after clamping.

### P0-3 · Hilo grades `won:true` on net-0 correct calls → achievement farming — VERIFIED (exact enumeration; W2's "90%" corrected to 74.4%)
`games.ts:803-825` (+231-232): every correct call counts as a win even when the odds-priced payout ≤ bet. Always picking the higher-probability side wins 74.4% of rounds at EV ≈ 0.942 (no coin farm) but farms the win-streak achievements `s_midas` (2,500 XP + 1,000 coins), `k_hilo_10`, `k_cautious`, `c_win_*` for ~33 coins. Related free-XP leak: the 6/94 "impossible side" refund (games.ts:805-819) still counts games_played + 2 XP + streak + roundsToday.

**Fix:** grade `won` (and streak/XP counters) on `payout > bet`; skip counters on `payout === bet` refunds.

---

## P1 — high-impact bugs, verified

1. **Four service-role functions are DEAD since 0032/0034 (revoke-without-regrant).** Zero `grant execute` exists anywhere for `release_daily_gate`, `release_wheel_gate` (0034:56-59), `acp_gate_attempt` (0032:20-21), `vote_idea` (0032:22-23). Consequences: gate release after a failed award fails 42501 (caught + `console.warn`) → **failed daily/wheel claim burns the gate forever** (the exact bug 0034 was written to fix); the ACP bootstrap door can never complete on a fresh install; every idea-board vote errors. Fix: `GRANT EXECUTE ... TO service_role` on all four.
2. **`stats_analytics_recap_refs` view is anon-readable** (0046:18 — default SELECT to anon/authenticated survived; 0048 claims it's protected): raw recap-click paths incl. `/xx/profile/<username>` exposed. Fix: revoke from anon/authenticated.
3. **BadgeCard & leaderboards render "—" for every owner count** (VERIFIED): `owner_count/active_count` are bigint → PostgREST strings; `formatCompact`'s `Number.isFinite` rejects them. Sites: BadgeCard.tsx:17 (every catalog tile), leaderboards/page.tsx:145. Same root family below.
4. **~29 stats KPIs render 0** (VERIFIED): stats.ts:451-455 passes five view rows raw (every column `::bigint`) → CountUp rejects strings → CoinsStolen, WheelSpins, BadgeClaims, TurboWins, CoinRains, 5 traffic KPIs, 14 system tiles, and the 5 visitors KPIs (analytics.ts:115 raw merge). Fix: `num()`-map all five views + the analytics summary (the gamification map at stats.ts:376-465 already shows the pattern).
5. **TBRI momentum permanently inert** (VERIFIED): `growth_24h` is int8 → string; `Number.isFinite("42")` fails in rarity.ts:107-109 → every badge's momentum term stuck at neutral 0.5 → whole-catalog rarity scores/tiers wrong. Compounded by the baseline having no freshness floor (0002:32 + queries.ts:426-436): quiet syncs make "24h growth" cumulative and ratchet stored rarity_score. Fix: `Number()` at potat.ts:137-140 + add a 48h floor.
6. **potat `valuesChanged` always true** (VERIFIED): numbers vs bigint-strings (potat.ts:205-207) → every hourly run rewrites every matched row AND appends a badge_stats point; the >1h throttle is dead code. Fix: Number() both sides.

---

## P2 — important (grouped by theme)

**Economy & ledger**
- Inventory transaction list double-counts big wins: txRows leg (activity_events incl. `big_win` coinsAmount=net) + roundRows leg (payout−bet) both include the same round — inventory/page.tsx:149-152,299-345. Exclude one leg.
- Sync rewards: `badge_claim` feed rows (+500c) written BEFORE `award()`; on failure rows stay (phantom payments), retry computes toAdd=∅ → reward lost forever — inventory.ts:139-174. Write after award.
- Freeze earn leg has NO cap (purchase capped at 5) → quantity unbounded while UI shows "capped at 5" — 0049:117-123 vs items.ts:5.
- Wheel release recomputes `today()` at catch time → award failure crossing UTC midnight burns the spin — wheel.ts:130-138.
- `release_daily_gate` rewinds `last_login_date = p_today-1` → failed claim retried after midnight resets login_streak to 1 — daily.ts:62-77 + 0034:26-36.
- One freeze burns for ANY gap length (2–60 days) vs contract "bridges ONE missed day" — 0049:91-96.
- Achievement counters: `stealCostPaid` string-concat ("0100100") → `s_generous` unlocks after ~2 failed steals; `s_broke`/`s_lucky_777` strict-equality vs strings never unlock — achievements.ts:883,267,276.
- Coin-flow aggregates have ZERO theft coverage in either direction (thief −cost by design has no feed row, but no union leg either; victim card misses it) — CoinFlowCard.tsx:25-33, stats_coin_flow_daily 0054. Add union legs or document.
- `purchase_item` narrows bigint coins to int4 → balances >2.1B break all purchases for that player — 0052/0053/0059.
- items/buy has no idempotency nonce (games/play does, 0063) → retry buys twice — api/items/buy:10-25.
- potat rarity fallback: owners-feed failure feeds raw string/null owner_count into computeRarity → garbage rarity_score upserted over the catalog — potat.ts:168-190.

**Sync integrity**
- Removal-sweep blind band: guard only trips <50 keys or <50% → truncated feed sweeps up to half the catalog to 'removed' with permanent history — global.ts:122-136,271-286. (Related: uuid exemption means superseded versions are NEVER retired — global.ts:278-285; resurrected badges write no 'restocked' event — global.ts:255-259.)
- potat derived status written from stale snapshot can overwrite a fresh badgebase confirmation to 'expired' for up to 1h — potat.ts:192-253.
- Concurrent runs duplicate badge_stats points (no unique (badge_id,polled_at)) and duplicate the new-badge fan-out (badge_events/changelog/notifications/push have no unique keys; no advisory lock) — potat.ts:262-269, global.ts:350-515. Add per-engine advisory lock + partial unique indexes.
- Distribution leg with 200/`{"data":[]}` reports green while writing nothing (asymmetric with owners leg) — potat.ts:59-66.
- badgebase: HTML entities stored raw; out-of-range data-ts RangeError aborts the run pre-write; image-CDN regex hardcode would mass-expire the catalog on a host change — badgebase.ts:101-104,211,227; syncs/badgebase.ts:245; twitch/badgebase.ts:88-90.
- global null-field wipes: partial upstream entry NULLs stored description/images (only title has keep-fallback) — global.ts:230-244.
- momentum read un-paged → 1000-row silent cap (long tail neutral) — potat.ts:127-129.
- isInitialSeed defeated if badgebase syncs first → ~500 blog posts + push blast — global.ts:342.
- Cron heartbeats collapse failures to "degraded" (never "error") while serviceStatus escalates only on "error" → failed week reads "All systems operational" — cron routes + stats.ts:274-278. Related population bugs: hero "lastUpdate"/availability hints/calendar/48h strip include the per-minute web probe while gauges are pipeline-only.
- cron/global + manual scripts write heartbeats without `summarize` (payload NULL) and scripts use "sync/*" source (mask a failed daily run) — cron/global:29, scripts/sync-global.ts:7.

**Races (UI + server)**
- /api/admin/setup owner registration has no CAS → concurrent POSTs mint two permanent owners — setup:73-83.
- /api/track: beacon `id` returned as string, client rejects → attach path dead → sessions >2min double-count hits; wrong-type fields insert duplicate rows — track:89,110-111,184-187.
- FeedList overlapping 5s polls render out-of-order feed — FeedList.tsx:51-71.
- Admin panels' debounced list loads have no stale-response guard (Audit/Badges/Brainstorm/Content/Users) → slow response overwrites wrong-filter results; UsersPanel `act()` re-opens a stale drawer (operator can edit wrong user) — UsersPanel.tsx:93-185.
- BadgeReactions two-tab toggle diverges permanently (non-atomic toggle + W1's swallowed delete error) — BadgeReactions.tsx:34-64.
- Catalog offset pagination drifts under concurrent inserts (listBadges sort=newest) — queries.ts:294; unstable_cache tags "catalog"/"home" have zero revalidateTag callers (5-min stale windows) — queries.ts:590-687,934-1014.
- games.ts void paths swallow DELETE errors → unsettled ghost rounds persist in streaks/stats/views; no "settled" flag → serverless kill between insert and recheck replays ok:true forever; insert-latency skew can void a legit ≥1s round (nonce cleared → unreplayable) — games.ts:81,102-119,285-355.

**Pages & routes**
- proxy.ts mixed-case locale prefixes (/EN) dodge the geo bail → /EN/faq → /de/EN/faq → 404 for geo-fallback visitors — proxy.ts:25-26 (VERIFIED).
- Hub big-wins ticker links winner→game page (home strip does the opposite) — games/page.tsx:177-184.
- Inventory owned% >100% (active-only denominator vs all-status owned) — inventory/page.tsx:112-113 (VERIFIED).
- Home/leaderboards queries missing `.order("id")` tiebreak (471 rows share first_seen_at etc.) → nondeterministic sections — queries.ts:612-628, 977, 1026-1037, 403-411.
- JSON-LD offers.availability hardcoded InStock for expired/upcoming badges; confirmed-active chip contradicts Upcoming — [slug]/page.tsx:360, 388-390.
- Account page hardcodes steal fallbacks 100/250 and ProfileCustomizer persists them on every save (overrides admin economy) — account/page.tsx:73-75, ProfileCustomizer.tsx:169-171.
- Stored-status staleness: "Live" chip above a zeroed countdown, expired badge stays on /active — BadgeCard.tsx:88-91.
- All 14 game BetBars hardcode bet bounds while the engine enforces admin settings — useGame.tsx/14 components vs games.ts:207-212.
- STATUS_LAYOUT_PREVIEW flip silently changes production default layout — status/page.tsx:44-52.
- Bootstrap passcode salt+digest committed → offline HMAC recovery on any unclaimed install — admin.ts:79-81.
- Banned staff gets 500 error boundary instead of forbidden card — admin/page.tsx:37-44.
- seo.ts silent localhost fallback for all canonicals if NEXT_PUBLIC_SITE_URL missing — seo.ts:5 (VERIFIED).
- sitemap: one corrupt updated_at → Invalid Date RangeError → whole sitemap 500 — sitemap.ts:171,183 (VERIFIED).
- CoinFlowCard offset pagination double-counts under concurrent inserts — CoinFlowCard.tsx:24-39 (basis verified).
- No CSP/HSTS headers anywhere — next.config.ts.

## P3 — real but lower stakes (one line each)

- games.ts:519-533 newPersonalBest flag absent on replay paths → "new best" moment suppressed for the record-setting round.
- achievements.ts:841 level achievements read STORED level (never recomputed on admin xp edits) → drift vs computed level.
- games.ts:677 slots jackpot flag evaluated on uncapped payout → never true below bet 200.
- useGame.tsx:123 fractional bets shown 10.5, settled as 10.
- PinguGame.tsx:152-205 client truth beats server (writeBest on ok:false; lost response replays prior verdict).
- game_streak pre-check hard 1000ms across clocks without slack; both-survive burst via latency jitter; streak flags graded from pre-insert snapshot.
- api/admin/sync failure returns raw error.message + writes no audit; admin/users 22P02 → 500; admin/content dates unvalidated (garbage → 500, reversed range stored).
- api/admin/ideas `up !== false` mis-votes; push PATCH/DELETE skip POST's validation; push subscribe: no per-caller cap; SSRF-ish endpoint allowlist gap (wildcard DNS).
- React stream: AnalyticsBeacon duplicate visit race; LiveRefresher overlapping refreshes; LanguageHint/ThemeToggle no storage listener (cross-tab).
- AdminShell unmounts panels on tab switch → unsaved edits lost.
- WheelOfFortune: network drop after award consumes the spin invisibly; unknown slot id parks pointer wrong.
- Countdown NaN timer ("NaN:NaN:NaN" live) + interval never cleared at zero.
- BadgeImage/avatars: zero onError handlers → broken-image glyphs.
- BadgeExplorer whitespace-only `?q=` empties grid; `_`/`\` survive ilike sanitize; HowTo JSON-LD hardcoded English; upcoming-with-end-date counts down to an unopened window.
- blog markdown: code spans parsed after strong/link (leak); `![img]()` broken into a link; upstream links unrestricted in drop posts (page side is twitch-only).
- RSS: illegal XML control chars not stripped (one byte kills the feed); permalinks/language pinned to /en; changelog pubDate unguarded.
- listPosts unpaginated → 1000-row cap truncates prev/next/related at scale; changelog logChange/logChanges unvalidated + swallow errors (batch all-or-nothing).
- status page: hardcoded English units ("2h 15m") in all locales; degraded-vs-error counting inconsistent across gauges/calendar.
- server.ts cookie parse keeps first duplicate → stale session after domain change (latent).
- admin bootstrap: acp/vote/gate dead-grants (see P1-1); 0037 misdocumented default privileges; 0059 schema-wide revoke silently destroyed 0056/0058 anon grants (masked by PUBLIC) — fix P0-1 per-function, not blanket.
- Migrations replay: add-constraint-without-drop in 0030/0046/0047 → 42710 on replay; duplicate 0041 prefix.
- handle_new_user username check-then-insert race → concurrent signup aborts.
- sync-highlights recap winner selected by gross payout but claims "+net" ("+-N" render); blog.ts bigint toLocaleString no-op in recap sentence; getRecapClicks7d/uptime-snapshot bigint strings ungrouped.
- visits dedup: bump-failure arms the window without counting; bucket-flip boundary double-counts.
- steal: `Math.max(1,…)` mints 1 coin from a ≤9-coin victim; non-string victim body → 500; stealable=0 edge.
- notifications protocol-relative hrefs render off-site Links (latent); proxy /api case-sensitivity (latent); OAuth redirectTo drops geo locale at login; login/callback canonicalize to home.
- OG images: emoji/mixed-script names → tofu; failed font loads cached as null.
- send-push.ts static imports (CJS rule) + silent no-op; .env.example gitignored; .render-session.json/.round-nonce-state.json ungitignored (live credentials); committed scratch files; package.json stray duplicate keys; 0x08 bytes in import-backlog regexes; code-health allowlist bare names neuters the CI gate; admin/sync maxDuration 120 vs Hobby 60.
- potat page.data non-iterable on shape change (no Array.isArray guard); byUuid fallback attaches stats to wrong version when artwork is shared; helix stale token silently downgrades to IVR; resolveStatus NaN dates resolve 'active' forever; badgebase slug-collision 23505 aborts chunks deterministically.
- Feeds/misc: feed coins_amount strings; track wrong-type double-count; news feed t(event.kind) raw key fallback + hardcoded "XP"; WheelOfFortune/Turbo weight-vs-probability documentation trap.
- Infra: no markdown image support in renderer; cookie first-wins; record_break_leaders(p_days) unbounded anon RPC (interval overflow + full-table scans per call); newPersonalBest p_limit NULL → unbounded (0056); add_coins/apply_xp_coins NULL p_amount; gate RPCs NULL p_today; stats_gamification windows are N+1 days; daily/hourly views group in session TZ vs UTC clients; serviceStatus ageMinutes can go negative.
- a11y: EmojiReactions no aria-pressed; Header avatar alt double-announcement; mobile menu no Esc; mixed numeral systems in ar countdown; uppercase/letter-spacing on Arabic script; RTL physical padding; RARITY_COLORS light-mode contrast fails.
- i18n: 24 dead keys ×11 locales; ru.json missing `few` plural (stepWatchTimeHours); 10 locales carry a stale faq.blogA translation with broken syntax; 5 more locale-less toLocaleDateString in admin panels; users panel locale-less formatting; inventory hardcoded English alt.
- docs: AGENTS.md "67 migrations" vs 65 on disk (ledger says 65).

## P4 — cosmetic/polish
DistributionBars 1.5% min-width on zero rows; daySeries "d.M." labels all locales; zero-heartbeat "degraded" pill (no unknown state); TrendChart/System/Donut empty states unreachable or orphaned legends; RecordLeaders ungrouped breaks count; LiveStatus probe overlap (cosmetic); gameStreakXpPerDay/gameStreakXpCap missing from ECONOMY_FIELDS; SettingsPanel knopf gaps; header menu a11y; StealPanel raw English error strings.

---

## Verification verdicts (wave 5, 30 claims)
29 CONFIRMED · 1 REFUTED: **profile double-decode URIError (W2 chain 9 #2)** — the decode is guarded (try/catch → 404); only a latent canonical-drift remains. Corrections: hilo farm rate is **74.4%** (not ~90%, still farms achievements; no coin farm); stats bigint-zero impact is **≈29 KPIs**. Wave-1 chain 7 self-withdrew its ClaimBar finding mid-report. AGENTS.md doctrine adjudication: the thief's −cost having no feed row is **by design**, but coin-flow aggregates missing theft entirely is a real gap.

## Caveats
- Findings carry each agent's own `verified: yes|likely|no` flag; the P0/P1 list above is wave-5 verified. P2/P3 items marked (VERIFIED) were re-checked; the rest are honest leads with file:line to open before fixing.
- Nothing was executed against the DB; ACL claims are derived from migration-text tracing (two independent agents + wave-5 authoritative trace agree).
- No code, migrations, or settings were changed. Fixes should each get a timestamped changelog entry per AGENTS.md.
