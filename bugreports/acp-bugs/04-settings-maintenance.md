# Settings, maintenance mode and feature flags

Audited:
- `src/lib/settings.ts` (accessors, `merge`, per-instance cache + invalidation)
- `src/app/api/admin/settings/route.ts` (sections + admin/moderator grants)
- `src/components/admin/SettingsPanel.tsx`
- `src/lib/maintenance-edge.ts`, the maintenance gate in `src/proxy.ts`
- `src/app/[locale]/layout.tsx` (maintenance render + feature props), `src/components/Header.tsx`
- consumers: `src/lib/gamification/daily.ts`, `src/lib/gamification/games.ts`,
  `src/app/api/{wheel/spin,steal,games/play,coinrain}/route.ts`
- supporting reads: `src/lib/admin.ts`, `src/lib/admin-route.ts`,
  `src/components/admin/AdminShell.tsx`, `src/app/[locale]/admin/page.tsx`,
  `src/app/[locale]/games/page.tsx`, `src/app/[locale]/games/[game]/page.tsx`,
  `src/app/[locale]/{login,auth/callback,feed,compare,wheel}/page.tsx`,
  `src/components/games/useGame.tsx` (+ per-game components), `src/app/api/feed/route.ts`,
  `supabase/migrations/0025_acp_foundation.sql`, `0026_acp_settings_seed.sql`,
  `src/app/api/admin/setup/route.ts`, `docs/ACP.md`

Method: static reading + `grep`/`find` + a node script comparing the
`admin.settings` message keys across all 11 locales + one **read-only** `SELECT`
against the live DB through the anon-key REST endpoint
(`GET /rest/v1/site_settings?select=key,value,updated_at`). No writes, no
`db:apply`, no file modified. `tsc`/`eslint` were not needed for any finding
below (all are behavioural contracts, not type errors).

---

## B1 — Maintenance mode locks every logged-out admin out (login and OAuth callback are replaced by the notice)

- **Severity**: high
- **Confidence**: high (verified by reading; contract traced end to end)
- **Where**: `src/app/[locale]/layout.tsx:99` and `:113` (the gate), affecting
  `src/app/[locale]/login/page.tsx` and `src/app/[locale]/auth/callback/page.tsx`
  (there is exactly one layout under `src/app`; both pages are children of it)
- **Code**:
  ```tsx
  // layout.tsx
  const [maintenance, features] = await Promise.all([getMaintenance(), getFeatures()]);
  const lockedOut = maintenance.enabled && !user?.isAdmin;
  ...
  {lockedOut ? <MaintenanceNotice message={maintenance.message} /> : children}
  ```
- **Why it is wrong**: `user` comes from `supabase.auth.getUser()` on the same
  request. A visitor who is not *currently* holding a session — including the
  owner whose refresh token expired, or the same admin on another browser — is
  `user === null`, so `lockedOut` is true and `children` is never rendered. The
  comment at `layout.tsx:92-94` claims "admins and the owner keep full access",
  but the two pages that could *create* such an admin session are themselves
  children of this layout:
  - `/login` renders the maintenance notice instead of `TwitchLoginButton`, so no
    OAuth redirect can be started;
  - `/auth/callback` renders the notice instead of `CallbackInner`, so
    `exchangeCodeForSession(code)` (callback page line 42) never runs and the
    session cookies are never written — even if the operator had started the flow
    before maintenance was switched on.
  Net effect: enabling maintenance is a **one-way door**. The only way back is a
  direct `site_settings` SQL update.
- **How to reproduce**: by inspection (the live DB has `maintenance.enabled =
  false`, so it is not directly reproducible without a write): sign in as the
  owner, turn maintenance on in the Settings tab, clear cookies / use a private
  window, open `/en/login` → "Back shortly"; complete the Twitch consent screen →
  `/en/auth/callback?code=…` shows "Back shortly" and no session is created.
- **Suspected cause**: the maintenance gate is applied to *every* page under the
  locale layout with no exemption for the auth entry points (the API gate in
  `proxy.ts` does exempt `/api/admin`; the page gate has no equivalent).

---

## B2 — The "Arcade enabled (master switch)" is not enforced by the engine: it empties the hub but `/api/games/play` keeps playing

- **Severity**: medium
- **Confidence**: high
- **Where**: written/read at `src/lib/settings.ts:185` (`getGames` returns
  `enabled`), consumed **only** at `src/app/[locale]/games/page.tsx:59-61`; the
  engine at `src/lib/gamification/games.ts:86-91` and `src/lib/settings.ts:205-211`
  (`gameRules`) never look at it.
