# Auth, session, Supabase boundaries, account, profile, customizer, perfil

Audited (all read in full): `src/lib/gamification/session.ts`,
`src/lib/supabase/{server,browser,admin}.ts`, `src/lib/env.ts`,
`src/lib/twitch/perfil.ts`, `src/lib/inventory.ts`,
`src/lib/queries.ts` (`ProfileRow`, `PROFILE_PUBLIC_COLUMNS`,
`getProfileByUsername`, `getInventory`), `src/proxy.ts`,
`src/app/[locale]/login/page.tsx`, `src/app/[locale]/auth/callback/page.tsx`,
`src/components/TwitchLoginButton.tsx`, `src/app/api/account/route.ts`,
`src/app/[locale]/account/page.tsx`,
`src/components/account/{AccountSettings,ProfileCustomizer}.tsx`,
`src/app/[locale]/profile/[username]/page.tsx`, `src/components/StealPanel.tsx`,
`src/app/api/inventory/sync/route.ts`, `src/lib/gamification/visits.ts`.
Migrations read for the contract: `0001` (profiles, `profile_visits`,
`handle_new_user`, RLS), `0003` (profile columns), `0006` + `0030`
(`protect_profile_columns`), `0009`/`0010`/`0027` (column grants), `0012`
(`customization` bounds). Prior reports read so as not to re-report:
`bugreports/full-audit/{README-brief,VERIFIED}.md`,
`bugreports/acp-bugs/VERIFIED.md`, `bugreports/AGENT-AUDIT.md`,
`bugreports/verify-round29.md`, `bugreports/agent-14-sync-profile.md`.

Method:
- Node simulations of the two write paths (`/api/account`'s patch builder fed
  the exact payload `ProfileCustomizer.save()` sends) — read-only, no DB.
- Mechanical i18n check across all eleven `messages/*.json`: every `t("…")`
  key used by the eight in-scope components/pages exists in all eleven, and the
  placeholder sets for `profile.greeting`, `profile.shareTitle`,
  `account.removeShowcase`, `steal.{success,failed,hint}` are identical in all
  eleven (no `MISSING_MESSAGE`, no `{n}`/`{count}` drift). Nothing to report.
- `grep` sweeps: `"use client"` files importing `@/lib/supabase/admin` (none) or
  `@/lib/env` / `envOr(` (none — the service-role and env-helper boundary is
  clean); writers of `display_name`/`bio`/`banner_url`/`customization` (only
  `/api/account`, `lib/inventory.ts`, the admin panel).
- Read `@supabase/postgrest-js`'s `in()` (reserved-char wrapping, no quote
  escaping) and `0003`'s `profile_visits` indexes (no unique constraint).
- **Not run**: `tsc`/`eslint`/`build` (the findings below are read- and
  simulation-based; nothing needed a compile to confirm). No SQL was executed.

---

## B1 — Saving the ProfileCustomizer silently clears the display name, bio and banner, and resets the colour, that were set in the AccountSettings card

