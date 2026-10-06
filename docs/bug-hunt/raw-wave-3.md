# Bug Hunt — raw findings, Wave 3 (concurrency & economy-invariants lens) — 2026-10-06

## Chain 1 — API routes (3)
1. src/lib/syncs/global.ts:350-515 (cron/global:33, admin/sync:43) — [P2] new-badge fan-out NOT idempotent: overlapping runGlobalSync runs → duplicate badge_events 'added', duplicate changelog 'New badge', duplicate notifications rows (no unique key, 0001:262), SECOND push blast to all subscribers; only createDropPost deduped. Partial unique index or pg_advisory_xact_lock. (verified)
2. src/app/api/items/buy/route.ts:10-25 + items.ts:17-46 — [P2] buy endpoint takes only {item}, no nonce → retry/double-click buys 2 freezes for 2× price (purchase_item atomic per call, no idempotency key). Mirror 0063 nonce. (verified)
3. src/lib/syncs/badgebase.ts:466-485 — [P3] "Drop-window listing sync completed" changelog row written on EVERY run incl. no-ops; engine runs twice each morning (cron/global + GH 06:05) → duplicate changelog rows. (verified)
CLEARED: /api/feed keyset cursor safe; progress/claim gates CAS; wheel/daily/steal/coinrain CAS-gated; archive skips dups; global strips potat columns.

## Chain 2 — Game logic (7)
1. games.ts:301-307,329-337,347-355 — [P2] void paths swallow DELETE error (console.warn only) → transient pooler failure leaves UNSETTLED ghost round forever (counts in streaks, maxBet, stats views, anon-visible phantom win). Throw or settled-flag + purge. (verified)
2. games.ts:102-119,256-273 — [P2] no "settled" notion: serverless kill between insert and recheck → idempotent path replays ok:true forever (no coins/XP ever); 23505 loser can replay a row later voided+deleted by a third round. Replays only for rows past void window / settled marker. (verified)
3. games.ts:81,285-310 — [P2] recheck/void window measured in INSERT-time distance → a legit ≥1s click is voided whenever prev request inserted >100ms later (cold start/pooler stall); nonce freed on ok:false → round silently unrecoverable. (verified)
4. games.ts:214-219 vs 81 — [P3] pre-check mixes app clock + DB clock at hard 1000ms, no slack; DB clock 100ms ahead permanently rejects legit 1Hz rounds. (likely)
5. games.ts:285-310 — [P3] both-survive burst: insert-latency skew lets 2 rounds <1s apart both settle; code admits atomic second-trunc guard absent. Unique partial index on (user_id, date_trunc('second', created_at)). (likely)
6. games.ts:603-625 + achievements.ts:103 — [P3] streak flags graded from 10-row snapshot before concurrent siblings insert → durable false streak5/streak10 unlock claims. (likely)
7. PinguGame.tsx:152-205 + useGame.tsx:61-77 — [P3] client truth beats server: writeBest() commits local meters even on ok:false; lost response replays previous throw's verdict in RoundOutcome. (verified)
CLEARED: bump_counters atomic (0007); gate single-advance; watermark fails open; big_win garnish post-recheck; 23505 winner deterministic.

## Chain 3 — Economy core (7)
1. daily.ts:337 + inventory/page.tsx:245 — [P2] successful steal: thief's −cost appears in NO ledger surface (feed row = gross loot only; steal_attempts union leg reads victim_id only) — violates AGENTS.md ledger doctrine "thief's net mirrored". Thief-side union leg or net feed row. (verified)
2. inventory/page.tsx:149-152,299-345 — [P2] big-win rows double-count in merged transaction list: txRows leg (all activity_events incl. big_win coinsAmount=net) + roundRows leg (payout−bet) → 15× slots win shows TWICE. Exclude one leg. (verified)
3. inventory.ts:139-148,149-174 — [P2] sync reward failure: badge_claim feed rows (500c) written BEFORE award(); award throws → phantom feed rows stay, coins never moved, user_inventory already committed → retry computes toAdd=∅, reward lost forever. (verified)
4. xp.ts:356-362,502-511 — [P3] 2s AWARD_PROGRESS_TTL: two overlapping awards share cached snapshot → duplicate/false level_up rows (no deltas lost). (verified)
5. visits.ts:52-58 — [P3] bump_view_count fails after profile_visits insert → returns false, dedup row stays → counter permanently short. Delete row on bump error. (verified)
6. visits.ts:34,90 — [P3] fixed-grid dedup bucket boundary race (4:59.9 vs 5:00.1) → both count. date_bin or document. (verified)
7. daily.ts:217 — [P3] stealable=0 victim → Math.max(1,…) mints 1-coin loot exceeding 10% cap. (verified)

