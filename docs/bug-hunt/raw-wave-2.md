# Bug Hunt — raw findings, Wave 2 (security & authorization lens) — 2026-10-06

## Chain 1 — API routes (5)
1. src/app/api/push/subscribe/route.ts:8-27,73 — [P3] endpoint allowlist blocks IP literals/localhost but not wildcard-DNS/DV-cert hosts → blind SSRF from Vercel runtime via webpush.sendNotification on every broadcast. Pin push-service hosts. (likely)
2. src/app/api/push/subscribe/route.ts:108-119 — [P3] no per-caller cap on subscription rows → table inflation, sendPushToAll fan-out degradation; fake 200-answering endpoints live forever. Cap per user/IP. (verified)
3. src/app/api/track/route.ts:161-187 — [P3] anonymous beacon: no rate limit or dedup → unbounded analytics_events inserts, poisons public /stats totals. (verified)
4. src/app/api/admin/setup/route.ts:73-83 — [P3] owner registration no compare-and-set → concurrent POSTs both promote their profile to owner permanently; settings doc records only winner. Atomic registration needed. (verified)
5. src/app/api/badges/react/route.ts:31-62 + blog/react:31-64 — [P3] one-key-per-IP bounds rows not request rate → scripted toggle flood = unbounded DB writes; NAT cross-user interference. Add cooldown. (likely)
NEGATIVE: authz gates consistently applied; no IDOR session spoofs; no secrets in responses; acp RPCs revoked per 0032.

## Chain 2 — Game logic (3)
1. src/lib/gamification/games.ts:803-825 (+231-232) — [P2] hilo keeps won:true on every correct call incl. net-0/negative EV-priced payouts → always-higher-side strategy wins ~90%, farmable: s_midas (2500XP+1000c), k_hilo_10, k_cautious, c_win_* for ~33 coins cost. Grade on payout > bet. (verified via simulation)
2. games.ts:342-357 + api/games/play:34-35 — [P3] settlement failure → round deleted, HTML 500, client keeps nonce → retry settles brand-new round charging bet again; counters never rolled back. Keep row or JSON error + reset nonce. (verified)
3. games.ts:805-819 — [P3] 6/94 edge "impossible side" refund = free round still counts games_played + 2 XP + streak + roundsToday → farmable for day-caps (k_marathon_day). Skip counters on payout===bet refunds. (verified)
NEGATIVE: bet sanitization solid; nonce replay single-settle (0063); parallel same-user races voided; no feed-row spoofing (activity_events no INSERT policy); skill inputs clamped.

## Chain 3 — Economy core (4)
1. src/lib/gamification/daily.ts:275-280 + 0015_pair_deltas:29-42 — [P0] apply_pair_deltas clamps each side independently, no cross-side affordability check + thief tooPoor is a separate pre-read → two PARALLEL steals vs 2 alt victims with balance in [price, 2·price) mints ≈price per pair (~10k max), sustainable by rotating alts (6/h). One guarded UPDATE checking coins >= -p_a_delta. (verified)
2. wheel.ts:115-139 + daily.ts:62-78 — [P2] at-least-once double-pay: award() error after commit releases gate → retry re-pays; gate RPC error outside try/catch strands gate (day lost). Gate+award in one transaction or claim nonce. (likely)
3. daily.ts:402 + api/coinrain:12-13 — [P3] logged-out self-rain: giverId null bypasses owner-self check → +1 coin/day/IP farmable. (verified)
4. api/admin/settings/route.ts:72 — [P3] economy settings written verbatim, no write-path validation; latent direct-reader hazard; 0 accepted silently. (latent)