- **Code**:
  ```ts
  // settings.ts:205
  export async function gameRules(id, meta) {
    const settings = await getGames([{ id, ...meta }]);
    return settings.games[id] ?? { enabled: true, minBet: meta.minBet, maxBet: meta.maxBet };
  }
  // games.ts:86
  const rules = await gameRules(meta.id, { minBet: meta.minBet, maxBet: meta.maxBet });
  if (!rules.enabled) return fail("This game is currently switched off.");
  ```
  ```tsx
  // games/page.tsx:59 — the only consumer of the master flag
  const visible = settings.enabled ? GAMES.filter(...) : [];
  ```
- **Why it is wrong**: the panel offers a master toggle (`admin.settings.games.master`,
  `SettingsPanel.tsx:205-212`) that writes `games.enabled`. It is honoured by the
  hub only. `/api/games/play` gates on the *other* flag, `features.games`
  (`src/app/api/games/play/route.ts:11-14`), which stays true, and `playGame`
  then only consults the per-game `enabled`. So an operator who switches the
  arcade "off" for the whole site still accepts POSTs:
  `{game:"rps", bet:100}` returns a played round and moves coins. A master switch
  that hides the UI but does not close the endpoint is exactly the flag/endpoint
  mismatch this audit is looking for.
- **How to reproduce**: by inspection — set `games.enabled=false` (leave
  `features.games` true), open `/en/games` (grid empty), then POST
  `/api/games/play` with a session; the round is accepted.
- **Suspected cause**: `gameRules` reduces the settings document to the per-game
  entry and drops the document-level `enabled` before the engine sees it.

---

## B3 — `maxBet` can be set below `minBet` (no relational validation anywhere); the engine then refuses **every** bet

- **Severity**: medium
- **Confidence**: high
- **Where**: `src/lib/settings.ts:174-182` (read-side validation accepts each bound
  independently), `src/components/admin/SettingsPanel.tsx:245-276` (write side has
  no cross-field check), enforced at `src/lib/gamification/games.ts:89`.
- **Code**:
  ```ts
  // settings.ts:174
  minBet: typeof entry?.minBet === "number" && entry.minBet >= 0 ? entry.minBet : meta.minBet,
  maxBet: typeof entry?.maxBet === "number" && entry.maxBet > 0  ? entry.maxBet : meta.maxBet,
  ```
  ```ts
  // games.ts:89
  if (!Number.isFinite(bet) || bet < rules.minBet || bet > rules.maxBet) {
    return fail(`Bet must be between ${rules.minBet} and ${rules.maxBet} coins.`);
  }
  ```
