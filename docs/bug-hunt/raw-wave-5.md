# Bug Hunt — raw findings, Wave 5 (verification + integration lens) — 2026-10-06

## Chain 1 — API routes (3 fresh; 3 verified)
VERIFY: W2#4 admin/setup race CONFIRMED (23-31 check-then-act, no CAS); W3#1 fan-out duplication CONFIRMED (no advisory lock, no unique keys); W3#2 items/buy no nonce CONFIRMED.
1. api/track/route.ts:184-187 — [P2] mount beacons return int8 id as STRING; client guard `typeof === "number"` rejects → viewId never set → attach path dead → sessions >2min insert second row (total_hits double-count the id mechanism was built to remove). Number() it. (verified)
2. api/admin/sync/route.ts:51-60 — [P3] failed manual sync returns raw error.message to panel, no audit row on failure. (verified)
3. api/admin/users/route.ts:76-84 — [P3] non-UUID userId → PostgREST 22P02 → 500 instead of 400/404. (verified)
CLEARED: admin gates central; cookie parse solid; cron auth constant-time fails closed; newsletter CAS; retry semantics gated.

## Chain 2 — Game logic (1 fresh; 3 verified)
VERIFY: W2#1 hilo farm CONFIRMED with rate CORRECTED: exact 89×89 enumeration → 74.4% win (not ~90%), EV ≈0.942 (no coin farm) but streak/achievement farm (s_midas, k_hilo_10 ~67 rounds/attempt, k_cautious, c_win_*) stands; resolver boolean beats payout>bet at cs 6/7/93/94. W3#1 ghost rounds CONFIRMED (3 void sites console.warn). W3#3 void-window CONFIRMED (insert-latency skew >100ms voids legit 1Hz pair; nonce cleared → unreplayable).
1. games.ts:519-533 vs 109-119,263-273 — [P3] newPersonalBest computed only on live response; replay paths (retry/23505) return result without the flag → "new best" moment suppressed for the round that set it (view 0055 still records). Persist flag in result or recompute in replay. (verified)
CLEARED: coins<bet coercion fine; blackjack stopAt all negative-EV (earlier +0.30 was a sim bug); scratch 0.982; slots 0.164 (matches W1).

## Chain 3 — Economy core (2 fresh; 3 verified)
VERIFY: W3#1 thief −cost CONFIRMED with doctrine nuance — txRows = activity_events (thief feed row = gross on success), stealTx leg victim-only; AGENTS.md intends gross, but −cost reconciles NOWHERE and CoinFlowCard/stats_coin_flow_daily have ZERO theft coverage (both directions). W2#1 apply_pair_deltas P0 CONFIRMED (flood guards don't close window: racedPair per-victim >1, racedHour 2≤6). W3#3 badge_claim phantom rows CONFIRMED (retry toAdd=∅ forever).
1. achievements.ts:841 — [P3] level achievements read STORED progress.level while every other surface computes levelFromXp live; stored column never recomputed by admin xp-only edits → drift blocks/grants level achievements, skews steal chance. Compute in buildStats. (verified)
2. SettingsPanel.tsx:31-46 — [P4] gameStreakXpPerDay/gameStreakXpCap missing from ECONOMY_FIELDS (read at runtime games.ts:469-470) → no admin knob. (verified)
CLEARED: every AchStats input has a writer; all result flags written; routes auth→ban before mutation; settings keys all wired.

## Chain 4 — Catalog & badges (3 fresh; 3 verified)
VERIFY: W2#1 BadgeCard "—" CONFIRMED (bigint strings, zero Number() mapping). W3#2 momentum baseline floor CONFIRMED (0002:32, no lower bound). W3#4 revalidateTag CONFIRMED zero callers (5-min self-revalidate bounds it).
1. syncs/potat.ts:168-190 — [P2] owners-feed failure/miss feeds computeRarity with raw string/null owner_count → fallback-derived rarity_score/rarity_tier UPSERTED over the whole catalog (comments claim stored counts are kept). Number() + skip recompute when !ownersOk. (verified)
2. queries.ts:791-798 — [P3] getRecapClicks7d `number|null` vs bigint string → blog weekly-recap KPI ungrouped. (verified)
3. MarketMap.tsx:66-80 — [P3] log10(Math.max(0,"1500")+1) string-concat → misplotted dots; latent (SHOW_MARKET_MAP=false). (verified)
NEGATIVE: no crash paths in null-date consumers; withdrawn W4#6 confirmed non-defect.

