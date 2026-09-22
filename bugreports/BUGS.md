# Bug report — Twitch Badges Database

Audit date: 2026-09-22. Scope: full client + server surface (20 planned scopes, see
"Coverage" at the bottom). Every entry below was reproduced or proven from the code;
false positives that were investigated and dismissed are listed separately so nobody
re-checks them.

Note on method: the planned 20 parallel sub-agents could not be launched (the platform
returned "model concurrency limit exceeded" / "exceed quota limit" on every attempt,
including a single sequential agent). The identical scopes were therefore executed
first-party with the same evidence standard, and the automated audits are checked in
under `bugreports/*.mjs` so the results are reproducible.

---

## B1 — Nine locales render ~90 English strings (untranslated namespaces)

- **Severity**: high (user-visible for 9 of 11 languages)
- **Side**: client
- **File**: `messages/{es,fr,pt,it,ru,zh,ja,ko,ar}.json`
- **Evidence**: `node bugreports/audit-untranslated.mjs` →
  `es identical=121 prose(>=4 words)=90`, same for fr/pt/it/ru/zh/ja/ko/ar.
  Per-namespace: `faq:40 games:25 customizer:13 wheel:4 steal:3 feed:2 achievements:2 profile:1`.
- **Why it is a bug**: the site advertises 11 languages, but the gamification, FAQ and
  profile-customizer UI is English in those locales. Example: `es steal.success =
  "Heist successful: +{BadgesCoins} BadgesCoins!"`, `es wheel.already = "You already
  spun today — come back tomorrow!"`. Only `de` was kept in sync (2 leftovers, both
  legitimate brand names).
- **Confidence**: confirmed
- **Fix direction**: translate the listed keys in the 9 locales; keep brand names
  (BadgesCoins, XP, game titles) as-is.

## B2 — `profiles` UPDATE policy allows writing protected columns (privilege escalation latent)

- **Severity**: high (security)
- **Side**: server (database)
- **File**: `supabase/migrations/0001_init.sql:340` (`profiles_self_update`)
- **Evidence**: policy is `for update using (auth.uid() = id) with check (auth.uid() = id)`
  — no column restriction — and the grant section only revokes
  `delete, insert on public.profiles` (line 380): UPDATE stays granted to `authenticated`.
  The table defines `is_admin boolean not null default false` (line 131), plus
  `view_count`, `twitch_id`.
- **Why it is a bug**: any logged-in user can bypass our `/api/account` whitelist and
  `PATCH /rest/v1/profiles?id=eq.<own-id>` with `{"is_admin":true}`,
  `{"view_count":99999}` or `{"twitch_id":"<someone else>"}`. `is_admin` is currently
  unused (latent escalation), but `view_count`/`twitch_id` are immediately abusable —
  view_count feeds the public profile counter, twitch_id feeds inventory/compare
  identity matching.
- **Confidence**: confirmed (code + grants)
- **Fix direction**: BEFORE UPDATE trigger that restores protected columns
  (`id`, `is_admin`, `view_count`, `twitch_id`) whenever `auth.uid()` is not null,
  i.e. for any non-service-role write.

## B3 — Client-spoofable IP: `x-forwarded-for` first entry is trusted

- **Severity**: medium (security / data integrity)
- **Side**: server
- **File**: `src/lib/gamification/session.ts:22` and `:33`
- **Evidence**: `const ip = forwarded.split(",")[0]?.trim() || …`
- **Why it is a bug**: proxies append to `x-forwarded-for`, they do not replace it, so
  the leftmost value is whatever the client sent. Sending
  `X-Forwarded-For: 1.2.3.4` produces `1.2.3.4, <real ip>` and `[0]` picks the fake one.
  With a fresh value per request an attacker bypasses: the 5-minute view-counter dedup
  (`visits.ts`), the 1-per-24h coin-rain gate (`daily.ts`), and the 1-per-IP blog
  reaction rule (`/api/blog/react`) — and can pad a profile's "latest visitors".
  `x-real-ip` (set by Vercel) is only used as a fallback and is never preferred.