- **Why it is wrong**: the two bounds are validated in isolation; nothing asserts
  `minBet <= maxBet` (not in `merge`, not in `getGames`, not in the POST route
  `src/app/api/admin/settings/route.ts:60-65`, not in the panel). With
  `minBet=5000, maxBet=100` every integer bet satisfies `bet < 5000` **or**
  `bet > 100`, so `playGame` fails every attempt with the self-contradicting
  message "Bet must be between 5000 and 100 coins." The game becomes permanently
  unplayable until the operator reverses the change. The same document is
  published verbatim on the hub tile: `games/page.tsx:112` renders
  `{range.minBet}–{range.maxBet}` ("5000–100"), contradicting the comment at
  `games/page.tsx:54-57` ("a tile can never advertise a range the engine would
  refuse").
- **How to reproduce**: Settings → Games → set `max` below `min` for any game →
  Save; the tile shows the inverted range and no bet on that game succeeds.
- **Suspected cause**: bounds validated per-field, never as a pair.

---

## B4 — Per-game bet bounds from the panel are ignored by the game pages: the BetBar hardcodes the catalog range

- **Severity**: medium
- **Confidence**: high
- **Where**: every game component — `src/components/games/RpsGame.tsx:23`,
  `CoinflipGame.tsx:28`, `HiloGame.tsx:39`, `RouletteGame.tsx:19`,
  `BlackjackGame.tsx:24`, `SlotsGame.tsx:73`, `ShootGame.tsx:133`,
  `MemoryGame.tsx:88`, `QuizGame.tsx:70`, `TowerGame.tsx:33`, `VaultGame.tsx:83`,
  `ScratchGame.tsx:30`, `CatcherGame.tsx:135`; the page that mounts them
  (`games/[game]/page.tsx`) never calls `getGames`/`gameRules` at all.
- **Code**:
  ```tsx
  // RpsGame.tsx:23
  <BetBar bet={bet} setBet={setBet} min={10} max={5000} busy={busy} balance={balance} />
  ```
- **Why it is wrong**: the panel's per-game `minBet`/`maxBet` are authoritative
  server-side (`games.ts:89`) and are displayed on the hub tile, but the page the
  hub links to offers the **catalog** range (10…5000 for rps, 10…1000 for
  scratch, …). Lower a game's `maxBet` to 100 and the chip on the hub reads
  "10–100" while the game page's bet slider still goes to 5000; every bet above
  100 is composed client-side and then rejected with
  "Bet must be between 10 and 100 coins." Raise `minBet` to 500 and the page
  still starts at 10 — the first attempt always fails. The operator's change
  silently degrades to a rejection loop.
- **How to reproduce**: Settings → Games → set rps `max` = 100 → open `/en/games/rps`
  → the bet bar still allows 5000 → Play → server 400.
- **Suspected cause**: the client never receives the effective bounds; each game
  component duplicates the catalog constants instead of reading settings.

---

## B5 — `features.feed` hides the nav entry but neither the page nor `/api/feed` checks it

- **Severity**: medium
- **Confidence**: high
- **Where**: `src/components/Header.tsx:57` (nav only), `src/app/api/feed/route.ts`
  (no `getFeatures` call at all — the only gate is `dynamic = "force-dynamic"`),
  `src/app/[locale]/feed/page.tsx` (no feature read)
- **Code**:
  ```tsx
  // Header.tsx:57
  ...(on("feed") ? [{ href: "/feed", label: t("feedNav") }] : []),
  ```
  ```ts
  // api/feed/route.ts:6 — a public feed with no feature gate
  export async function GET(request: Request) { ... }
  ```
- **Why it is wrong**: the panel's own hint promises the contract
  (`messages/en.json` → `admin.settings.features.hint`): "A switched-off feature
  loses its navigation entry, **and the matching endpoint refuses the action**."
  For the other four flags the endpoint does refuse (`wheel/spin`, `steal`,
  `games/play`, `coinrain` all call `getFeatures`). `feed` does not: with
  `features.feed=false` the nav link disappears, yet `/en/feed` renders and
  `GET /api/feed` keeps serving activity events. (`features.compare` is the same
  pattern with no endpoint; `/compare` stays reachable.)
- **How to reproduce**: by inspection — set `feed=false`, load `/en/feed` and
  `/api/feed`: both still answer.
- **Suspected cause**: the flag was added to the Header and the four mutating
  endpoints only; read endpoints and pages were never wired.

---

## B6 — The games hub links to `/wheel` even when the wheel flag is off

- **Severity**: low
- **Confidence**: high
- **Where**: `src/app/[locale]/games/page.tsx:86-89`
- **Code**:
  ```tsx
  <Link href="/wheel" className="btn btn-primary text-xs">
    <GameIcon id="wheel" size={14} />
    {t("wheelLink")}
  </Link>
  ```
- **Why it is wrong**: `games/page.tsx` already reads settings but only calls
  `getGames`, so this second, prominent entry point to `/wheel` is rendered
  unconditionally. With `features.wheel=false` the Header hides its Wheel link
  (the documented behaviour) while the hub keeps advertising it; clicking it
  opens a wheel page whose spin POST answers 403 "feature disabled"
  (`api/wheel/spin/route.ts:11-14`). The one surface the flag *did* hide is
  contradicted by the other.
- **How to reproduce**: set `wheel=false`, open `/en/games` → "Wheel of Fortune"
  button present, its spin refused.
- **Suspected cause**: the hub got the games settings but not the feature flags.

---

## B7 — `settings_public_read` exposes every settings key to the public anon key, including the staff roster and the bootstrap throttle counter

- **Severity**: medium
- **Confidence**: high (verified live: an anon-key `SELECT` returned all rows)
- **Where**: `supabase/migrations/0025_acp_foundation.sql:17-18` (policy), read by
  `src/lib/settings.ts:118-139` (`readSetting` — same policy, so unavoidably
  readable) and exposed by `GET /rest/v1/site_settings`
- **Code**:
  ```sql
  alter table public.site_settings enable row level security;
  create policy "settings_public_read" on public.site_settings
    for select using (true);
  ```
  Live result of `GET {url}/rest/v1/site_settings?select=key,value` with the
  publishable (anon) key shipped in the browser bundle:
  ```json
  [{"key":"features","value":{...}}, {"key":"maintenance","value":{...}},
   {"key":"economy","value":{...}}, {"key":"admin","value":{"grants": []}},
   {"key":"games","value":{...}},
   {"key":"acp_gate_state","value":{"count":1,"windowStartedAt":1790123525232}}]
  ```
- **Why it is wrong**: the policy has no key filter. Once the owner is registered,
  the `admin` document holds `profileId`, `username`, `registeredAt` and the full
  `grants[]` list (each with `profileId`, `username`, `role`) — i.e. the operator
  roster and the owner's internal id are world-readable with a key that is already
  in every visitor's JS bundle. `acp_gate_state` (written by
  `src/app/api/admin/auth/route.ts:26,46,57`) is the bootstrap failed-attempt
  counter and its window start: the throttle that protects a five-digit passcode
  is itself observable, so an attacker can time/pace guesses around the 429
  without ever tripping a lockout they cannot see. The comment at
  `src/lib/settings.ts:122-125` justifies the anon read for *economy/features/
  maintenance*, which is fine; the same policy silently covers the sensitive
  keys.