## Chain 4 — Catalog & badges (8)
1. src/components/badges/BadgeCard.tsx:17-22 — [P1] owner_count/active_count bigint strings + non-coercing Number.isFinite → EVERY badge tile renders "—" for owners. Number() or widen BadgeRow. (verified)
2. [slug]/page.tsx:282-285 + MomentumReadout.tsx:25 + rarity.ts:65,75 — [P2] stats-history points strings → trend never renders; momentum chip permanently "—"; wear/scarcity fall back to defaults. (verified)
3. [slug]/page.tsx:397-398,703-709 — [P3] external click_url/source_url into <a href> raw — data:/protocol-relative pass; how-to-get.ts has isTwitchUrl but page doesn't. (verified)
4. queries.ts:196-200,225-237 — [P3] whitespace-only ?q= hard-empties grid instead of full catalog. (verified)
5. queries.ts:196-200 — [P3] `_` and `\` survive ilike sanitize → wildcard matching. Escape like getProfileByUsername:724-730. (verified)
6. queries.ts:403-411 — [P3] getBadgeEvents no id tiebreak. (verified)
7. Countdown.tsx:47-67 — [P3] NaN date → permanent "NaN:NaN:NaN" timer. Number.isFinite gate. (verified)
8. how-to-get.ts:154-167 — [P3] watchMinutes regex misses "1h"/"90 mins" variants. (likely)
NEGATIVE: jsonLdScript escapes </script>; FAQ/HowTo escaped; img src inert; .eq/.or parameterized; rightmost x-forwarded-for.

## Chain 5 — Syncs & external services (6)
1. src/lib/twitch/badgebase.ts:101-104,211,227 (+syncs/badgebase.ts:306,313) — [P2] upstream HTML entities stored raw, never decoded → "Cats &amp; Dogs" renders literally; RSS double-escapes; meta regex truncates descriptions containing `"`. (verified; data-integrity not XSS)
2. src/lib/blog.ts:72,80 + markdown.ts:47-62 — [P3] upstream text linkified in blog markdown with ANY http(s) host allowed → hostile upstream injects outbound links into drop posts; page-side restricts to twitch.tv. (verified; no XSS)
3. src/lib/syncs/global.ts:122-136,271-286,533-555 — [P2] removal-sweep guard blind band 51-99% → truncated feed silently sweeps up to half the catalog to 'removed' with permanent history rows; badgebase pass-2 doesn't resurrect non-active removed rows. Tighten ratio / 2-consecutive-absences. (verified)
4. src/lib/twitch/helix.ts:23-49 — [P3] no in-flight token dedup; stale cached token never invalidated on 401 → whole run silently downgrades to IVR. (likely)
5. src/lib/twitch/types.ts:119-129 — [P3] resolveStatus: NaN dates → comparisons false → resolves 'active', never expires (potat/global re-derive with same hazard). (verified logic, no live trigger)
6. src/lib/twitch/potat.ts:91-94,118-121 — [P3] hasNextPage:true with falsy cursor silently ends loop → partial list reads healthy, badges stale forever. (unconfirmed)

## Chain 6 — SQL & migrations (10) — HIGHEST SEVERITY
1-7. [P0 ×7] PUBLIC default EXECUTE survives on SECURITY DEFINER economy RPCs — anon-callable via /rest/v1/rpc:
- 0047_game_streak_bonus.sql:62 — game_streak_gate: forge/reset any player's streak, burn freezes (search_path pinned, still callable)
- 0049_streak_freeze.sql:58 — grant_starter_items: mint 2 freezes for any uuid (profiles.id anon-readable)
- 0049_streak_freeze.sql:132 — DROP+recreate game_streak_gate, revoke only anon/authenticated → PUBLIC re-armed
- 0050_gate_return_fix.sql:9 — create or replace, NO revoke at all
- 0052_purchase_item.sql:61 — purchase_item: caller-supplied p_price → NEGATIVE price MINTS UNLIMITED COINS for any profile uuid; arbitrary p_item_key floods feed (0059:79-80)
- 0053_purchase_item_out_names.sql:65 — DROP+recreate, same one-sided revoke
- 0059_purchase_feed_log.sql:89 — DROP+recreate, same → whole 0047-0059 chain anon-callable TODAY
Fix: `revoke all on function public.<fn>(...) from public;` after each (doctrine 0032:20, 0019 precedent). (all verified: PG default ACL + 0037:64-68 + 0041:181-187)
8. 0046_analytics_ref.sql:18 — [P1] stats_analytics_recap_refs view: default SELECT to anon/authenticated survived → raw recap-click paths (incl. /xx/profile/<username>) readable by anyone; 0048 claims protected. revoke from anon. (verified)
9. 0047_game_streak_bonus.sql:14 — [P3] add constraint without drop-first → replay aborts 42710. (verified)
10. 0001_init.sql:179 — [P2] handle_new_user check-then-insert username race → concurrent signup aborts auth.users insert. (verified)
NEGATIVE: duplicate 0041 benign for supabase ledger; 0056/0058 PUBLIC-execute read-only harmless; user_items/badge_reactions/coin_rain_gate RLS closed.