- **Severity**: high
- **Confidence**: high (verified by reading both forms and simulating the exact payload through the route's patch builder in Node)
- **Where**: `src/app/[locale]/account/page.tsx:96-100` (seeds the customizer from the document), `src/components/account/ProfileCustomizer.tsx:130` and `:142-156` (its own state + payload), `src/app/api/account/route.ts:38-46` (unconditional writes)
- **Code**:
  ```tsx
  // account/page.tsx — the customizer's initial state is the DOCUMENT only
  <ProfileCustomizer
    initial={((profile?.customization as Record<string, unknown> | null) ?? {})}
    initialMood={(profile?.mood as string | null) ?? ""}
    steal={steal}
  />
  ```
  ```tsx
  // ProfileCustomizer.tsx:130 — no column value anywhere in `initial`
  const [values, setValues] = useState<Customization>({ ...DEFAULTS, ...initial });
  ```
  ```ts
  // ProfileCustomizer.tsx:147-151 — every save ships the four shared fields
  displayName: values.displayName,
  bio: values.bio,
  bannerUrl: values.bannerUrl,
  color: values.color,
  ```
  ```ts
  // api/account/route.ts — typeof string ⇒ always written
  if (typeof body.displayName === "string") patch.display_name = body.displayName.slice(0, 64) || null;
  if (typeof body.bio === "string") patch.bio = body.bio.slice(0, 280) || null;
  if (typeof body.bannerUrl === "string")
    patch.banner_url = /^https?:\/\//.test(body.bannerUrl) ? body.bannerUrl.slice(0, 500) : null;
  ```
- **Why it is wrong**: the account page hosts **two independent forms** that write the same four columns, each from its own local state. `AccountSettings` is seeded from the **columns** (`account/page.tsx:84-92`, `AccountSettings.tsx:33-36`); `ProfileCustomizer` is seeded from the **`customization` document**, which is `{}` for anyone who has not used the customizer — so its `displayName`/`bio`/`bannerUrl` are `""` and its `color` is `DEFAULTS.color` (`#a970ff`). Because `/api/account` writes each field whenever it is a string, any save from the customizer (e.g. toggling one effect) writes those four values over the columns. Verified in Node with the real payload:
  ```
  before: display_name='Alice' bio='hi' banner_url='https://x/b.png' color='#00ff00' customization={}
  after : display_name=null    bio=null banner_url=null          color='#a970ff'
  ```
  The member's public name silently reverts to the username (`page.tsx:169-170` reads the column), the bio and banner disappear. `AccountSettings`'s colour is also reverted to the document's colour (this is the *write* half of v29-03, which only fixed the read path — “the column wins” — and left the customizer free to overwrite the column). Note also that `router.refresh()` does **not** re-seed either component's `useState`, so after saving the other form both stay stale and the next save repeats the loss.
- **How to reproduce**: sign in → set “Display name”/bio/banner in the top card → Save → toggle any customizer setting lower on the same page → Save → `select display_name, bio, banner_url, color from profiles where id = <you>` shows `null, null, null, '#a970ff'`; the public profile shows `@username` as the H1.
- **Suspected cause**: two forms writing one set of columns from two different seeds (column vs document), with no merge/ownership rule and no re-seed after `router.refresh()`.

---

## B2 — `/api/account` accepts arbitrary showcase slugs: no ownership check and no size bound, so unowned badges can be displayed and an unbounded string is stored in a public-read column

- **Severity**: low
- **Confidence**: high for the ownership gap and the missing bound; medium for the filter-breaking variant (PostgREST parsing not exercised live)
- **Where**: `src/app/api/account/route.ts:49-53`; consumer `src/app/[locale]/profile/[username]/page.tsx:274-288`
- **Code**:
  ```ts
  if (Array.isArray(body.showcaseSlots)) {
    patch.showcase_slots = body.showcaseSlots
      .filter((slug): slug is string => typeof slug === "string")
      .slice(0, 6);       // no ownership check, no per-string length, no charset
  }
  ```
  ```tsx
  const slugs = Array.isArray(profile.showcase_slots) ? profile.showcase_slots.slice(0, 6) : [];
  const { data: rows } = await supabase.from("badges").select("*").in("slug", slugs);   // error ignored
  ```
- **Why it is wrong**: `showcase_slots` is written verbatim and the profile page renders whatever slugs match the catalogue — `user_inventory` is never consulted. `POST /api/account {"showcaseSlots":["<any set's slug>"]}` therefore publishes badges the member does not own on their public showcase (the account UI only ever offers owned badges, so the API contract is stricter than the page implies). The same line has no length bound: `profiles.showcase_slots` is `jsonb not null default '[]'` with no CHECK (migration `0001:148`), so a member can store a multi-megabyte string there; every subsequent view of that profile then rebuilds `.in("slug", slugs)` with it (anonymously reachable, on every view). `postgrest-js`'s `in()` wraps values containing reserved characters in `"` **without escaping embedded quotes** (`PostgrestFilterBuilder.ts:838-846`), so a crafted slug can also break the filter expression; the page ignores the query error, so the result is a silently empty showcase rather than a signal.
- **How to reproduce**: by inspection + simulation. As any signed-in member, `POST /api/account` with `{"showcaseSlots":["<slug of a badge you don't own>"]}` → the slug appears in the profile's showcase section. With a 1 MB string element, `select pg_column_size(showcase_slots) from profiles where id=<you>` shows it stored, and the profile query carries it.
- **Suspected cause**: the slip between the picker's client-side guarantee (owned badges only) and the API, which is the actual boundary.

---

## B3 — “Sync inventory” silently reverts the member's display name to their Twitch name

- **Severity**: low
- **Confidence**: high
- **Where**: `src/lib/inventory.ts:158-163`, reached from `src/app/api/inventory/sync/route.ts:31`
- **Code**:
  ```ts
  // Keep profile Twitch metadata fresh (avatar / display name / creation).
  const profilePatch: Record<string, unknown> = {};
  if (perfil.displayName) profilePatch.display_name = perfil.displayName;
  if (perfil.profileImageURL) profilePatch.avatar_url = perfil.profileImageURL;
  ...
  if (Object.keys(profilePatch).length > 0) {
    const { error: profileError } = await supabase.from("profiles").update(profilePatch).eq("id", userId);
  ```
- **Why it is wrong**: `display_name` is a member-owned, member-editable field — `AccountSettings` offers “Display name” and `/api/account` writes it (`api/account/route.ts:38-39`) — and it is what the public profile renders as its heading. `normalize()` (`perfil.ts:41`) almost always yields a non-empty `displayName` (it falls back to the login), so the guard `if (perfil.displayName)` does not protect the member's value: pressing the **Sync inventory** button replaces a chosen name (“Cool Name”) with the Twitch display name. The button's label and the `/api/inventory/sync` response promise an inventory sync only. This is the third writer of one field (AccountSettings, ProfileCustomizer, and this sync) with no precedence rule; if the sync's overwrite is intended, the account page should not offer the field, and if it is not, the sync should not write it — today both exist.
- **How to reproduce**: set a Display name in `/account`, then press “Sync inventory” on the inventory page, then reload your profile: the heading is back to the Twitch name. (Read-only confirmation: `select display_name from profiles where id=<you>` before/after the POST.)
- **Suspected cause**: a metadata-refresh job writing a column the application also presents as member-editable.

---

## B4 — `normalize()` in the perfil resolver does not check that `badges` is an array, so a malformed third-party payload throws instead of degrading

- **Severity**: low
- **Confidence**: high for the code path; the malformed response itself is not observable from here
- **Where**: `src/lib/twitch/perfil.ts:37-58` (`normalize`), `:75` (`badges.blog` body), `:104` (GQL body); consequence at `src/app/[locale]/profile/[username]/page.tsx:116-164`
- **Code**:
  ```ts
  function normalize(raw: RawPerfilUser): PerfilUser {
    return {
      ...
      badges: (raw.badges ?? []).map((b) => ({ ... })),   // no Array.isArray guard
    };
  }
  ...
  return normalize((await res.json()) as RawPerfilUser);   // unchecked cast of a third-party body
  ...
  const user = payload[0]?.data?.user;
  if (!user) throw new Error(`Twitch GQL: user "${login}" not found`);
  return normalize(user);                                  // and the fallback is not wrapped
  ```
- **Why it is wrong**: the two upstream shapes are trusted by cast, so a response of `{"badges": {}}` (or any non-array) makes `.map` a `TypeError` rather than “no badges”. For the badges.blog leg the `try` in `fetchUserBadges` catches it and falls back to GQL — but the GQL leg is *outside* that `try`, so the same malformed shape there escapes `fetchUserBadges` entirely. On the profile page the escaping throw is swallowed by `catch { notFound() }` (`page.tsx:162-164`), turning a real Twitch user's profile into a 404 with no log and no fallback, exactly the class `pdat-2` fixed for the inventory sync (which now guards) but not for the shared resolver. `raw` itself is likewise unguarded: a body of literal `null` throws in `normalize` (`raw.id`) on the badges.blog leg.
- **How to reproduce**: by inspection; inject a stub `BADGESBLOG_PERFIL_URL` / `TWITCH_GQL_URL` returning `{"badges":{}}` and load `/en/profile/<a-non-member>` → 404, while a well-formed body resolves. I could not confirm that either upstream ever emits this.
- **Suspected cause**: casting a fetched JSON body to the expected interface instead of validating the one field the code maps.

---

## B5 — the GQL fallback drops the caller's `revalidate`, so a badges.blog outage makes every profile view an uncached live Twitch call

- **Severity**: low
- **Confidence**: high
- **Where**: `src/lib/twitch/perfil.ts:92` and `:127`
- **Code**:
  ```ts
  // primary — honours the caller's window (the profile page passes 900)
  const res = await fetch(url, { ..., next: { revalidate } });
  ...
  } catch (error) {
    return fetchFromGql(clean);          // the revalidate argument is not forwarded
  }
  ...
  // fallback — hard-coded
  const res = await fetch(envOrNull("TWITCH_GQL_URL") ?? GQL_URL, { ...
    next: { revalidate: 0 },
  ```
- **Why it is wrong**: `fetchUserBadges(login, 900)` is documented to cache the resolved badge list for 15 minutes (`page.tsx:117`); the fallback path caches nothing, so while badges.blog is down (the exact condition the fallback exists for) every view of every non-member profile hits `gql.twitch.tv` with an unauthenticated client id — the third party this repo elsewhere treats carefully (`potatFetch` honours `Retry-After: 60`). A single hot non-member profile becomes a per-request upstream call, and Twitch's 429 response is thrown on to the page, which renders a 404.
- **How to reproduce**: by inspection-adjacent — point `BADGESBLOG_PERFIL_URL` at a failing host, request `/en/profile/<non-member>` twice, and observe two outbound GQL posts (no cache entry) instead of one. I could not run a live network test from here.
- **Suspected cause**: a hard-coded `revalidate: 0` left from debugging, plus a call site that does not forward the parameter it accepts.

---

## B6 — the profile visit 5-minute dedup is a read-then-insert with no unique constraint, so overlapping requests double-count a view and duplicate the visitor row

- **Severity**: low
- **Confidence**: high for the race; medium for how often it is triggered
- **Where**: `src/lib/gamification/visits.ts:16-33`; schema `supabase/migrations/0003_gamification.sql:97-108`
- **Code**:
  ```ts
  const { count, error } = await supabase.from("profile_visits")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", profileId).eq("ip_hash", ipHash).gte("created_at", since);
  if (error) { ... return false; }
  if ((count ?? 0) > 0) return false;
  const { error: insertError } = await supabase.from("profile_visits")
    .insert({ profile_id: profileId, visitor_id: visitorId, ip_hash: ipHash });
  if (insertError) return false;
  const { error: bumpError } = await supabase.rpc("bump_view_count", { p_profile_id: profileId });
  ```
- **Why it is wrong**: the counter itself is now atomic, but the **dedup** is not: two requests for the same profile from the same IP that overlap between the `select` and the `insert` both read `count = 0`, both insert, and both bump — one visitor yields `+2` views and two identical rows in the owner-only visitor list. There is no `unique (profile_id, ip_hash, …)` (only the non-unique `profile_visits_dedup_idx`), so nothing absorbs the second insert. Reachable when two requests for the same profile URL are in flight together — a Next `<Link>` prefetch (the profile pages link to each other) racing the navigation, or the same URL opened twice. The same pattern exists in `recordBlogView` (`visits.ts:53-82`).
- **How to reproduce**: by inspection + a concurrency probe: fire two simultaneous `GET /en/profile/<x>` with the same cookie/IP and then `select count(*) from profile_visits where profile_id=<x> and ip_hash=<h> and created_at > now() - interval '1 minute'` → 2, and `view_count` up by 2.
- **Suspected cause**: dedup enforced by application-level check-then-insert where a unique index (or an insert-on-conflict) is the only atomic form.

---

## B7 — a failed or successful save in either account form is conveyed by an unlabelled glyph with no live region

- **Severity**: low
- **Confidence**: high
- **Where**: `src/components/account/AccountSettings.tsx:237-242` and `src/components/account/ProfileCustomizer.tsx:318-319`
- **Code**:
  ```tsx
  {state === "saving" ? t("saving") : t("save")}
  ...
  {state === "saved" && <span className="text-sm font-semibold text-success">{t("saved")}</span>}
  {state === "error" && <span className="text-sm font-semibold text-danger">✗</span>}
  ```
- **Why it is wrong**: the failure state is a lone `✗` — no text, no `role="status"`/`role="alert"`, no `aria-live` — and it auto-clears after 3 s (`setTimeout(…, 3000)`). A screen-reader user who presses Save gets no announcement that it failed (the button text returns to “Save” and nothing else changes), so they cannot distinguish “saved” from “my profile edits were rejected”; the same is true for the success state. The `✗` glyph is also the only failure affordance for sighted users, with no reason shown (the route's error body is discarded at `AccountSettings.tsx:67`).
- **How to reproduce**: with a screen reader, submit either form with the network offline — nothing is announced and the visual state reverts after 3 s.
- **Suspected cause**: status conveyed by colour/glyph without an accessible name or a live region.

---

## Checked and deliberately not reported

- **CSS/URL injection through `profile.banner_url`** (rendered as `backgroundImage: url(${profile.banner_url})` at `page.tsx:344-349`): not a defect. The column is validated to a `^https?://` prefix only, but React applies `style.backgroundImage` through the CSSOM's per-property setter, which *drops* a value that does not parse as a single image — a `"); …` suffix cannot close the `url()` and add declarations. (Round 29 reached the same conclusion, for a different reason.)
- **i18n**: all `t("…")` keys in the eight in-scope files exist in all eleven locales, and the four placeholder-bearing keys used here are placeholder-identical across them. No `MISSING_MESSAGE`, no drift.
- **Service-role / env-helper boundary**: no `"use client"` module imports `@/lib/supabase/admin`, and none imports `@/lib/env` or calls `envOr(` — the static-`process.env` rule is respected everywhere in scope (`browser.ts:9-10`).
- **Server-only var reads** (`server.ts`, `admin.ts`, `session.ts` use `envOr`): safe — all three import `next/headers`/`node:crypto` and cannot be bundled for the browser; `browser.ts` is the only client client and reads its vars as static member expressions.
- **Session handling**: every route/page in scope uses `auth.getUser()` (never `getSession()`) except the auth-callback error path, which uses `getSession()` client-side merely to decide “navigate or show the error” — correct. `proxy.ts` refreshes once per request and re-issues the rotated cookies on both the i18n and API responses; the `sb-` cookie-name gate and the extension-excluding matcher look right.
- **`isUserBanned`** swallows read errors as “not banned” (`admin.ts:355-370`) — but it is polled by `/api/account` and `/api/inventory/sync` only, and the `bans` table is only written by the panel; deliberately not reported.
- **Phantom write on `/api/account`** (an `UPDATE … eq(id)` with 0 matched rows returns `{ok:true}`, `route.ts:99-106`): unreachable in practice — `handle_new_user` inserts a profile for every `auth.users` row (`0001:156-199`), so a signed-in member always has a row.
- **`profile.is_admin`** is declared non-optional on `ProfileRow` (`queries.ts:53`) but not in `PROFILE_PUBLIC_COLUMNS`, so at runtime it is `undefined`; no reader exists today. A latent trap, not a live defect.
- **`GQL_CLIENT_ID`, the hard-coded Twitch web client id** (`perfil.ts:10`): public by design, and the login is regex-validated (`^[a-z0-9_]{3,25}$`) before either fetch.
- **`inventory.ts`'s comment claims potat's `color` is applied** (`:175-176`) while the patch (`:181-185`) never writes it — a stale comment, not a behaviour defect (the member's own `profiles.color` is what the profile renders).