- **How to reproduce**: `curl "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/site_settings?select=key,value" -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"`
  (run during this audit; output above).
- **Suspected cause**: one table-wide SELECT policy for a key/value store that
  holds both public and staff-only documents.

---

## B8 — Admin grant/revoke writes the `grants` record before `profiles.role`; a failure between them cannot be recovered from the panel

- **Severity**: medium
- **Confidence**: medium (ordering is certain; the second statement failing is the premise)
- **Where**: `src/app/api/admin/settings/route.ts:99-108` (add) and `:121-131` (remove)
- **Code**:
  ```ts
  // add
  await setSetting("admin", { ...identity, grants: [...rest, grant] });   // record first
  const { error } = await supabase.from("profiles")
    .update({ role: grant.role }).eq("id", grant.profileId);              // enforcement second
  if (error) throw error;
  ```
  ```ts
  // remove
  await setSetting("admin", { ...identity, grants: grants.filter(...) }); // record first
  const { error } = await supabase.from("profiles")
    .update({ role: "user" }).eq("id", profileId);                        // enforcement second
  if (error) throw error;
  ```
- **Why it is wrong**: the two writes are not atomic and the *panel's* list is the
  one applied first. On `remove`, a failed `profiles` update leaves the member
  with `role='admin'` while the grant row is already gone; `adminAction` turns the
  thrown PostgrestError into a 500, so the operator sees a failure — but a retry
  now answers `{ error: "that profile is not in the list" }` (line 116) because
  the record was deleted. The member keeps admin access and the panel can no
  longer see or revoke them. On `add`, a failed update leaves a grant displayed
  that confers nothing (the profile's role is the enforcement, per the comment at
  line 101-102). Either way the two sources of truth diverge permanently.
- **How to reproduce**: by inspection; the failure requires the second UPDATE to
  error (network/5xx/RLS), which the code does not handle as a rollback.
- **Suspected cause**: two separate writes with the audit/UI-visible one first,
  no compensating action on the second.

---

## B9 — A moderator can grant `admin` (including to themselves) through the settings route, while the Header hides the panel from moderators

- **Severity**: medium
- **Confidence**: high on the behaviour; **flagging a possible overlap with
  `docs/ACP.md` limitation #40 ("Per-admin permissions — Partial")** so the
  orchestrator can decide whether it is in scope
- **Where**: `src/app/api/admin/settings/route.ts:57` (`adminAction` → `requireAdmin()`
  with no role check) and `:74-110` (the `add` branch accepts `role: "admin"`);
  contrast with the Header gate at `src/components/Header.tsx:199` fed by
  `src/app/[locale]/layout.tsx:83` (`isAdmin: role === "admin" || role === "owner"`)
- **Code**:
  ```ts
  // settings/route.ts:74 — no ctx.role check anywhere in this branch
  if (action === "add") {
    const role = String(body?.role ?? "moderator") as AdminRole;
    if (role !== "moderator" && role !== "admin") return { error: "..." };
    ...
    await supabase.from("profiles").update({ role: grant.role }).eq("id", grant.profileId);
  ```
