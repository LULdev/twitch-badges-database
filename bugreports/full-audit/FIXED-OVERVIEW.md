# Full-project audit — what was fixed

Two hunt rounds over the whole project (client and server), ten collectors in
round one and three adversarial collectors in round two. Every claim was
re-verified against the code and, where it mattered, the live database before
being accepted; four claims were corrected or refuted rather than quietly
dropped (see `VERIFIED.md`). Nothing was implemented from a report alone.

Verification of the whole round: `lint` 0 errors, `tsc` clean, `next build`
exit 0 with **zero `MISSING_MESSAGE`**, a live route matrix of 40 URLs all 200
(the two 404s in the first sweep were wrong URLs in the smoke, not routes), and
targeted live checks of the analytics row count, the RSS link uniqueness and the
badge-detail Open Graph tags.

## Round 1 — 42 findings fixed

### Security and data integrity

| # | What was wrong | Fix |
|---|---|---|
| 1 | `acp_gate_attempt` executable by `anon`: the revoke named only anon/authenticated, so the PUBLIC default grant survived — anyone with the publishable key could reset the bootstrap brute-force counter | migration 0032 revokes from PUBLIC |
| 2 | `profile_visits` readable by `authenticated`, exposing `ip_hash` (one app-wide salt ⇒ comparable across the site) | 0032 |
| 3 | The badge-unlock reward farmable without limit (paid per `user_inventory` row, and `authenticated` held DELETE on it) | 0033 + `badge_unlock_rewards` claim |
| 4 | `push_subscriptions` writable by `anon`/`authenticated`, bypassing the route's SSRF validation and able to delete every anonymous subscription | 0033 |
| 5 | Leftover scratch script promoting a hardcoded account to `role='owner'` | deleted |
| 6 | Default `TRUNCATE`/`REFERENCES`/`TRIGGER`/`MAINTAIN` grants (TRUNCATE is not subject to RLS) | 0032 |
| 7 | Ineffective revokes on `vote_idea` / `sync_is_admin` / `protect_profile_columns` | 0032 |

### Application fixes

- Every notification link 404'd (stored `/en/…` re-prefixed by the locale-aware `Link`).
- The badgebase sweep demoted admin-authored `source='custom'` rows.
- **ProfileCustomizer wiped display name, bio and banner** and reverted the colour set.
- The three arcade switches disagreed (master flag, `features.games`).
- Five achievements unlocked from a client-reported score flag; a losing round stored it.
- Five achievements were unreachable or mis-firing (vault flag, 60-row window, release date, scatter truthiness, jackpot threshold).
- The steal race recheck hardcoded `> 6`; `k_night_owl`/`k_early_bird` read the wrong clock; the daily and wheel gates committed before `award()` (migration 0034 added the release functions).
- `/api/feed` ignored its feature flag; the analytics beacon wrote **two rows per page view**; the turbo slot's declared weight was 10× the drawn probability.
- `showcase_slots` accepted unowned slugs with no bound; "Sync inventory" reverted the display name; `perfil.normalize()` trusted a non-array `badges`; the GQL fallback dropped the cache window; visit dedup was a read-then-insert (migration 0035); `push/subscribe`'s ownership guard failed open; `sendPushToAll` read unpaged; `createFeaturePost` wrote a changelog row on every call; reaction buttons could not represent server state.
- Unpaged reads that silently truncated at PostgREST's 1000-row cap (`achievements.ts`, two syncs).
- `runBadgebaseSync` rewritten: proportional incident guard, confirmation derived from the listing (not the 45-card detail cap), `resolveStatus` everywhere, bulk upserts, honest `inserted`.
- Cron `/api/cron/global` returned 500 before the badgebase half, freezing the authoritative activity state for the day.
- The new-badge fan-out dropped lookup/insert errors and could push an empty slug.
- Catalogue: sort labels that disagreed with the query, zero-result filters showing the error card, a retry that could loop, no id tiebreak on 471 rows sharing one timestamp, array query params, `?sort=bogus` blanking the select, an unbounded `getCategories()`.
- SEO: no `og:type`/`og:url` on badge detail, Twitter cards showing the site title, one shared RSS `<link>`, `Product` JSON-LD without `offers`, "0 owners" beside a "—", OG font gate covering nine script groups.
- Client: Vault's "again" could double-charge, StealPanel showed hardcoded prices, the compare chip counted beyond the tiles drawn, an unlabelled error glyph, missing in-flight guards, click-only member rows, numeric fields coercing `""` to 0.
- i18n/a11y: 28 customizer option labels plus 3 placeholders were literals (36 new keys × 11 locales), RTL sign islands, `aria-current` on the header nav, the language switcher's focus/`disabled` conflict, a keyboard path for the Catcher game.

## Round 2 — the re-check (13 fixes)

- **HIGH: `/api/admin/users` applied the rank ladder only to the `role` action.** A moderator — admitted by `requireAdmin()` by design — could ban or delete an admin, rewrite a peer's profile/XP/coins, and grant achievements; and edit their own economy row up to the 1e12 clamp. The ladder now covers every mutating action (`unban` excepted).
- Sending a newsletter is restricted to admin+ (it mails every account).
- A DNT page view still wrote two analytics rows; the update is now keyed on the row id alone and scoped to the caller's visitor hash (which also closes a blind write to an arbitrary row).
- The beacon's row id is per effect, so a slow mount response from the previous page can no longer overwrite the current view's id.
- Saving a changelog entry no longer nulls its stored payload.
- A newsletter draft is released when delivery throws.
- The badgebase incident guard compares distinct confirmed badges against parsed cards (not rows against cards) — a unit mismatch could trip it on healthy data and, because the skip returns before the pass that clears the flag, stay tripped.
- The badgebase sweep consults both image sizes; the all-fetches-failed check runs before the changelog row.
- FilterBar renders a value absent from its option list as its own option instead of folding it to "All" while the query still filters on it.
- The explorer's two queries run concurrently again without sharing a failure.
- The admin user panel gained the in-flight guard (plus a same-tick ref), its numeric fields keep the previous value when emptied, the changelog id is validated, granting an achievement requires it to exist in the catalog, `/api/push/subscribe` honours bans, and a failed coin-rain award releases its daily gate.

## Known limits, stated honestly

- The migration-0035 `showcase_slots` CHECK has no data-normalisation pre-pass; it applied cleanly here (the single live profile row is valid), but a database carrying a non-array or over-length value would abort the migration. Already applied, so not editable.
- The badgebase rounding guard's remaining residual: a genuine >50% shrink of `/active` trips it and the skip keeps `is_confirmed_active` from being cleared. The like-for-like comparison removes the false-trip class; a real mass-expiry would still need an operator to look (the skip writes a changelog row and a degraded heartbeat, so it is visible).
- `og:url` resolves from `metadataBase`, which is `http://localhost:3000` in a local production run and the configured `NEXT_PUBLIC_SITE_URL` on Vercel.
- Lexical screening cannot prove an idea is not a rewording of an existing one; the brainstorm round screened with a rewording net and adjudicated its flags by hand.