## Chain 4 — Catalog & badges (5)
1. BadgeReactions.tsx:34-64 + api/badges/react:45-62 — [P2] non-atomic select→delete/insert toggle, two tabs diverge ±1 permanently; route ignores delete error (W1) so client decrements a count DB kept. Atomic toggle RPC + refetch. (verified)
2. queries.ts:426-436 — [P2] badge_momentum growth baseline `polled_at <= now()-20h` has NO freshness floor → quiet syncs make "24h growth" cumulative → momentum term ratchets stored rarity_score. Floor 48h else neutral. (verified)
3. queries.ts:294 — [P3] offset pagination drifts under concurrent sync inserts (page 2 repeats page 1 tail). Keyset on (first_seen_at, id). (verified)
4. queries.ts:590-687,934-1014 — [P3] unstable_cache tags "catalog"/"home" have NO revalidateTag callers anywhere → stale removed badge serves 5-min windows (dead card → 404). revalidateTag at sync end. (verified)
5. BadgeCard.tsx:88-91 + [slug]:380-438 — [P3] stored status stale between end_date passing and next sweep → "Live" chip above zeroed countdown, /active keeps expired badge, ending-soon sorts past dates first. Derive at render. (verified)

## Chain 5 — Syncs & external services (7)
1. global.ts:350-515 (+ admin/sync:41-46) — [P2] same as chain1#1: no advisory lock anywhere; duplicates listed. (verified)
2. potat.ts:262-269,327-331 — [P2] concurrent potat runs both insert duplicate badge_stats points (no unique (badge_id,polled_at) for measured rows, 0041:23-26); :07 offset can't stop lagged GH run; workflow concurrency group only GitHub-vs-GitHub. (verified)
3. potat.ts:192-203,240-253 — [P3] potat writes derived status on every row from stale snapshot → badgebase confirmation between read and write gets overwritten to 'expired' for up to an hour. (verified)
4. badgebase.ts:302-329 + types.ts:75-81 — [P2] insert-slug collision (`${slug}-v1` vs normalized set_id) → uncovered 23505 aborts whole 200-row chunk deterministically, permanent failure loop. (likely)
5. potat.ts:127-129 — [P3] badge_momentum read un-paged → PostgREST 1000-row silent cap → long tail gets neutral momentum. Page it. (likely)
6. badgebase.ts:334-405 — [P3] pass-2 sweep on stale start-of-run snapshot under concurrent runs → confirmed badge demoted until next run. Re-read flag or .eq guard. (verified)
7. global.ts:485-514 — [P3] push block fires on !isInitialSeed even when freshRows empty/fanoutError → "N new badges" push with nothing; badge_events rows permanently lost (no repair pass). (verified)

## Chain 6 — SQL & migrations (4) — P1 cluster
1. 0034_release_failed_gates.sql:56-59 — [P1] release_daily_gate/release_wheel_gate revoked from PUBLIC+anon+authenticated, NEVER granted to service_role → every release call fails 42501, catch console.warns → gate release is DEAD since 0034; failed award burns gate forever (the exact bug 0034 was written to fix). Grant EXECUTE to service_role. (verified)
2. 0032_db_hardening.sql:20-21 — [P1] acp_gate_attempt revoke-only, no service_role grant → gateAttempt errors, admin/auth returns 503 → bootstrap door dead on fresh install (ACP unreachable forever). (verified)
3. 0032_db_hardening.sql:22-23 — [P1] vote_idea same → every idea-board vote 42501/500 since 0032. (verified)
4. 0015:28,36 — [P3] apply_pair_deltas clamp asymmetry (extends W2 P0): victim-side clamp while thief receives full stale-read loot → bounded creation in read-RPC window. (likely)
CLEARED: claim gates CAS/locked; purchase_item locked+predicates; grant_starter_items CAS; game_streak_gate locked; 0035/0063 race indexes; 0006-0041 grants complete.