- **Why it is wrong**: any caller passing `requireAdmin` — which includes
  `moderator` (`src/lib/admin.ts:130`) — can POST
  `{section:"admins", action:"add", username:"<their own name>", role:"admin"}`
  and promote themselves to admin (the only protection in this branch is against
  the registered owner, line 90). The `/api/admin/users` route, by contrast, has
  explicit self/owner rails (lines 79-107). Second half of the mismatch, in the
  other direction: a moderator **does** get the full panel when they navigate to
  `/[locale]/admin` (the page accepts `viewerRole()` = moderator and
  `AdminShell` renders every tab, `AdminShell.tsx:28-39`), but the Header never
  shows them the ACP link because `isAdmin` excludes `moderator`
  (`layout.tsx:83`).
- **How to reproduce**: grant a test profile `moderator`, sign in as it, POST the
  body above to `/api/admin/settings` → 200 `{ok:true}` and the profile's role
  becomes `admin`; back on the site, the account menu still has no "Admin panel"
  entry.
- **Suspected cause**: the settings route predates/ignores the role rails that the
  users route implements.

---

## B10 — Zero is accepted for every economy field; `stealPerHour = 0` refuses every steal and `stealFloodMinutes = 0` removes the cooldown

- **Severity**: low
- **Confidence**: high
- **Where**: `src/lib/settings.ts:150-152` (merge accepts `parsed >= 0`),
  `SettingsPanel.tsx:187` (`min={0}`), consumed at
  `src/lib/gamification/daily.ts:121-122` and `:138`
- **Code**:
  ```ts
  // settings.ts:150
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 0) out[key] = parsed;
  ```
  ```ts
  // daily.ts:121-122 / 138
  const floodMinutes = Math.max(0, economy.stealFloodMinutes);
  const fiveMinAgo = new Date(Date.now() - floodMinutes * 60_000).toISOString();
  ...
  if ((recentHour ?? 0) >= economy.stealPerHour) return { ok:false, error: `Flood check: max ${economy.stealPerHour} steal attempts per hour.` };
  ```
- **Why it is wrong**: `0` is a legal value for every economy field, but two of
  them are degenerate at zero. `stealPerHour = 0` makes `recentHour >= 0`
  unconditionally true, so **every** steal is refused with "max 0 steal attempts
  per hour" — the feature is silently dead, and the failure reads as a flood
  check rather than a configuration mistake. `stealFloodMinutes = 0` makes the
  window `now`, so no past attempt can ever match and the per-victim cooldown
  disappears while the hourly cap still applies. The panel's number inputs make
  this easy to hit by accident: `onChange` does `Number(event.target.value)`
  (`SettingsPanel.tsx:190`), so clearing a field yields `Number("") = 0` and an
  ill-formed intermediate entry yields `NaN`, which `JSON.stringify` turns into
  `null`, which `merge` then coerces with `Number(null) = 0` — i.e. an empty
  input silently writes 0. (Related, smaller: `stealMax` is floored to 10 at
  `daily.ts:111`, so any panel value below 10 has no effect.)
- **How to reproduce**: set "Steal attempts per hour" to 0 → every `/api/steal`
  call returns the flood-check error; clear the field and save → the same value
  is written.
- **Suspected cause**: `>= 0` as the only bound plus a client coercion that maps
  "empty" to 0.

---

## B11 — The edge maintenance cache has no invalidation path: enabling maintenance leaves the public API open for up to ~10 s

- **Severity**: low
- **Confidence**: high
- **Where**: `src/lib/maintenance-edge.ts:18,25,43-55` vs. the panel write at
  `src/app/api/admin/settings/route.ts:61-62`; also `src/lib/settings.ts:111-116`
- **Code**:
  ```ts
  // maintenance-edge.ts
  const TTL_MS = 10_000;
  let cache: Cache | null = null;
  export async function maintenanceMode() {
    if (cache && Date.now() - cache.at < TTL_MS) return cache.value;   // no way to clear it
  ```
- **Why it is wrong**: `clearSettingsCache()` clears only the in-process `Map` of
  `src/lib/settings.ts` **on the instance that handled the POST**. The proxy runs
  on the Edge runtime with its own module-level `cache` that nothing can clear, so
  after the operator flips the switch the public API keeps answering 200 for up
  to 10 s per warm Edge instance (and the pages, through the 5 s settings cache,
  for up to 5 s per warm serverless instance). The panel's own hint says the
  public API "answers 503" once maintenance is on; the comment at
  `settings.ts:12-14` acknowledges only the cross-instance staleness of the
  serverless cache, not the Edge cache, which has no invalidation mechanism at
  all.
- **How to reproduce**: by inspection; timing behaviour only.
- **Suspected cause**: two independent caches, only one of them clearable.

