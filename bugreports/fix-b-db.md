# fix-agent B — db/RLS/API fixes

Date: 2026-09-22. Scope: `supabase/migrations/**`, `src/lib/queries.ts`, `src/app/api/**`.
Verified each claim in the code before changing anything. `npx tsc --noEmit` → 0,
`npx eslint` on every changed TS file → 0. Migrations applied with `npm run db:apply`
(only 0012 then 0013 were pending; 0001–0011 were already in the ledger and were NOT
re-run).

Summary: **6 fixed, 1 extra fixed (R8-4), 1 verified/refuted (db-3), 4 additional
findings from the coordinator addressed (ind-3, ind-4, pdat-5 route half, pdat-7).**
Migration applied: **yes** (0012 + 0013).

---

## db-7 — 0001 could wipe all data on an accidental replay

- **File**: `supabase/migrations/0001_init.sql:9-27` (new guard preamble, before the `drop table ... cascade` block at lines 29+).
- **Old behaviour**: an unconditional `drop table if exists ... cascade` covering the live tables. The `supabase_migrations` ledger normally skips applied files, but a lost ledger, a hand-run `psql` replay or `supabase db push` at the wrong project would execute it and cascade away badges, profiles, inventory and — through the FKs 0003 adds — every XP/coin/level row.
- **New behaviour**: the file now refuses to run when the catalog already holds rows:
  ```sql
  do $$ begin
    if to_regclass('public.badges') is not null then
      if exists (select 1 from public.badges limit 1) then
        raise exception 'Refusing to re-apply 0001_init.sql: public.badges already holds % row(s). ...',
          (select count(*) from public.badges);
      end if;
    end if;
  end $$;
  ```
  A genuinely fresh database has no `public.badges`, so the first apply is unaffected. The ledger is untouched (not weakened).
- **Why the old code was wrong**: the only protection was one process's bookkeeping; the destructive statement itself had no precondition.
- **Verification** (read-only — 0001 was NOT executed, per instructions): the guard predicate was evaluated live:
  `badges_exists=true, badge_rows=475, guard_would_raise=true` — a replay would abort before any drop.
- **Files touched**: `supabase/migrations/0001_init.sql`.

## db-6 — 0003 was not re-runnable

- **File**: `supabase/migrations/0003_gamification.sql:161-195` (policies), `:208-224` (seed insert).
- **Old behaviour**: every table is `create table if not exists` (re-runnable intent), but the ten policies were bare `create policy`; a second apply aborted at the first with `policy "progress_public_read" ... already exists`, leaving the grants and the rest of the file unapplied. The launch changelog insert duplicated on replay.
- **New behaviour**: `drop policy if exists "<name>" on public.<table>;` before each of the ten `create policy` statements, and the changelog seed is now `insert ... select ... where not exists (...)` so a replay is a no-op.
- **Verification**: 0003's SQL was replayed inside a transaction that was then rolled back (no change persisted):
  ```
  REPLAY-0003 ran clean; launch entries visible in tx = 1 (must be 1, i.e. no duplicate)
  user_progress policies in tx = 1
  ROLLBACK OK (no changes persisted)
  ```
- **Files touched**: `supabase/migrations/0003_gamification.sql`.

## sec-4 / fp-11 — `customization` was stored raw and unbounded

