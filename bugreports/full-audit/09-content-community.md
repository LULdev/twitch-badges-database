# Notifications, content and the community surfaces

Audited: `src/lib/push.ts`, `src/app/api/push/subscribe/route.ts`,
`src/app/api/push/vapid/route.ts`, `src/components/PushToggle.tsx`,
`src/components/ServiceWorkerRegister.tsx`, `public/sw.js`,
`src/app/[locale]/notifications/page.tsx`, `src/lib/blog.ts`,
`src/app/api/blog/react/route.ts`, `src/app/[locale]/blog/page.tsx`,
`src/app/[locale]/blog/[slug]/page.tsx`, `src/lib/changelog.ts`,
`src/app/[locale]/changelog/page.tsx`, `src/app/api/changelog/rss/route.ts`,
`src/app/[locale]/feed/page.tsx`, `src/app/api/feed/route.ts`,
`src/components/FeedList.tsx`, `src/components/LiveRefresher.tsx`,
`src/app/[locale]/achievements/page.tsx`, `src/app/[locale]/leaderboards/page.tsx`,
`src/app/[locale]/compare/page.tsx`, `src/components/compare/CompareForm.tsx`,
`src/app/[locale]/inventory/page.tsx`, `src/app/api/inventory/sync/route.ts`,
`src/lib/inventory.ts`, `src/lib/queries.ts` (relevant selectors),
`src/lib/markdown.ts`, `src/lib/gamification/visits.ts`,
`src/lib/gamification/session.ts`, `supabase/migrations/0001_init.sql`
(schemas/policies), `next-intl` v4 navigation source.

Method: read the files above; mechanically diffed all 11 `messages/*.json`
(keys and `{placeholder}` sets) for the scope namespaces; ran read-only SELECTs
against the live database (grants, `pg_policies`, `notifications`,
`changelog`, `badges`, `user_achievements`, `collector_stats`); executed
next-intl's own `compileLocalizedPathname`/`applyPathnamePrefix` to confirm the
locale-prefixing behaviour. Did not run lint/typecheck/build (collector mode).

---

## B1 — Every notification link 404s: the stored `/en/...` URL gets a second locale prefix

- **Severity**: high
- **Confidence**: high (verified by reading + empirically running next-intl + live row)
- **Where**: `src/app/[locale]/notifications/page.tsx:60-63` (consumer) and `src/lib/syncs/global.ts:393` (producer)
- **Code**:
  ```tsx
  // notifications/page.tsx
  {entry.url ? (
    <Link href={entry.url} className="hover:text-accent">
      {entry.title}
    </Link>
  ) : (
  ```
  ```ts
  // syncs/global.ts
  const url = `/en/badges/${first?.slug ?? ""}`;
  await recordNotification({ kind: "badge_added", ..., url, tag: "new-badges" });
  ```
- **Why it is wrong**: `Link` here is next-intl's `createNavigation` Link
  (`src/i18n/navigation.ts`), which runs the href through
  `applyPathnamePrefix`. `isLocalizableHref("/en/badges/x")` is true, so with
  `localePrefix: "always"` the active locale is prepended *again*:
  `/en/en/badges/x` for `en`, `/de/en/badges/x` for `de`, … Neither route
  exists, so every notification title leads to a 404. The same URL is correct
  for the service worker (root-relative `client.navigate`), which is why the
  bug is invisible in the push path.
- **How to reproduce**: by inspection/execution — ran next-intl's own function:
  `compileLocalizedPathname({pathname:"/en/badges/some-slug",locale:"de",pathnames:{}})`
  → `applyPathnamePrefix(...)` = `/de/en/badges/some-slug`. Live DB has
  `notifications.url = '/en/badges/rematch-blue-lock-v1'`, i.e. the one
  notification a visitor can click renders as `/en/en/badges/rematch-blue-lock-v1`.
  Manual repro: open `/en/notifications` (or `/de/notifications`) and click the
  badge-added title.
- **Suspected cause**: the producer stores a locale-prefixed URL where the
  consumer expects a locale-less pathname. Fix by storing `/badges/<slug>` (the
  push handler still resolves it root-relative relative to the current origin,
  and the page localises it), or by not using the i18n `Link` for that href.

