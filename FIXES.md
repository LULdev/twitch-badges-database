# What was fixed — the full overview

Compiled 2026-09-22 from the `changelog` table itself (258 rows: 65 `bugfix`,
16 `feature`, 33 `data_sync`, 139 `blog`, 1 `badge_added`, 4 `badge_updated`),
the twenty audit reports in `bugreports/agent-01..20*.md`, the ten idea reports
`agent-idea-01..10.md`, and the verification reports `verify-*.md`. Each round
also has its own section in `bugreports/AGENT-AUDIT.md` with the per-finding
evidence, and a timestamped entry in the changelog (`/changelog`, RSS at
`/api/changelog/rss`).

Nothing in this file is aspirational: every item below is shipped and either
re-verified by a script, by a live probe, or by a second agent.

---

## 1. Auth and session

| Defect | Fix |
|---|---|
| The Twitch login button did nothing — the OAuth start aborted silently | repaired callback path; hard `window.location.replace` after the exchange, because the client router cache kept replaying the logged-out layout |
| The header still showed the login link after a successful login | same as above (two separate root causes were needed) |
| Token refresh was dropped on `/api` paths, so a rotated refresh token was lost and the session died silently | the proxy refreshes for `/api` too, and skips entirely without a session cookie |
| Double cookie refresh; refreshed cookies were not on the forwarded request | refresh runs before the response is built and the collected cookies are written onto it, so the same request's render sees them — one `getUser()` per request |
| `signOut()` defaulted to global scope, logging the user out of every device | `scope: "local"` |
| OAuth `error`/`error_description` params were ignored → the generic "no code" page | the provider's message is surfaced with a retry link |
| Push subscription could be taken over anonymously | takeover refused (409) |

## 2. Security and privacy

| Defect | Fix |
|---|---|
| `profiles` had no column restriction, so any user could set `is_admin`, `view_count`, `twitch_id` by direct PATCH | migration 0006 trigger `profiles_protect_columns` |
| The economy RPCs were callable by `anon`/`authenticated` over PostgREST | migration 0008 revokes EXECUTE from PUBLIC and both roles; live check returns 401 |
| `x-forwarded-for` was read left-to-right (the client-controlled entry) | prefer `x-real-ip`, else the last forwarded entry |
| JSON-LD was injected with raw `JSON.stringify` | `src/lib/jsonld.ts` escapes it |
| LIKE wildcards were unescaped in the steal and profile lookups (`%` matched an arbitrary victim) | escaped |
| `/api/feed` exposed every user's `user_id` and raw `payload` | both removed |
| The profile visitor list was public | owner-only, read through the user's own client |
| Push endpoints were fetched server-side with no validation (SSRF/flooding) | public HTTPS only, no internal host or IP literal, length-capped |
| The coin-rain gate could be farmed: the dedup compared a payload value that was only ever written as `"anonymous"` against the visitor's IP hash, so logged-out visitors had an unbounded faucet | migration 0014 `coin_rain_gate`, primary key `(owner_id, giver_key, day)` — a true compare-and-set, RLS on and no policy, so the IP hash stays out of the public-read `activity_events` |
| The public profile read exposed `twitch_id` | column-level SELECT grants; live: `select=id,twitch_id` → 401 |
| `blog_views`/`blog_reactions` had no SELECT policy at all, which is why the blog page bypassed RLS | migration 0011 adds public-read policies **and** column-level grants; `ip_hash` stays unreadable (live 401) |

## 3. Economy correctness and atomicity

| Defect | Fix |
|---|---|
| Read-modify-write lost updates on `xp`, `coins`, `view_count` | atomic SQL RPCs (`apply_xp_coins`, `add_coins`, `bump_view_count`, `bump_counters`, the daily/wheel gates) |
| `award()` upserted a full row from a pre-RPC snapshot, reverting counters, gates and timestamps and re-opening daily gates | only the derived `level` is written |
| `getProgress()` swallowed read errors, returned a zeroed row, and `award()` wrote those zeros back — wiping the account | errors propagate |
| A failed owners fetch wrote `null` over all 471 `owner_count` values and still reported a healthy heartbeat | existing counts kept, failure recorded, `ownersFeedOk` reported |
| An empty provider response cleared the user's whole inventory | the sync aborts instead of deleting |
| A parallelism burst could farm coins through the coin-rain gate | atomic gate (see §2) |
| A parallel burst could play two rounds per second | an optimistic post-insert guard voids the racer's own round before any coins, XP or counters move |
| Counter failures sat between the two coin moves of a steal, leaving a half-applied non-zero-sum transfer plus a 5-minute lockout | both coin moves first, then both counters; a counter problem is logged, not thrown |