- **Files**: `src/app/api/account/route.ts:51-82` (write path), `supabase/migrations/0012_customization_bounds.sql` (DB backstop).
- **Old behaviour**: `if (body.customization && typeof body.customization === "object") patch.customization = body.customization;` — an array passed, and any size passed verbatim into the public-read `jsonb` column, re-parsed on every profile read.
- **New behaviour**: the write path requires a plain object (arrays/null rejected), ≤ 64 keys, and ≤ 4096 serialized characters, else `400`. Migration 0012 adds `profiles_customization_object` (`jsonb_typeof = 'object'`) and `profiles_customization_size` (`octet_length(customization::text) <= 16384`) as a backstop for non-app writers. The 16384-byte DB bound is deliberately looser than 4096 JS string length (UTF-16 units vs UTF-8 bytes).
- **Preserved fields**: every field `ProfileCustomizer` reads is retained. The allowlist was *not* narrowed to the current 35 keys on purpose: `ProfileCustomizer` lives in `src/components/` (another agent's scope) and an object/size bound fixes the finding without risking silently stripping a key added there later. `Object.keys(customization).length` (achievements.ts) still sees the app's keys.
- **Verification**: `db:apply` output and live constraint read:
  ```
  Applying 0012_customization_bounds.sql ...
  NOTICE: constraint "profiles_customization_object" of relation "profiles" does not exist, skipping
  NOTICE: constraint "profiles_customization_size" of relation "profiles" does not exist, skipping
  OK 0012_customization_bounds.sql
  ```
  ```
  CONSTRAINTS [{"conname":"profiles_customization_object","def":"CHECK ((jsonb_typeof(customization) = 'object'::text))"},
               {"conname":"profiles_customization_size","def":"CHECK ((octet_length((customization)::text) <= 16384))"}]
  CHANGELOG  [{"kind":"bugfix","title":"Profile customization document is now bounded in size and shape"}]
  SHAPE      [{"arr_type":"array","obj_type":"object","big_len":20009}]   # array ≠ object → rejected; a 20 KB payload exceeds 16384
  ```
- **Files touched**: `src/app/api/account/route.ts`, `supabase/migrations/0012_customization_bounds.sql`.

## db-3 — `select("*")` on `profiles` exposing `twitch_id`/`potat_connections`

- **Status: already fixed; verified, no change made (not a remaining bug).**
- `getProfileByUsername` (`src/lib/queries.ts:402-407`) selects the explicit `PROFILE_PUBLIC_COLUMNS` (which omits `twitch_id`). A repo-wide grep for `from("profiles")` shows every other read is an explicit projection: `layout.tsx` (`username, avatar_url`), `account/page.tsx`, `inventory/page.tsx`, `api/inventory/sync/route.ts`, `visits.ts`, `daily.ts`, `xp.ts`, `achievements.ts`. **No `select("*")` on `profiles` exists anywhere.** 0009/0010 already grant SELECT per column and exclude `twitch_id`.
- **Note**: generic `select("*")` remains on `badges`/`blog_posts`/`changelog`/etc. — those tables are intentionally public-read and expose no identity data; out of scope for db-3.

## R8-4 — 0011 omitted `notify pgrst, 'reload schema';`

- **New behaviour**: 0012 and 0013 each end with `notify pgrst, 'reload schema';`.
- **Is a follow-up for 0011 needed?** No. A `NOTIFY pgrst, 'reload schema'` invalidates the whole schema cache, and 0012 (applied after 0011) already re-loads it, so 0011's policies are visible. Verified live that PostgREST accepts the 0011-backed reads (unchanged behaviour) and the 0012/0013 objects resolve. No separate migration recommended.
- **Files touched**: `supabase/migrations/0012_customization_bounds.sql`, `supabase/migrations/0013_catalog_aggregates.sql`.

## ind-3 — profile OG card rendered Arabic/CJK names as blank boxes

- **File**: `src/app/api/og/profile/route.tsx:6-93`.
- **Old behaviour**: no `fonts` option, so `@vercel/og` used its bundled `Geist-Regular.ttf` (Latin only) for every `displayName`. Arabic/Hebrew/CJK/Hangul/Thai/Devanagari names rendered empty.
- **New behaviour**: `SCRIPT_FAMILIES` maps the display name's Unicode script to a Google Fonts family (kana tested before Han so a kanji+kana name uses `Noto+Sans+JP`); `loadSubsetFont` requests `css2?family=...&text=...`, which returns a tiny `format('truetype')` subset (satori cannot read woff2), and caches per instance. The `text=` set includes every string the card draws (name, `@user`, count, `badges owned`, footer) because a registered font replaces Geist for the whole image. Fetch failure falls back silently to the Geist default. Two entries (400/700) are registered under name `NotoOG`; the root `fontFamily` becomes `"NotoOG"` only when a font was loaded. All multi-child divs already carry `display: "flex"`.
- **Verification**: probed the live endpoints the helper calls — all return `200` with `format('truetype')` subsets (1.6–5.9 KB): Noto Sans Arabic/Hebrew/JP/KR/Thai/SC. `tsc`/`eslint` clean. (OG binary rendering was not exercised — the route calls the third-party perfil API; the font pipeline itself is proven by the URL probes.)
- **Files touched**: `src/app/api/og/profile/route.tsx`.

## ind-4 — `/api/feed` default of 30 was unreachable

- **File**: `src/app/api/feed/route.ts:12-19`.
- **Old behaviour**: `Number(url.searchParams.get("limit"))` — absent → `Number(null) === 0`, finite, so the clamp `Math.min(50, Math.max(5, 0))` returned **5**; the documented default 30 only applied to `?limit=abc`.
- **New behaviour**: `const limitParam = url.searchParams.get("limit"); const limitParsed = limitParam === null ? Number.NaN : Number(limitParam);` — absent and non-numeric both take 30; a provided value is clamped 5–50.
- **Files touched**: `src/app/api/feed/route.ts`.

## pdat-5 (route half) — `/api/inventory/sync` always answered `{ ok: true }`

- **File**: `src/app/api/inventory/sync/route.ts:26-35`.
- **Old behaviour**: `return Response.json({ ok: true, result })` regardless of outcome; a sync whose potat enrichment failed (`potatEnriched: false`) looked identical to a complete one.
- **New behaviour**: `const degraded = !result.potatEnriched; return Response.json({ ok: !degraded, degraded, result });` — HTTP stays 200 for a completed-but-degraded sync, but the body advertises it. `SyncButton.tsx` only checks the HTTP status, so the UI is unaffected.
- **Files touched**: `src/app/api/inventory/sync/route.ts`.

## pdat-7 — PostgREST 1000-row cap truncated stats and the catalog keys

- **Files**: `src/lib/queries.ts` (`getSiteStats`, `getCatalogKeys`), `supabase/migrations/0013_catalog_aggregates.sql`.
- **Old behaviour**: `getSiteStats` fetched one row per badge (`select("rarity_tier")`, `select("category")`) and `getCatalogKeys` used `.limit(3000)`; PostgREST caps a response at 1000 rows, so both were silently truncated.
- **New behaviour**: two approaches, per the coordinator's options —
  1. **Aggregate in SQL** (migration 0013): `stats_catalog_rarity` and `stats_catalog_categories` return one row per distinct value, complete at any size. `getSiteStats` reads them instead of the row-level selects.
  2. **Page with `.range()`** for `getCatalogKeys` (it needs rows, not aggregates): loop in pages of 1000 until a short page ends the set, ordered by `rarity_score desc, id asc` for a stable window.
  *(0012 was already applied when pdat-7 arrived, so the new view went into a fresh migration 0013 rather than editing an applied file.)*
- **Verification (live)**:
  ```
  PDAT-7 {"badges_total":"475","rarity_rows":"475","rarity_view_sum":"475",
          "category_view_sum":"475","category_distinct":"12","catalog_keys_expected":"475"}
  RARITY [{"rare":228},{"common":164},{"epic":32},{"uncommon":32},{"legendary":19}]
  ```
  `sum(stats_catalog_categories.count)` = 475 = `count(*) from badges`, and `sum(stats_catalog_rarity.count)` = 475 = the non-null rarity count — the aggregate is complete, not capped. `getCatalogKeys` returns 475 in one page today (catalog < 1000); the loop's multi-page path is not exercisable until the catalog exceeds 1000 and was verified by typecheck/logic only.
- **Files touched**: `src/lib/queries.ts`, `supabase/migrations/0013_catalog_aggregates.sql`.

---

## Migration output (exact)

```
Applying 0012_customization_bounds.sql ...
  NOTICE: constraint "profiles_customization_object" of relation "profiles" does not exist, skipping
  NOTICE: constraint "profiles_customization_size" of relation "profiles" does not exist, skipping
OK 0012_customization_bounds.sql

Applying 0013_catalog_aggregates.sql ...
OK 0013_catalog_aggregates.sql
```

Ledger after: `["0013_catalog_aggregates.sql","0012_customization_bounds.sql","0011_public_read_blog_engagement.sql"]`.

## Files touched

- `supabase/migrations/0001_init.sql` (guard preamble)
- `supabase/migrations/0003_gamification.sql` (idempotency)
- `supabase/migrations/0012_customization_bounds.sql` (new)
- `supabase/migrations/0013_catalog_aggregates.sql` (new)
- `src/app/api/account/route.ts`
- `src/app/api/feed/route.ts`
- `src/app/api/og/profile/route.tsx`
- `src/app/api/inventory/sync/route.ts`
- `src/lib/queries.ts`

Not committed, not pushed, no build, no `log:change` (left for the batch owner). No secret
printed. 0012 and 0013 were applied; 0001–0011 were not touched or re-run at the DB level.