---

## B2 — `push_subscriptions` keeps anon/authenticated INSERT + DELETE grants with permissive policies

- **Severity**: high
- **Confidence**: high (verified live: `role_table_grants` + `pg_policies`)
- **Where**: `supabase/migrations/0001_init.sql:382-388` (policies), and the absent revoke (0001:393-399 revokes only `badges`…`profiles`)
- **Code**:
  ```sql
  alter table public.push_subscriptions enable row level security;
  create policy "push_insert" on public.push_subscriptions
    for insert with check (true);
  create policy "push_self_delete" on public.push_subscriptions
    for delete using (user_id = auth.uid() or user_id is null);
  ```
  Live grants on `public.push_subscriptions`: `anon` = INSERT, DELETE, UPDATE,
  SELECT, TRUNCATE, REFERENCES, TRIGGER (same for `authenticated`). No
  `revoke all … from anon, authenticated` was ever issued for this table, and
  unlike the ACP tables in migration 0029 it was never hardened afterwards.
- **Why it is wrong**: the publishable key is shipped in every browser bundle,
  and PostgREST exposes the `public` schema, so anyone can call the REST API
  directly and (a) `DELETE /rest/v1/push_subscriptions?user_id=is.null` — the
  `push_self_delete` policy matches any anonymous row (anon's `auth.uid()` is
  null), wiping every anonymous push subscriber the site ever collected; and
  (b) `POST /rest/v1/push_subscriptions` with an arbitrary `endpoint` — the
  allow-all `with check (true)` bypasses the endpoint validation the route
  performs (`isAllowedPushEndpoint`), so the next `sendPushToAll` broadcast
  makes the server POST to an attacker-chosen HTTPS host (SSRF) and lets an
  unbounded `endpoint`/`p256dh`/`auth` string be stored. The route itself always
  writes with the service-role client, so neither grant has a legitimate use.
- **How to reproduce**: by live inspection — `information_schema.role_table_grants`
  and `pg_policies` as above. (No write was attempted.) The site currently has
  0 subscriptions, so no data has been lost yet; the hole is live for the next
  anonymous opt-in.
- **Suspected cause**: default Supabase grants on a table created in 0001 that
  the later grant-hardening rounds (0008/0023/0029) did not include.

---

## B3 — `createFeaturePost` is not idempotent for its changelog side effect: re-running a seed duplicates entries

- **Severity**: medium
- **Confidence**: high (verified by reading + live row counts)
- **Where**: `src/lib/blog.ts:78-99`
- **Code**:
  ```ts
  const supabase = createAdminClient();
  const { error } = await supabase.from("blog_posts").upsert(
    { slug: post.slug, ..., is_auto: true, tags: ["feature", ...(post.tags ?? [])] },
    { onConflict: "slug", ignoreDuplicates: true },
  );
  if (error) throw error;
  await supabase.from("changelog").insert({
    kind: "blog",
    title: `Blog post published: ${post.title}`,
    body: post.excerpt,
    payload: { slug: post.slug },
  }).then(() => undefined, () => undefined);
  ```
- **Why it is wrong**: the docblock claims "Idempotent by slug", and the post
  upsert is (it ignores duplicates), but the changelog insert is unconditional
  and has no unique key — so every repeat call writes another
  `Blog post published: …` row for a post that was **not** published again. The
  changelog page and RSS (generated purely from this table) then show the same
  "publication" many times. `scripts/seed-gamification-blog.ts:188` and
  `scripts/seed-xp-research.ts:65` call it in a loop, and any rerun multiplies
  the rows. The changelog lies even on a plain repeated call from
  `wheel.ts:90`.
- **How to reproduce**: by live inspection — `changelog` has 139 rows with
  `kind='blog'` and `title LIKE 'Blog post published:%'` but only **24 distinct
  titles** (each of the ~24 seeded posts has ~6 duplicates; `select title,
  count(*) … group by title` returns `… n=6` for every title).
- **Suspected cause**: idempotency implemented on the post but not on the
  accompanying changelog write (no guard "only when the post did not exist").