## 4. Game economy (client fraud)

Five skill games paid a multiplier of a **client-supplied** score, the vault paid
`[0,.5,1.5,3][clientMatches]` (guaranteed 3× at three matches), scratch paid 20×
on a ~12.6 % event, and tower's cash-out at level 1 was +EV. All outcomes now run
through a server-side win-chance model with a ceiling of 0.90 EV.

**Proof, re-run by me after every later change:** `scripts/verify-game-economy.ts`
plays 200 000 rounds per game with a cheating payload — **13/13 games below the
stake**, worst hilo 0.9873. `scripts/verify-atomic-economy.ts` passes **16/16**
(two parallel awards sum exactly, five concurrent view bumps = +5, the snapshot
restore is exact).

## 5. Data pipeline and syncs

| Defect | Fix |
|---|---|
| Running the global sync twice created duplicate `added` events and up to ten bogus blog posts per run | only the slugs inserted by this run are fanned out |
| The removal sweep deleted badgebase-inserted badges whose slug differed from the Twitch `set_id`, and badgebase never repaired a `removed` row | the sweep matches the image UUID too; a `/active` row is restored out of `removed` |
| `data-reset` (badgebase's reset widget) was mistaken for a badge end date — all 38 values were identical | the real window comes from JSON-LD `temporalCoverage` |
| Two distribution rows resolving to the same catalog row aborted the whole sync (Postgres 21000) | batches deduplicated by `set_id:version` |
| A page-cap truncation was silent | it throws, and the distribution feed now fails **before any write**, with the provider's reason |
| No third-party fetch had a timeout | 15 s `AbortSignal` everywhere (verified by scan: none lacks one) |
| A stale date was never cleared when upstream stopped publishing it | cleared — but only when the detail page actually loaded |
| A total detail outage looked like a healthy run | it fails the heartbeat |

## 6. Catalog, pages and SEO

Live badges without an end date vanished from `/active`; `?page=9999` was a dead
end; a transient DB error published a 404 for a valid badge; the NEW marker had
no lower bound; the related-badges section listed unrelated badges under "same
category"; the empty changelog filter claimed the whole changelog was empty; the
quiz page rendered a header and then nothing; eleven pages all declared the
homepage as their canonical; the sitemap used raw locale codes and `new
Date()` as `lastModified` and missed 18 routes — now 5 808 URLs with correct
`pt-BR`/`zh-Hans`/x-default alternates; the 13 MB ranking fetch bypassed the
cache on every render.

## 7. Internationalisation

2081 strings were missing in nine locales (gamification, FAQ, customizer). Two
thousand eighty-one translations were added; the language switch dropped the
query string; `formatCompact` and nine components hardcoded `en`, so ten locales
showed English numbers; the uptime calendar formatted UTC midnight in the local
zone and showed the previous day; three message keys were later added for the new
error boundary. All 11 locale files are verified **key-identical** (675 keys) by a
flat-key diff, and the build is grepped for `MISSING_MESSAGE`.

## 8. Accessibility and UI

| Defect | Fix |
|---|---|
| The account menu never closed on outside click or Escape | closes on both; `aria-haspopup` corrected |
| Filter chips exposed no selected state, and both groups shared one label | `aria-pressed` + distinct group labels in all 11 locales |
| Badge tile images repeated the visible title in the same link | decorative `alt=""` at all seven sites |
| Podium colours were literals with no light-mode override (silver ≈ 1.35:1 on white) | `--rank-*` tokens with darker light values |
| The three sparkle shapes were solid white and vanished on white surfaces | themed `--sparkle` token |
| Intro animations are physical, so RTL ran them from the wrong edge | `[dir="rtl"]` overrides for the bars, the sheen and the row keyframe |
| Level badges all shared one SVG gradient id | per-level id |
| The 13-item nav overflowed between 1024 and 1375 px while the hamburger was hidden | the nav switches at 1280 px |
| Emoji glyphs were used as UI icons, against the project convention | inline-SVG `GameIcon` set (13 games + wheel) |
| Share links caused a hydration mismatch on every page | resolved after mount |
| Relative times in the feed caused a hydration mismatch | rendered after mount |

## 9. Infrastructure and cron

Migration ledger runs each migration and its ledger row in **one transaction**; the
global cron returns **207** for a partial run instead of a misleading 200 and
reports `badgebaseFailed` from an explicit flag rather than from truthiness; the
heartbeat retention prune runs on both the success and the failure path; the cron
secret comparison is constant-time (`src/lib/cron-auth.ts`); `/api/health` writes
at most one heartbeat row per minute instead of one per request; migration 0001
refuses to re-apply once the catalog holds rows, and 0003 is re-runnable.

---

## Verification gates, current state

```
npm run lint        → 0 errors (7 warnings, all pre-existing)
npm run typecheck   → 0
npm run build       → 227/227 pages, 0 MISSING_MESSAGE
verify-atomic-economy.ts → 16/16 ALL CHECKS PASSED
verify-game-economy.ts   → 13/13 games below the stake (worst 0.9842)
locale parity       → 675 keys x 11 locales, identical
live smoke          → 132/132 routes across 11 locales
vendor-text scan    → 0 of 132 rendered pages name a provider
```

## Idea collection

`IMPROVEMENTS.md` holds 10 optimisation areas, 50 first-party feature ideas and
121 ideas from the ten idea sub-agents — **171 in total**, with a per-report
index.

## The defect that mattered most (found last)

The global sync wrote existing badges back as `{ ...ex, ...patch }` — the whole
row. PostgREST takes the **union** of the keys across a batch and fills missing
columns with NULL, so a new badge batched together with an existing one received
`id = NULL` (and, once `id` was dropped from the payload, `slug = NULL` on the
existing row instead). The consequence: **new badges could not be inserted at
all**, so the catalog could never grow, and every run containing both a new and
an existing badge failed. It stayed invisible until the first genuine new badge
appeared after the seed run, because insert-only and update-only runs both work.

Fixed by writing new and existing badges in separate upserts, and sending the
existing row without its `id`, so every row in a batch carries the same key set.
Verified by a real run: `added 1` (`Rematch Blue Lock`), `updated 27`,
`removed 0`, catalog 475 → 476; the detail page is live and the badge is
searchable.

## Open, deliberately

These are documented rather than fixed, and none is a defect in the narrow sense:

1. ~~`fp-3`~~ — **fully closed.** All ~35 settings in `profiles.customization`
   are applied on the public profile: the five visibility toggles, both cosmetics,
   the layout and typography set (font, cardStyle, radius, density,
   showcaseLayout grid/row/carousel, profileTheme, accent2, title, socials) and
   all fifteen creative effects (aura, particles, nameRainbow, bannerShine,
   tilt3d, pixelAvatar, achievementTicker, greetingBanner, levelHalo,
   cursorBadge, statusBubble, effectsIntensity off/subtle/full, coinRainAuto,
   visitorMarquee). Defaults mirror the customizer's own DEFAULTS, colours are
   hex-validated, usernames sanitised, `prefers-reduced-motion` disables all
   animation, and every default-true effect (banner shine, greeting, ticker)
   therefore now shows on profiles that never set it — by the customizer's
   definition. Verified live against a real profile with a 22-value test
   document, then restored.
2. ~~Daily XP-budget refund~~ — **closed.** Migration 0017 adds
   `consume_and_apply_game_xp`, which clamps the cap and applies the XP and coins
   in one statement under the same row lock. Verified in a rolled-back
   transaction: 80 granted, then 20 of a 100 budget, xp +100, coins +5, anon 401.
   (Migration 0018 fixed an ambiguity I introduced in 0017: the OUT columns were
   named `xp`/`coins`, colliding with the table's columns, so every call raised
   42702.)
3. **19 historical `blog_views` rows** with the pre-fix duplicates. The counter is
   display-only; existing production data was left untouched rather than
   deleted unasked.
4. **0012's validating CHECKs** run against pre-existing rows, so an environment
   holding a legacy oversized blob would block that migration. It applied
   cleanly here (one profile, `{}`) and is already applied.
5. ~~`apply_pair_deltas` runtime proof~~ — **closed**: the agent reached the
   database over port 6543 and the test passes (zero-sum, clamping to 0, missing
   row NULL, service-role `[{a_coins,b_coins}]`, `anon` 401; the CHECK accepts
   8/36/40/`"anonymous"`/128 and rejects 0/7/129).
6. **One client nit left**: a real 3-D card flip in the memory game is a design
   task, not a defect. The RTL arrows and the language listbox
   (`aria-activedescendant` on the element owning `role="listbox"`, focus moved
   into the panel) are both done.