## Chain 5 — Syncs & external services (6 fresh; 3 verified)
VERIFY: W1#1 valuesChanged always-true CONFIRMED (number vs bigint-string operands). W3#5 momentum 1000-cap CONFIRMED. W4#2 distribution empty-ok CONFIRMED (heartbeat stays green, zero writes).
1. syncs/global.ts:278-285 — [P2] removal-sweep uuid exemption applies to ALL rows, not just badgebase-sourced → superseded versions never retired (stale 'active' + duplicate live rows forever). Gate on source. (verified)
2. syncs/global.ts:255-259 — [P2] resurrected badges (back in feed) get status patched but NO badge_events row ('restocked' exists in constraint) → timeline ends on stale 'removed'. Emit restocked. (verified)
3. api/cron/global:29 + scripts/sync-global.ts:7 + sync-potat.ts:7 — [P3] withHeartbeat without summarize → payload NULL for the largest engine; scripts write source "sync/*" not "manual/*" → operator run masks failed daily cron on uptime view. (verified)
4. arcade-highlights.ts:116-124 + blog.ts:257-278 — [P3] recap winner selected by gross payout but headline claims "+net" → a payout1000/bet999 beats net+900; won round with payout<bet renders "+-N". Select by payout−bet. (verified)
5. blog.ts:257-262 — [P4] game_rounds bet/payout bigint strings → toLocaleString no-op in recap sentence. (verified)
6. syncs/potat.ts:162-164,296-299 — [P3] byUuid fallback version-agnostic, last-writer-wins map → stats points attach to wrong version when versions share artwork. (verified logic)

## Chain 6 — SQL & migrations (AUTHORITATIVE)
A) PUBLIC-EXECUTE LIST (traced all 31 create sites, 6 drops, 60 grant/revoke stmts): exactly 3 functions anon-executable — game_streak_gate (final 0050:9; forges/resets streaks, burns/earns freezes), grant_starter_items (final 0049:29; mints freezes for any uuid), purchase_item (final 0059:15; negative/zero p_price = coin minting, feed flood). All grantees = PUBLIC + service_role. MISSED: none. handle_new_user closed 0020; acp_gate_attempt closed 0032; search_path pinned everywhere; other 22 functions service_role-only; player_record_history/record_break_leaders anon+auth read-only.
B) REVOKE-WITHOUT-REGRANT VERDICTS: zero `grant execute` in any migration names release_daily_gate, release_wheel_gate, acp_gate_attempt, vote_idea → ALL FOUR DEAD (42501 every call): gate release dead (failed award burns gate forever, catch only console.warns), ACP bootstrap dead on fresh install, idea votes dead. 0037 default-privileges only strips anon/authenticated, never PUBLIC → covers nothing; service_role never needed 0037 (PUBLIC covered all roles).
C) NEW FINDINGS (2, both P3, verified):
1. 0037:63,68(+75) — [P3] 0037's comment/changelog FALSELY claim objects "start from nothing" — only anon/auth stripped, PUBLIC default EXECUTE survives → causal chain behind the entire P0 cluster (authors of 0047-0059 believed the one-sided revoke sufficed). Fix default privileges + comment.
2. 0059:89 (+0049:58,132; 0052:61; 0053:65) — [P3] schema-wide `revoke ... on all functions from anon, authenticated` SILENTLY DESTROYS the 0056:39/0058:50 anon grants on player_record_history/record_break_leaders — those surfaces work today ONLY because PUBLIC default EXECUTE was never revoked on them. Fixing the P0 via blanket PUBLIC revoke would 42501 the profile best-rounds card, recap breaks, and ?period= leaderboard. Per-function revokes required.
NEGATIVES: no grants to nonexistent roles; trigger ACLs preserved; maintenance_mode fully removed; 0063/0064 consistent.