---

## B4 — Reaction buttons cannot represent the visitor's existing reaction; the first click un-likes but highlights

- **Severity**: medium
- **Confidence**: high (verified by reading)
- **Where**: `src/components/EmojiReactions.tsx:24,27-52` + `src/app/api/blog/react/route.ts:31-42`
- **Code**:
  ```tsx
  const [active, setActive] = useState<Set<string>>(new Set());
  ...
  const wasActive = active.has(emoji);
  const res = await fetch("/api/blog/react", { method: "POST", body: JSON.stringify({ slug, emoji }) });
  if (!res.ok) return;
  const data = await res.json();
  if (!data.added && !data.removed) return;
  setCounts((prev) => ({ ...prev, [emoji]: Math.max(0, (prev[emoji] ?? 0) + (data.added ? 1 : -1)) }));
  setActive((prev) => { const next = new Set(prev); if (wasActive) next.delete(emoji); else next.add(emoji); return next; });
  ```
  The route's dedup is a permanent `unique (post_id, ip_hash, emoji)`
  (`0003_gamification.sql:127`), and the toggle branch is
  `if (existing) { delete … return { removed: true } }`.
- **Why it is wrong**: `active` starts empty and is never seeded from server
  state, so the button always renders "not reacted" even for a visitor whose row
  already exists. Their first click therefore hits the *delete* branch
  (`removed: true`): the count drops, yet `wasActive` is false so the button
  flips to **highlighted**. The displayed state is exactly inverted for that
  interaction, and is thereafter meaningless (it always becomes highlighted on
  the first click, whichever way the server went). A returning reader can never
  "like" a post they already liked — clicking it removes the like while showing
  it as added.
- **How to reproduce**: react to a post; reload (button un-highlights though the
  row exists); click the same emoji → count decreases by one and the button
  turns highlighted. Or by inspection of the branch above.
- **Suspected cause**: the server never tells the client which reactions belong
  to this visitor, and the client's optimistic state assumes it started from
  "none". (Secondary, same file: `route.ts:31-37` ignores the `existing` SELECT
  error, so a failed lookup falls through to INSERT and a unique violation
  surfaces as a 500 with the raw Postgres message.)

---

## B5 — `/api/push/subscribe` ownership guard fails open when the lookup errors

- **Severity**: low
- **Confidence**: medium (by inspection)
- **Where**: `src/app/api/push/subscribe/route.ts:63-70`
- **Code**:
  ```ts
  const { data: existing } = await admin
    .from("push_subscriptions")
    .select("user_id")
    .eq("endpoint", endpoint)
    .maybeSingle();
  if (existing?.user_id && existing.user_id !== user?.id) {
    return Response.json({ error: "endpoint already registered" }, { status: 409 });
  }
  ```
- **Why it is wrong**: the `error` from `maybeSingle()` is discarded. Supabase
  resolves rather than throws, so on any lookup failure `existing` is `null`,
  the 409 guard is skipped, and the following `upsert(..., { onConflict:
  "endpoint" })` rewrites `user_id` to the caller's (`null` for an anonymous
  request). That is precisely the "re-registering an owned endpoint detaches
  someone else's browser" case the comment above the guard says it prevents —
  an anonymous POST can reassign a signed-in user's endpoint whenever the lookup
  errors.
- **How to reproduce**: by inspection (a transient PostgREST error is hard to
  force locally). The same antipattern is already documented as a real bug class
  in `VERIFIED.md` M7 (`deleteBadge` ignoring its SELECT error).
- **Suspected cause**: destructuring only `data` from a supabase call that
  reports failures through `error`.

---

## B6 — `sendPushToAll` reads subscriptions without paging; PostgREST's 1000-row cap silently drops the rest

- **Severity**: low
- **Confidence**: medium-high (mechanic verified; not triggerable at current data volume — the table is empty)
- **Where**: `src/lib/push.ts:40-43`
- **Code**:
  ```ts
  const { data: subscriptions, error } = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth");
  if (error) throw error;
  ```
