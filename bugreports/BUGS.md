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

## Coverage

Scopes audited first-party (the 20 planned sub-agent scopes):
auth flow · games client (13 games, 2 groups) · wheel/daily/coinrain · live feed ·
profile + steal + customizer · badge catalog UI · stats dashboard · i18n integrity ·
SEO/OG/RSS · api misc (progress, inventory sync, push, blog react, symbols) ·
cron/health · sync global+badgebase · sync potat+perfil · gamification core ·
games server · DB/RLS/migrations · security (secrets, authz, injection, spoofing) ·
UI shell/theme/a11y · misc pages (blog, changelog, faq, compare, leaderboards).