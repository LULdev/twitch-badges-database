# Panel shell, role badges, admin client behaviour & i18n

Audited (read in full): `src/components/admin/AdminShell.tsx`,
`src/components/admin/AdminGate.tsx`, `UsersPanel.tsx`, `ContentPanel.tsx`,
`BadgesPanel.tsx`, `SyncPanel.tsx`, `SettingsPanel.tsx`, `StatsPanel.tsx`,
`StatusPanel.tsx`, `NewsletterPanel.tsx`, `BrainstormPanel.tsx`, `AuditPanel.tsx`,
`src/components/RoleBadge.tsx`, `src/lib/roles.ts`,
`src/app/[locale]/admin/page.tsx`; plus read-only peeks at `src/lib/admin-content.ts`
and `supabase/migrations/0025..0028` for contract checks.

Method: full read of every file above; mechanical i18n diff of the `admin` and
`roles` namespaces across all eleven `messages/*.json` (key sets + `{placeholder}`
sets, then a check that every key the components actually use exists in `en.json`);
`SELECT` queries against the live DB for badge `category`/`status`, changelog
`kind` and newsletter `channel` distinct values (via the session pooler in
`.env.local`, the `postgres` npm client, read-only). Did not run
`tsc`/`eslint` (not needed for the defects below). Did not modify anything.

## i18n result — nothing found (stated so "nothing" is meaningful)

- `admin` and `roles` are **key-identical across all eleven locales** and every
  message's placeholder set matches `en` exactly (`{role}`, `{count}`,
  `{reason}/{until}`, `{username}`, `{avg}`, `{time}`, `{channel}/{sent}/{failed}`).
- Every key used by the files above — including the dynamically built ones
  (`admin.users.field.${key}`, `admin.users.progress.${key}`,
  `admin.settings.economy.${label}`, `admin.settings.features.${key}`,
  `admin.sync.${target}.title|hint`, `admin.stats.kpi.${key}`,
  `admin.tabs.${...}`, `roles.${role}` / `roles.${role}Hint`) — resolves in
  `en.json`. No missing key, no extra key, no placeholder mismatch, no raw
  `{n}`-would-render case. The `admin.title`, `forbidden.*`, `gate.*`, `setup.*`
  keys used by `page.tsx` / `AdminGate` all exist.
- All eleven locales listed above were compared; no locale differed.

## B1 — Badge category `<select>` cannot represent 10 of the 12 live categories

- **Severity**: medium
- **Confidence**: high (option list read + live DB distinct values queried)
- **Where**: `src/components/admin/BadgesPanel.tsx:31` (list) and `:196` (the `<select>`)
- **Code**:
  ```tsx
  const CATEGORIES = ["events","subscriptions","bits","achievements","predictions","other"] as const;
  // ...
  <select className="input mt-1 w-full" value={editing.category}
          onChange={(e) => setEditing({ ...editing, category: e.target.value })}>
    {CATEGORIES.map((category) => (<option key={category} value={category}>{category}</option>))}
  </select>
  ```
- **Why it is wrong**: the live catalog's real categories are
  `events(371), bits(32), esports(21), twitchcon(19), rewards(8), subscriber(8),
  drops(5), recap(3), subtember(3), hype-train(3), premium(2), pride(1)`
  (quoted from the DB). Only `events` and `bits` have a matching `<option>`, so a
  provider badge filed under any of the other ten cannot be shown or re-selected:
  the control renders blank (no matching option) while `editing.category` still
  holds the true value. The operator sees a wrong/empty category, and the moment
  they touch the select they silently overwrite the real value with one of the six
  custom-badge buckets. The catalog sync will keep re-deriving from Helix, so this
  produces a confusing edit surface for the majority of badge rows, not a rare
  corner. (The server does not validate the category — `CUSTOM_BADGE_CATEGORIES`
  in `src/lib/admin-content.ts:197` is exported but never imported anywhere — so
  the panel's list is the only constraint, and it does not match the data.)
- **How to reproduce**: Badges tab → uncheck "Custom only" → Edit a row whose
  category is e.g. `esports` (21 such rows) → the Category select shows no/blank
  selection and lists none of the row's real value.
- **Suspected cause**: the option list is the *custom-badge* taxonomy, reused
  as-is in the editor for provider rows whose taxonomy is different.

## B2 — Users panel detail drawer can show the wrong member (response race)

- **Severity**: medium
- **Confidence**: high (by inspection)
- **Where**: `src/components/admin/UsersPanel.tsx:113`
- **Code**:
  ```tsx
  const openDetail = useCallback(async (id: string) => {
    setSelected(id);
    setDetail(null);
    setError(null);
    try {
      const [detailRes, achRes] = await Promise.all([
        fetch(`/api/admin/users?id=${id}`),
        fetch(`/api/admin/users/achievements?userId=${id}`),
      ]);
      if (!detailRes.ok) throw new Error("detail");
      setDetail((await detailRes.json()) as Detail);   // no check that `id` is still selected
      ...
  ```
- **Why it is wrong**: clicking member A and then member B before A's fetch
  resolves lets A's late response call `setDetail(...)`, so the drawer (which
  keys edits by `detail.profile.id`) shows A's profile, role, ban and progress
  while row B is highlighted. The operator can then "Save profile" / "Apply
  role" / "Ban" against the member they are *not* looking at — a mutation on the
  wrong user. There is no request token, no `AbortController`, and no
  `if (id === selectedRef.current)` guard.