- **Confidence**: confirmed
- **Fix direction**: prefer `x-real-ip`, else the **last** non-empty entry of
  `x-forwarded-for`; hash the same way.

## B4 — JSON-LD injected without escaping `<`

- **Severity**: medium (security / markup integrity)
- **Side**: client (server-rendered)
- **File**: `src/app/[locale]/badges/[slug]/page.tsx:105`,
  `src/app/[locale]/blog/[slug]/page.tsx:87`, `src/app/[locale]/faq/page.tsx:70`
- **Evidence**: `dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}`
  (audit flags `escaped=false` for all three).
- **Why it is a bug**: badge titles/descriptions come from external sources (Twitch
  Helix / curated listing). A title containing `</script><script>…` terminates the
  JSON-LD block early and injects arbitrary markup into the page. FAQ/blog values are
  DB-editorial but the same mechanism applies.
- **Confidence**: confirmed
- **Fix direction**: serialize with `<`, `>`, `&`, U+2028/2029 escaped (`\u003c` …)
  before injection.

## B5 — `coinRain`: lost update on `coins` + unvalidated `profileId`

- **Severity**: medium (economy integrity)
- **Side**: server
- **File**: `src/lib/gamification/daily.ts` (`coinRain`), `src/app/api/coinrain/route.ts`
- **Evidence**: `const owner = await getProgress(profileOwnerId); await supabase
  .from("user_progress").update({ coins: owner.coins + 1 })`
- **Why it is a bug**: (a) read-modify-write — if the owner receives XP/coins between
  the read and the write (any concurrent game/wheel/daily award), their balance is
  overwritten with the stale value (+1), silently destroying the other award.
  (b) `body.profileId` is never checked against `profiles`; a random UUID reaches
  `getProgress()`, which upserts `user_progress.user_id` — the FK rejects it and the
  route 500s instead of answering 400. (c) `todayStr` is computed and unused.
- **Confidence**: confirmed
- **Fix direction**: single atomic `UPDATE … SET coins = coins + 1` via RPC/`.rpc()` or
  an `UPDATE … coins = coins + 1` expression; validate the profile exists first.

## B6 — `recordProfileVisit`: lost update on `view_count`

- **Severity**: medium (data integrity)
- **Side**: server
- **File**: `src/lib/gamification/visits.ts:29-34`
- **Evidence**: `select view_count` → `update({ view_count: (profile?.view_count ?? 0) + 1 })`
- **Why it is a bug**: identical read-modify-write race — two visitors inside the same
  window lose one increment; the public counter under-reports permanently.
- **Confidence**: confirmed
- **Fix direction**: atomic increment expression.

## B7 — `attemptSteal`: LIKE wildcards in the victim lookup

- **Severity**: medium (security / correctness)
- **Side**: server
- **File**: `src/lib/gamification/daily.ts` (`attemptSteal`)
- **Evidence**: `.ilike("username", victimUsername.trim())`
- **Why it is a bug**: the input is used as a LIKE pattern. `%` or `_` act as
  wildcards: `"_"` matches any single-char username, `"%b%"` matches any username
  containing "b" — so a crafted request can target a victim the attacker did not name,
  and `maybeSingle()` then errors ("multiple rows returned") for broader patterns.
  Usernames are lowercased at creation (`handle_new_user`), so case-insensitive
  matching is not needed.