## Chain 7 — Client components (7)
1. FeedList.tsx:51-71 — [P2] overlapping 5s polls no AbortController → slow request A prepends older events above newer B → out-of-order feed. (verified)
2. admin/AuditPanel:39-57, BadgesPanel:75-92, BrainstormPanel:39-55, ContentPanel:114-133 — [P2] debounced list loads no stale-response guard → slow A overwrites list for invisible filter. (verified)
3. admin/UsersPanel.tsx:93-119 — [P2] same list race on biggest panel (query "a" lands after "ab"). (verified)
4. admin/UsersPanel.tsx:150-185 — [P2] act() re-opens drawer from closure → overwrites detailRequest token protecting another row → operator can edit WRONG user. (verified)
5. LiveRefresher.tsx:14-21 — [P3] interval fire-and-forget → overlapping router.refresh() deliver stale RSC after fresh. (verified)
6. LanguageHint.tsx:38-47 — [P3] no storage listener → dismissing chip in tab A leaves it in tab B. (verified)
7. ThemeToggle.tsx:12-31 — [P3] no storage listener → cross-tab theme stale, last-writer-wins. (verified)
CLEARED: EmojiReactions/BadgeReactions non-optimistic; wheel-spun server-side; StrictMode-safe except flagged; intervals cleaned.

## Chain 8 — Stats dashboard (4)
1. stats.ts:274-278 — [P3] ageMinutes can go negative on future-dated last_at → 36h/120min stale branches never fire; dead pipeline reports operational. Clamp + NaN→stale. (verified logic; latent — no future-dating writer today)
2. 0004:134,262,272,309-324 + 0025:141 vs clients — [P3] daily/hourly buckets group in DB session TZ while client windows hardcoded UTC; only 0054:35 pins UTC. Add at time zone 'utc' to remaining views. (verified; aligns today on Supabase default)
3. stats.ts:238-241 + 0004:283-305 vs page.tsx:402-437 — [P3] 'degraded' counted as failure in gauges but NOT in stats_uptime_daily.errors → calendar red cell with zero-failure tooltip. Pick one definition. (verified; latent — statusOf has no live caller)
4. stats.ts:316-338 — [P3] 18 parallel safe reads = 18 MVCC snapshots → mid-sync dashboard composites disagree. Harmless/transient. (verified)

## Chain 9 — Pages & i18n (4)
1. leaderboards/page.tsx:145 (+ getMostOwnedBadges) — [P2] "Most owned" renders "—" for every count (same int8-string class, distinct surface). (verified)
2. [locale]/page.tsx:226, games/page.tsx:189, games/[game]/page.tsx:265-299 — [P3] big-win amounts `::numeric` → STRING → "1500".toLocaleString no-op → ungrouped on home strip/hub ticker/podium. Number() first. (verified)
3. messages/ru.json:1607 — [P4] stepWatchTimeHours missing `few` plural → "2 часов" instead of "2 часа". (verified)
4. TwitchLoginButton.tsx:28 — [P3] OAuth redirectTo has no locale → geo-fallback visitors lose their locale at login (proxy re-negotiates callback). Seed NEXT_LOCALE first. (likely)
CLEARED: auth callback startedRef survives StrictMode; no session-page caching hole (layout request-dynamic); no notifications read-marking; wheel anon clean JSON; FeedList dedup safe; LanguageSwitcher guarded.

## Chain 10 — Infra, scripts & libs (4)
1. potat.ts:262-269 + cron/potat — [P2] = chain5#2 duplicate badge_stats (dedupe in report).
2. src/lib/seo.ts:5 — [P2] siteUrl() falls back to http://localhost:3000 when NEXT_PUBLIC_SITE_URL missing → ALL canonicals/og:url/sitemaps/RSS self-point to localhost with no error. Assert in prod. (verified)
3. push.ts:50-62 — [P3] offset pagination over push_subscriptions; concurrent prune/subscribe shifts windows → subscribers silently skipped/double-read. Keyset. (likely)
4. api/og/profile/route.tsx:74-91 — [P3] loadSubsetFont caches FAILED resolutions as null for up to 32 evictions → tofu persists after connectivity returns. Don't cache nulls. (verified)
CLEARED: changelog id tiebreak exists; no markdown cache; no import cycles; all workflows have concurrency groups; .btn+sizing sites intended.

WAVE 3 TOTAL: 51 unique findings after dedupe (P1×3, P2×15, P3×32, P4×1)