- **How to reproduce**: on a cold list, click two rows in quick succession (or on
  a slow connection); the drawer's name/id will disagree with the highlighted row.
- **Suspected cause**: last-response-wins; the fetch result is not tied to the
  selection that requested it.

## B3 — Member rows are click-only: the whole editor is keyboard-unreachable

- **Severity**: medium
- **Confidence**: high (by inspection)
- **Where**: `src/components/admin/UsersPanel.tsx:210`
- **Code**:
  ```tsx
  <tr key={user.id} onClick={() => void openDetail(user.id)}
      className={`cursor-pointer ${selected === user.id ? "bg-surface-2" : ""}`}>
  ```
- **Why it is wrong**: opening the member drawer is the *only* way to reach the
  profile/progress/role/ban/achievement/delete controls, and it is wired solely
  to `<tr onClick>` with no `role`, `tabIndex`, keyboard handler, or an in-row
  Edit button. A keyboard-only operator cannot open any member at all — the
  panel's core function is unusable without a mouse. (`AuditPanel` and every
  other list provide a button; only this one does not.)
- **How to reproduce**: Tab through the Users panel — no member row ever receives
  focus, so the drawer never opens.
- **Suspected cause**: the row was made interactive visually (`cursor-pointer`,
  `onClick`) without a focusable control inside it.

## B4 — Badges panel "Edit" fails silently

- **Severity**: low
- **Confidence**: high (by inspection)
- **Where**: `src/components/admin/BadgesPanel.tsx:161`
- **Code**:
  ```tsx
  onClick={async () => {
    const res = await fetch(`/api/admin/content?resource=badges&id=${badge.id}`);
    if (res.ok) setEditing((await res.json()) as BadgeFull);
  }}
  ```