- **Confidence**: confirmed
- **Fix direction**: escape `%`/`_`/`\` in the pattern, or compare against
  `username` with `eq(lowercased)`.

## B8 — `DELETE /api/push/subscribe` deletes any endpoint (no ownership check)

- **Severity**: low (security hygiene)
- **Side**: server
- **File**: `src/app/api/push/subscribe/route.ts` (DELETE handler)
- **Evidence**: `.delete().eq("endpoint", endpoint)` through the **admin** client, and
  the authenticated `user` is fetched then explicitly discarded (`void user;`).
- **Why it is a bug**: the admin client bypasses the `push_self_delete` RLS policy that
  the anon client would have enforced, so the ownership check the schema defines is
  never applied. Anyone who obtains another browser's endpoint URL (log/history/referrer
  leakage) can silently unsubscribe them from badge push notifications.
- **Confidence**: confirmed (code) — exploit requires the endpoint URL, hence low.
- **Fix direction**: when a user is present, constrain the delete to
  `user_id = user.id`; only allow endpoint-wide deletes for anonymous rows
  (`user_id is null`).

## B9 — `alert()` for push failures

- **Severity**: low (UX)
- **Side**: client
- **File**: `src/components/PushToggle.tsx:63`, `:86`
- **Evidence**: `alert(t("pushFailed"))`
- **Why it is a bug**: blocking native dialog that ignores the design system, is not
  dismissible by keyboard on some platforms, and is inconsistent with the inline error
  pattern used elsewhere (TwitchLoginButton). The user sees a raw browser popup on a
  premium-styled page.
- **Confidence**: confirmed
- **Fix direction**: render an inline status/error line like the login button.

## B10 — Systemic read-modify-write on XP/coins in `award()` / `adjustCoins()`

- **Severity**: low-medium (economy integrity, systemic)
- **Side**: server
- **File**: `src/lib/gamification/xp.ts` (`award`, `adjustCoins`)
- **Evidence**: `const current = await getProgress(userId)` … then
  `.upsert({ ...current, ...patch })` with `patch.xp = current.xp + xpAwarded`.
- **Why it is a bug**: the same lost-update class as B5/B6 at the centre of the XP
  economy. Two concurrent awards for one user (e.g. playing a game while a wheel spin
  resolves, or two games in parallel from two tabs) both read the same base and the
  second write discards the first award's XP and coins. The 1-round/second flood check
  is per game insert and does not serialise the progress update.
- **Confidence**: confirmed (code); impact scales with concurrency
- **Fix direction**: atomic `xp = xp + $n` / `coins = coins + $n` updates (SQL RPC or
  PostgREST column expressions) instead of writing absolute values.

---

## Investigated and dismissed (do not re-check)

| Candidate | Verdict |
|---|---|
| `/api/games/play` accepting `NaN` bet | Safe — `playGame` does `Math.floor` then `Number.isFinite` check |
| Admin/service-role module reachable from client components | None: 42 client components checked, no direct or transitive path to `supabase/admin` |
| `renderMarkdown()` output in `dangerouslySetInnerHTML` | Safe — escapes `& < > "` before applying inline formatting |
| `/api/games/symbols` fetch in Slots/Shoot/Catcher | Has `.catch(() => undefined)` |
| `.single()` misuse in queries | No occurrences anywhere in `src/` |
| FAQ dynamic keys (`${key}Q`/`${key}A`) | All 21 `FAQ_KEYS` pairs exist in all 11 locales |
| `RARITY_TIERS` / feed kinds / achievement categories dynamic keys | All resolve in every locale |
| i18n key identity across locales | 650 keys, all 11 files identical |
| RLS coverage | Every table has RLS; all catalog/content tables revoke insert/update/delete from anon+authenticated |
| `playGame` bet bounds / flood check / balance check | Present and correct |
| `attemptSteal` self-steal, opt-out, price, flood checks | Present and correct |
| `SlotsGame` interval cleanup | Cleared in the effect return |
| 8 `setTimeout` sites flagged as "no clearTimeout" | One-shot kickoff/state-flush timers; no leak (React 19 tolerates the post-unmount call) |

## Second pass — one further bug (found while re-auditing the fixes)

## B12 — `getProfileByUsername` used the URL segment as a LIKE pattern

- **Severity**: medium
- **Side**: server
- **File**: `src/lib/queries.ts:360`
- **Evidence**: `.ilike("username", username)` with the raw path segment.
- **Why it is a bug**: same class as B7 but on the profile route — a `%` in the
  URL matches an arbitrary profile, and multiple matches make `maybeSingle()`
  error so the page 404s instead of rendering.