## Chain 7 — Client components (4)
1. Countdown.tsx:47-62 — [P2] NaN target → live "NaN:NaN:NaN" role=timer forever. (verified)
2. AnalyticsBeacon.tsx:80-92 — [P3] onHide vs in-flight mount send → second visit row (double-count pageviews). inFlightId promise. (likely)
3. WheelOfFortune.tsx:250-258 — [P3] unknown slot id → segmentIndex 0, pointer parks xp25, wonIndex -1 → highlight contradicts result card. (verified)
4. DailyClaim.tsx:13, CoinRainButton.tsx:12, SyncButton.tsx:21, AccountSettings.tsx:62, ProfileCustomizer.tsx:155, StealPanel.tsx:26 — [P3] same busy-guard class as W1 NewsletterPanel: no if(busy) return/ref guard → same-tick double dispatch on 6 mutating handlers. (verified pattern)
NEGATIVE: markdown pipeline sanitized; sw.js no fetch handler; intervals cleaned; no dangerouslySetInnerHTML beyond static.

## Chain 8 — Stats dashboard (6)
1. stats.ts:579-585 — [P3] getUptimeSnapshot recap/freeze fields raw bigint strings → /status ungrouped numbers. (verified)
2. stats/page.tsx:1172-1178 + health.ts:80-85 + cron routes — [P3] public uptime table renders raw sync-failure error text (PGRST internals) 40 chars + full in tooltip. Sanitize at write. (verified)
3. 0058_record_break_leaders_period.sql:44 — [P3] record_break_leaders(p_days) EXECUTE-granted anon, no bounds → p_days=2147483647 interval overflow error; heavy full-table scan per call. Guard p_days. (verified)
4. CoinFlowCard.tsx:24-39 — [P3] offset pagination under concurrent inserts → rows fetched twice → earned/spent double-counted. Keyset pagination. (likely)
5. stats.ts:269-278 — [P3] serviceStatus 120-min staleness gate vs GH cron lag → public pill flaps "degraded" on 2 consecutive GH misses. (likely)
6. stats.ts:363-368 — [P3] hero lastUpdate includes minutely web probe → always "seconds ago" even when pipeline dead. Anchor to pipelineSources. (verified)
NEGATIVE: heartbeat ACL 0043 holds; ref allowlist solid; daySeries UTC-consistent; div-by-zero guarded; ?period validated at page.

## Chain 9 — Pages & i18n (5)
1. [locale]/inventory/page.tsx:112-113,386,398 — [P2] owned% unclamped: ownedIds includes expired/removed vs active-only denominator → ">100% (156%)" text vs 100% bar. (verified)
2. [locale]/profile/[username]/page.tsx:52-82,162,215-217 — [P3] username decoded TWICE in body, once in metadata → canonical disagrees; malformed % throws URIError (500) instead of 404. (verified)
3. [locale]/login/page.tsx:6-14 + auth/callback — [P3] no per-page metadata → canonical points to home; callback indexable. (verified)
4. [locale]/notifications/page.tsx:14-19 — [P3] protocol-relative //host enters local-path branch → off-site Link; latent (trusted writers only). (verified)
5. src/proxy.ts:106 — [P3] case-sensitive startsWith("/api") — /API treated as page; latent. (verified)
NEGATIVE: no open redirect in OAuth; PKCE Supabase-managed; NEXT_LOCALE lax non-sensitive; /admin server-gated; markdown/JSON-LD escaped; messages 11/11 parity.

## Chain 10 — Infra, scripts & libs (3)
1. scripts/import-backlog-ideas.ts:59-63 — [P3] literal 0x08 backspace bytes where \b intended → NARROW_OVERRIDES can never match → misclassification resurrected. (verified; only file with 0x08)
2. next.config.ts:7-20 — [P3] no CSP/HSTS headers anywhere. (verified)
3. scripts/code-health.ts:159,183-186 — [P3] allowlist bare-name entries exempt same name in ANY file; PR can silently neuter dead-code gate. Scope to file:name. (verified)
NEGATIVE: no secrets in tracked files; workflows don't echo secrets; check-locale no injection; markdown scheme sanitization sound; OG font cache safe; send-push/W1 items owned.

WAVE 2 TOTAL: 54 findings (P0×8 [7 SQL grants + 1 theft race], P1×2, P2×10, P3×34)