- **Why it is wrong**: when the detail fetch is not `ok` (403/404/500, network
  hiccup) nothing happens — no `setError`, no state change. The operator clicks
  Edit and the editor simply never appears, with no indication that a request
  failed; it looks like a dead button. (The list endpoint's errors *are* surfaced,
  which makes this one stand out as the panel's only silently-swallowed failure.)
- **How to reproduce**: make `/api/admin/content?resource=badges&id=…` return
  non-200 (e.g. hover the route and force a 500) and click Edit — silence.
- **Suspected cause**: `if (res.ok)` with no `else` branch.

## B5 — Create/save buttons have no in-flight guard: double-submit duplicates a create

- **Severity**: medium
- **Confidence**: medium (by inspection; the second POST is certain, the concrete
  server outcome depends on the route)
- **Where**: `src/components/admin/ContentPanel.tsx:241` (Blog save),
  `src/components/admin/BadgesPanel.tsx:240` (badge save),
  `src/components/admin/BrainstormPanel.tsx:190` (idea save); also
  `SettingsPanel.tsx:148,171,196,284` (the four `save()` buttons)
- **Code** (`ContentPanel.tsx`):
  ```tsx
  <button type="button" className="btn btn-primary px-3 py-1.5 text-xs"
    onClick={async () => {
      const { ok, error } = await call({ resource: "blog", action: "save",
        id: editing.id || undefined, input: { slug: editing.slug, ... } });
      if (ok) { setNotice(t("saved")); setEditing(null); await load(); }
      else setError(error ?? t("saveFailed"));
    }}>
    {t("save")}
  </button>
  ```
- **Why it is wrong**: no `busy`/`disabled` state (unlike `AdminGate`,
  `SyncPanel`, `StatusPanel` and `NewsletterPanel`, which all guard). Two clicks
  before the first response fires the mutation twice. For a **new** entry the
  payload is `id: undefined` both times, so the server performs two creates with
  the same derived slug — and `blog_posts.slug` is `UNIQUE`
  (`blog_posts_slug_key`, verified in the DB), so the second request errors while
  the first reported success, leaving a contradicting error banner after a
  "saved" notice. Same shape for badges (`badges_set_id_version_key` is UNIQUE —
  a new custom badge defaults to `set_id="custom-"`, `version="1"`) and for ideas.
  The `SettingsPanel` `save()` buttons re-POST the whole section on a double
  click with no guard at all.
- **How to reproduce**: open New entry, fill the title, double-click Save quickly;
  observe two POSTs (network tab) and a "saved" + error combination.
- **Suspected cause**: the async handler has no `busy` flag; the panels that do
  guard show the pattern was simply not applied here.

## B6 — Content panel shares error/notice between the Blog and Changelog sub-tabs

- **Severity**: low
- **Confidence**: high (by inspection)
- **Where**: `src/components/admin/ContentPanel.tsx:54` (state) and `:74` (render)
- **Code**:
  ```tsx
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // ...
  {error ? <p className="text-sm text-danger">{error}</p> : null}
  {notice ? <p className="text-sm text-success">{notice}</p> : null}
  {tab === "blog" ? <BlogAdmin setError={setError} setNotice={setNotice} />
                  : <ChangelogAdmin setError={setError} setNotice={setNotice} />}
  ```
- **Why it is wrong**: the banner lives in the parent, so an error raised by the
  Blog tab (e.g. `content.loadFailed`) stays on screen after switching to the
  Changelog tab, where it is false context — and vice-versa. Nor is it cleared on
  tab switch. Minor, but it reports a failure against the wrong section.
- **How to reproduce**: trigger a blog load failure, switch to Changelog — the
  blog error is still shown above the changelog table.
- **Suspected cause**: one shared error/notice pair for two independent sub-views.

## B7 — Numeric fields coerce an empty string to 0, so they cannot be blank

- **Severity**: low
- **Confidence**: high (by inspection)
- **Where**: `src/components/admin/UsersPanel.tsx:377` (`steal_price`/`steal_max`),
  `:421` (progress xp/coins/level/login_streak), `SettingsPanel.tsx:184` (economy)
- **Code**:
  ```tsx
  value={progress[key] ?? 0}
  onChange={(event) => setProgress((p) => ({ ...p, [key]: Number(event.target.value) }))}
  ```
- **Why it is wrong**: `Number("") === 0`, so clearing the field instantly
  rewrites the value to `0` instead of leaving it empty. The input can never
  represent "no value" (the underlying columns are nullable ints surfaced as
  `?? 0`), and the operator cannot blank a field before typing a replacement —
  the caret-typing flow always round-trips through `0`. Low impact (the next
  keystroke recovers a sane value), but it is the representability defect in
  this panel set.
- **How to reproduce**: focus the XP field, select-all, press Backspace — the
  field shows `0`.
- **Suspected cause**: `Number("")` fallback rather than an empty-string state.

## Checked and found clean (so the negatives are meaningful)

- **Shell/tabs** (`AdminShell.tsx`): every `TABS` entry has `ready: true` and the
  `setTab` setter only ever receives ids present in `TABS`, so the
  `!TABS.find(...)?.ready` "soon" fallback is unreachable and no tab renders
  nothing; every mapped list has a `key`; `aria-current` on the active tab.
- **`window.confirm` guards**: all five delete/send guards
  (`UsersPanel:569`, `ContentPanel:278,443`, `BadgesPanel:282`,
  `NewsletterPanel:218,234`, `BrainstormPanel:146`) are inside the button's click
  handler on `type="button"` controls that are not inside any `<form>` — no
  keyboard `Enter`-submit or programmatic path bypasses them.
- **Role badges**: `RoleBadge.tsx` `t(role)` / `t(\`${role}Hint\`)` cover all
  three `StaffRole`s and all six `roles.*` keys exist in every locale; the SVGs
  are `aria-hidden` with a `title` on the wrapper.
- **Changelog `kind` select** (`ContentPanel.tsx:31`) matches the live
  `changelog.kind` values exactly (`blog, bugfix, data_sync, feature,
  badge_updated, badge_added`); **badge `status`** select matches the check
  constraint (`active, upcoming, expired, removed`); **newsletter `channel`**
  matches `push|email|both`; **idea categories** match migration 0028's
  thirteen values; **blog `status`** matches `draft|published`.
- `t` from `useTranslations` is `useMemo`-memoized in next-intl 4.14.5
  (`use-intl/dist/esm/development/react.js:74`), so the `[load]` effects that list
  `t` as a dependency do **not** loop.
- No missing `key` in any mapped list; no unmount-time `setState` that leaks
  (React 18 ignores it and no `fetch` can be written back to a dead component);
  no `useEffect` with a wrong/missing dependency that causes a refetch loop.