- **Confidence**: confirmed
- **Fix direction**: escape `\`, `%`, `_` (applied).

A third pass (`bugreports/audit-static.mjs`, `audit-i18n.mjs`, plus greps for
`process.env[`, `.ilike(`, `alert(`, `dangerouslySetInnerHTML` and
timer/cleanup mismatches) produced no further findings.

## Third pass — three more defects, found by re-reading the fix sites

## B13 — `playGame` still wrote the coin balance as read-modify-write

- **Severity**: high (currency corruption)
- **Side**: server
- **File**: `src/lib/gamification/games.ts` (round settlement)
- **Evidence**: `.update({ … games_played: progress.games_played + 1, coins:
  Math.max(0, progress.coins + net) })` where `progress` was read before the
  round resolved.
- **Why it is a bug**: the same class as B10 but on the coin balance itself —
  a round settling while any other award lands overwrites the balance with the
  stale value, destroying the other award (and the round's own counters).
  The 1-round/second flood check does not serialise the settlement.
- **Confidence**: confirmed
- **Fix direction**: `bump_counters` for the counters + `bumpCoins` for the
  balance (applied).

## B14 — Counter columns written as read-modify-write

- **Severity**: medium
- **Side**: server
- **File**: `games.ts`, `daily.ts` (steal), `wheel.ts`, `achievements.ts`
- **Evidence**: every counter update computed `field + delta` from a value read
  earlier in the request.
- **Why it is a bug**: overlapping writes lose one increment, so a collector's
  statistics drift below reality permanently.
- **Confidence**: confirmed
- **Fix direction**: migration 0007 adds `bump_counters(uuid, jsonb)`; all
  callers use it (applied).

## B15 — The once-per-day gates were check-then-write

- **Severity**: high (reward duplication)
- **Side**: server
- **File**: `daily.ts` (`claimDaily`), `wheel.ts` (`spinWheel`), `xp.ts` (game XP cap)
- **Evidence**: e.g. `if (progress.last_login_date === todayStr) return …` then a
  separate `update({ last_login_date: todayStr })`; the wheel and the 100 XP/day
  cap followed the same shape.
- **Why it is a bug**: two parallel requests both read "not claimed yet" and both
  proceed, so the daily bonus and the spin could be collected twice, and the
  daily game-XP budget could be spent twice (200 XP instead of 100).
- **Confidence**: confirmed
- **Fix direction**: migration 0007 adds `claim_daily_gate` and
  `claim_wheel_gate` (compare-and-set on the date column, exactly one caller
  wins) and `consume_game_xp` (`SELECT … FOR UPDATE`, so the budget is shared
  correctly); the module-level date checks are gone.

## Fourth pass — nothing new

Re-ran the static, i18n and grep audits after the 0007 work plus the full
concurrency suite: **16/16 assertions pass**
(`scripts/verify-atomic-economy.ts`), including five concurrent counter bumps
landing exactly, the daily and wheel gates producing exactly one winner under
`Promise.all`, and the game-XP budget being capped at exactly 100.

This pass also covered the SEO/content scope that pass 3 had only skimmed, with
live evidence instead of file reading:

| Endpoint | Result |
|---|---|
| `/sitemap.xml` | HTTP 200, 5 610 `<url>` entries, 1 210 hreflang links, parses as well-formed XML |
| `/robots.txt` | HTTP 200, allows `/`, disallows `/api/`, `/*/account`, `/*/inventory`, `/*/auth/`, links the sitemap |
| `/api/changelog/rss` | HTTP 200, 100 items, well-formed XML, no unescaped `&`, valid RFC-822 `pubDate`, stable `guids` |
| `/api/og/profile?u=<user>` | HTTP 200, 130 KB `image/png` |
| `/api/og/profile` (missing/invalid param) | HTTP 400 `invalid username` — the guard works |

Two initial "findings" here were mistakes in the probe itself, not defects, and
are recorded so nobody re-raises them: the OG route takes `?u=` (not
`?username=`), and `grep '</item>'` under Git Bash reports 0 for an RSS file the
XML parser reads as 100 well-formed items.

### On the sub-agent requirement

The 20 audit sub-agents and 10 idea sub-agents were attempted **14 times** in
this session — first as a wave of ten in parallel, then repeatedly as single
sequential agents, including after the runtime reported a quota reset. Every
attempt was rejected by the platform with `model concurrency limit exceeded` or
`exceed quota limit`; no agent ever started. The scopes were therefore executed
first-party, and this report plus `IMPROVEMENTS.md` are the substitutes. If the
quota recovers, the agent prompts are reconstructable from the scope list at the
end of this file.

## What was fixed

| Bug | Status | Evidence |
|---|---|---|
| B1 translation gaps | fixed | 2081 strings across 9 locales; gap audit 111 → 22, all remaining verified as legitimate word coincidences (fr "Notifications"/"Total"/"badges", it "Database") |
| B2 profile column escalation | fixed | migration 0006 trigger; grants unchanged |
| B3 IP spoofing | fixed | `x-real-ip` first, last forwarded entry as fallback |
| B4 JSON-LD escaping | fixed | `src/lib/jsonld.ts`, used by 3 pages |
| B5 coinRain lost update + bad id | fixed | atomic `add_coins`, profile existence check |
| B6 view_count lost update | fixed | atomic `bump_view_count` |
| B7 LIKE wildcards (steal) | fixed | escaped pattern |
| B8 push delete ownership | fixed | query constrained by `user_id` |
| B9 `alert()` in PushToggle | fixed | inline `role="alert"` message |
| B10 award() lost update | fixed | atomic `apply_xp_coins`; verified by `scripts/verify-atomic-economy.ts` (two parallel awards sum correctly, 5 concurrent view bumps = +5, account restored exactly) |
| B11 broken `{BadgesCoins}` placeholder | fixed | `{coins}` restored in all 11 locales |
| B12 LIKE wildcards (profile route) | fixed | escaped pattern |
| B13 playGame coin balance | fixed | `bumpCoins` for the balance, `bump_counters` for the statistics |
| B14 counter columns | fixed | migration 0007 `bump_counters`; 5 concurrent bumps verified = +5 |
| B15 daily gates + XP cap | fixed | `claim_daily_gate` / `claim_wheel_gate` / `consume_game_xp`; verified exactly one winner and a hard 100 XP cap |
| vendor-named message keys | fixed | `profile.potatLevel/potatoes/potatSince` renamed to `communityLevel/communityPoints/communitySince` in all 11 locales (database columns and their sync untouched) |

### Known residual, deliberately not changed

- 22 translation entries equal their English value because the target word is
  the same (French "Notifications", "Total", "badges"; Italian "Account",
  "Database"). Verified individually, not gaps.
- The **database columns** `potat_level`, `potatoes` and `potat_first_seen`
  keep their names: they are data plumbing owned by the sync functions, and the
  instruction was to remove public *text* only. Their rendered labels are
  neutral.
- The changelog keeps its historical entries naming a vendor, because it is an
  append-only log of what happened; only user-facing pages were cleaned.

## Coverage

Scopes audited first-party (the 20 planned sub-agent scopes):
auth flow · games client (13 games, 2 groups) · wheel/daily/coinrain · live feed ·
profile + steal + customizer · badge catalog UI · stats dashboard · i18n integrity ·
SEO/OG/RSS · api misc (progress, inventory sync, push, blog react, symbols) ·
cron/health · sync global+badgebase · sync potat+perfil · gamification core ·
games server · DB/RLS/migrations · security (secrets, authz, injection, spoofing) ·
UI shell/theme/a11y · misc pages (blog, changelog, faq, compare, leaderboards).