---

## B12 — Maintenance pages answer 200 with the real page metadata, so crawlers index the placeholder for every URL

- **Severity**: low
- **Confidence**: high on the rendering; the ranking impact is unverified
- **Where**: `src/app/[locale]/layout.tsx:113` (200 + notice) and
  `src/app/[locale]/layout.tsx:28-50` (`generateMetadata` keeps running)
- **Code**:
  ```tsx
  {lockedOut ? <MaintenanceNotice message={maintenance.message} /> : children}
  ```
- **Why it is wrong**: the gate replaces the body but not the response status or
  the metadata: a per-page `generateMetadata` (e.g.
  `badges/[slug]/page.tsx`) still emits that page's title, description and
  canonical, while the body is the identical "Back shortly" notice. Every public
  URL therefore serves 200 with the same content under different metadata during
  maintenance; unlike `/api/*`, which gets a deliberate 503, the pages are not
  marked non-indexable. (Note the SEO agent also owns the sitemap/robots side —
  listed here only because the rendering path is in this scope.)
- **How to reproduce**: by inspection.
- **Suspected cause**: a render-time substitution rather than a response-level
  one.

---

## B13 — The games table inputs have no accessible name

- **Severity**: low
- **Confidence**: high
- **Where**: `src/components/admin/SettingsPanel.tsx:231-241` (enable checkbox),
  `:245-259` (min), `:261-276` (max); the file contains no `aria-label`,
  `aria-labelledby` or `htmlFor` anywhere
- **Code**:
  ```tsx
  <td>
    <input type="checkbox" checked={setting.enabled} onChange={...} />
  </td>
  ...
  <td><input className="input w-24" type="number" min={0} value={setting.minBet} onChange={...} /></td>
  ```
- **Why it is wrong**: the checkbox and the two number inputs live in bare
  `<td>`s; the only nearby text is the `<th>` column label, which is not
  associated with the control, and the game title sits in a different cell. A
  screen reader announces thirteen unnamed checkboxes and twenty-six unnamed
  spinbuttons, so the per-game switch and bet bounds are unusable without sight —
  the Economy and Feature sections, whose inputs sit inside `<label>`, do not
  have this problem. (The `error`/`notice` paragraphs at lines 120-121 are also
  not `aria-live`, so save results are not announced.)
- **How to reproduce**: navigate the Settings tab with a screen reader; the table
  controls are announced with no label.
- **Suspected cause**: row-scoped controls written as table cells without
  per-control labelling.

---

## Checked and found clean

- **i18n**: all `admin.settings.*` keys (including the dynamic
  `features.<key>` / `economy.<key>` / `games.col.*` lookups used by the panel and
  `admins.owner` with `{username}`) exist in **all 11** `messages/*.json`, with
  identical placeholder sets; `common.maintenanceTitle` / `maintenanceBody` exist.
  Verified with a node key/placeholder diff across every locale.
- **Economy fields are all read**: every one of the 13 `EconomySettings` fields is
  consumed (`daily.ts:35-42,110-111,121,138,344`, `games.ts:194`); no field is a
  write-only no-op. The `defaults` block returned by `GET /api/admin/settings`
  (`route.ts:32-36`) is not consumed by the panel, but that is unused payload, not
  a defect.
- **Feature flags with endpoints are enforced**: `wheel/spin`, `steal`,
  `games/play`, `coinrain` each call `getFeatures()` and answer 403 when off.
- **API maintenance gate**: `proxy.ts:19-31` covers every `/api/**` path (the
  matcher keeps `/api` in scope), exempts only `/api/admin`, `/api/cron`,
  `/api/health` for documented reasons, and returns 503 + `retry-after`. The
  exemptions do not open a route to an unprivileged caller: `/api/admin/*` is
  gated by `requireAdmin` and `/api/cron/*` by cron auth.
- **Env var names** used by `maintenance-edge.ts` / `proxy.ts`
  (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) match those
  used by the server/browser/admin clients and those present in `.env.local`.
- **Owner protection in the grants branch**: the owner cannot be added (line 90),
  removed (line 118) or overwritten, and `remove` is a no-op for unknown ids.
- **`setSetting`** upserts with `onConflict: "key"` and throws on error, so a
  failed settings write is not silent; `clearSettingsCache()` is called after the
  write in every section branch.
- Locale count, `getGames` fallback for unknown ids, `merge`'s per-key type
  coercion (boolean/string/number) and its rejection of negative/non-finite
  numbers behave as documented.