## Chain 7 — Client components (4 fresh; 3 verified)
VERIFY: W3#4 UsersPanel drawer hijack CONFIRMED (172-174 stale closure, token overwritten). W3#1 FeedList reorder CONFIRMED (no in-flight guard, [...fresh,...prev]). W4#1 zero onError CONFIRMED (grep).
1. AdminShell.tsx:86-95 — [P3] every tab switch UNMOUNTS the panel → search state AND UNSAVED EDITS (half-written blog draft, role fields) lost on one tab click. Keep mounted with hidden or lift state. (verified)
2. WheelOfFortune.tsx:288-290 — [P3] network drop after server awarded → failWith(networkError) → day's spin consumed, win never shown, re-spin says already-spun. Re-check /api/progress before re-arming. (likely)
3. Header.tsx:227-264 — [P4] mobile hamburger no Esc/outside-click (user menu has both). (verified)
4. StealPanel.tsx:41-52 — [P4] gate errors carry no code in some paths → raw English "not authenticated"/"banned" renders, contradicting own comment. (verified)

## Chain 8 — Stats dashboard (3 fresh; 3 verified)
VERIFY: W1#1 CONFIRMED (impact corrected: ≈24 KPIs zero, not ~15). W1#2 CONFIRMED (5 visitors KPIs; hints survive only via Intl coercion). W2#4 offset-paging double-count CONFIRMED in basis (winning needs concurrent insert in fetch window).
1. api/cron/global:124-139 (+potat/badgebase) + stats.ts:274-278 — [P2] cron writers collapse failures to "degraded" (never "error") and serviceStatus escalates only on "error"/staleness → failed week reads "All systems operational" headline. Count degraded or write error. (verified)
2. status/page.tsx:44-52,746-756 — [P3] STATUS_LAYOUT_PREVIEW flip silently changes production default layout for ALL visitors (default resolves "a" instead of owner-chosen "d"). (verified)
3. status/page.tsx:230-261,301-305 — [P3] calendar/48h strip aggregate ALL sources incl. per-minute web probe (~1440 rows/day) → one failed web probe turns a day red under 100% pipeline gauges. Exclude source='web'. (verified)

## Chain 9 — Pages & i18n (3 fresh; 3 verified)
VERIFY: W4#1 proxy mixed-case CONFIRMED (full chain /EN/faq → /de/EN/faq → 404). W2#1 inventory >100% CONFIRMED. W2#2 profile double-decode REFUTED as stated (guarded try/catch → 404 not 500; canonical drift latent only).
1. [locale]/admin/page.tsx:37-44 — [P3] banned staff: viewerRole returns role, requireAdmin throws uncaught → error boundary 500 instead of forbidden card. (verified)
2. src/lib/admin.ts:79-81 — [P3] bootstrap passcode salt+digest COMMITTED; 5-digit space → offline HMAC recovery in ms → any repo reader mints owner session on any unclaimed install. Secret salt via env. (verified mechanism)
3. messages/*.json ×11 — [P4] 24 dead keys (×11 locales ≈264 strings): common.filters/activeUsers/apply, badges.activeCount/channelBadge/ends/firstSeen/ownerCount/rarityScore/started/released/ownersHeadline/howToEarnUnknown, games.rank1-8, errors.dbError, compare.neither, badgeHowTo.methodLabel. (verified)

## Chain 10 — Infra, scripts & libs (4 fresh; 3 verified)
VERIFY: W3#2 seo localhost fallback CONFIRMED (envOrNull silent null; prod var set → happy path safe; missing-var deploy = silent localhost canonicals). W4#3 sitemap Invalid Date CONFIRMED (Next serializer toISOString on truthy Invalid Date → RangeError → sitemap 500). W4#1 markdown code-span order CONFIRMED.
1. markdown.ts:70 — [P3] `![alt](url)` image syntax renders as literal "!" + link (blog articles with images break). (verified)
2. queries.ts:827-836 — [P3] listPosts() unpaginated → PostgREST 1000-row cap → blog prev/next/related silently truncate once ~1yr of auto posts. Page it. (verified mechanism)
3. changelog.ts:36-42,56-64 — [P3] logChange/logChanges no kind/risk/payload validation + swallow errors → invalid value silently drops row; one bad row drops ENTIRE batch. (verified)
4. supabase/server.ts:14 — [P3] cookie@1.1.1 keeps FIRST of duplicate cookie names → after domain change stale+fresh supabase-auth-token both sent = oldest wins (stale session). Latent. (verified mechanism)
CLEARED: admin client per-call (no singleton issue); createDropPost/FeaturePost idempotency; isoWeek math; RSS pubDate; changelog indexes.

WAVE 5 TOTAL: 31 fresh findings + 30 verification verdicts (29 CONFIRMED, 1 REFUTED-partial; 2 corrections: hilo 74.4%, stats impact ~24 KPIs)