- **Why it is wrong**: PostgREST caps a single response at 1000 rows, so once
  the site holds more than 1000 subscriptions the fan-out silently notifies only
  an arbitrary 1000 of them, and the dead-endpoint prune only ever removes
  endpoints it saw. The codebase already fixed exactly this class twice
  (`getCatalogKeys` in `queries.ts:527-549`, and `syncUserInventory`'s catalog
  loop, both with `.range()` paging and a comment saying `.limit()` "was a lie").
- **How to reproduce**: by inspection; `grep -n "range(\|limit(" src/lib/push.ts`
  returns nothing. Cannot be observed while `push_subscriptions` is empty
  (live count: 0).
- **Suspected cause**: single unpaged select on a table expected to stay small.

---

## B7 — Compare page: the column chip shows the full match count while only 48 tiles are rendered

- **Severity**: low
- **Confidence**: high (verified by reading)
- **Where**: `src/app/[locale]/compare/page.tsx:191,195` and `:87-88`
- **Code**:
  ```tsx
  <span className="chip pointer-events-none">{column.rows.length}</span>
  ...
  {column.rows.slice(0, 48).map((row) => ( … ))}
  ```
  ```ts
  fetchUserBadges(a, 120).catch(() => null),
  ```
- **Why it is wrong**: `rows.length` can be hundreds for a two-collector diff
  (a perfil result is unbounded — the second argument to `fetchUserBadges` is
  `revalidate`, **not** a limit; see `src/lib/twitch/perfil.ts:112-121`), yet
  the grid renders at most 48 tiles with no "showing 48 of N" notice and no
  pagination. The page therefore states a number it does not show, and a reader
  comparing two large collections silently sees a truncated diff. The caller's
  `120` reveals the intended a limit that does not exist.
- **How to reproduce**: by inspection; compare two accounts owning more than 48
  global badges and count the tiles against the header chip.
- **Suspected cause**: a display cap added without a corresponding count/badge,
  plus an argument passed on the assumption that it bounds the result.

---

### Checked and found clean (so "nothing" here means something)

- All 11 `messages/*.json` are key-identical for the scope namespaces
  (`notifications`, `blog`, `changelog`, `feed`, `achievements`, `leaderboards`,
  `compare`, `inventory`) and every `{placeholder}` set matches; the
  `changelog.kind` CHECK constraint (`0001_init.sql:247-249`) lists exactly the
  8 kinds rendered with `t(entry.kind)`, and the live data contains no kind
  outside it. `FeedList`'s `t(event.kind)` values are all in the `feed`
  namespace (`FeedKind` in `xp.ts:27-42`).
- `blog_reactions` dedup column set matches the live unique constraint
  `(post_id, ip_hash, emoji)`; `blog_views`/`blog_reactions` grants are
  correctly revoked (migrations 0011/0023/0024 — live grants empty).
- `notifications`, `activity_events`, `blog_posts`, `changelog` are
  SELECT-only for anon with matching public-read policies; `user_inventory`'s
  INSERT/DELETE policies are `user_id = auth.uid()`, so the blanket table
  grants are not reachable by anon; `media`/profile column grants keep
  `twitch_id` out. `collector_stats` is `security_invoker = true` and the
  leaderboard's `inventory_public` filter is honoured by the underlying RLS.
- `markdown.ts` HTML-escapes before applying inline markup, so the
  externally-sourced `title`/`how_to_earn` in auto drop posts cannot inject.
- `recordBlogView` dedup/error handling, `listBadges`/`getCatalogKeys` paging,
  `/api/feed` cursor+limit clamping, `PushToggle`'s service-worker-ready timeout
  and best-effort unsubscribe ordering, and `sw.js` payload/tag defaults are all
  as documented and behave as commented.
- `PUSH` config (`vapid` route, `pushConfigured`), `isAllowedPushEndpoint`
  (rejects non-HTTPS, bare IPs, `localhost`, dot-less hosts), and the DELETE
  route's per-caller ownership filter are consistent.
- The achievements page's `unlocked.size` vs per-category sums can only diverge
  if a retired achievement id is stored; live `user_achievements` holds 13
  distinct ids, all present in `achievements.ts`, none retired — not reported.
