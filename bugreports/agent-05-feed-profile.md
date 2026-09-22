# Bug report — bug-hunter #5 "feed-profile-ui"

Scope: feed page, profile page, FeedList, StealPanel, CoinRainButton, DailyClaim, ProfileCustomizer, AccountSettings.

## fp-1: Visiting your own profile counts as a view and logs you as a visitor
- **Severity**: medium
- **Side**: server
- **File**: src/app/[locale]/profile/[username]/page.tsx:87 (and src/lib/gamification/visits.ts:9)
- **Evidence**: `await recordProfileVisit(profile.id, viewer?.id ?? null, ipHash).catch(() => false);` — called unconditionally; `isOwn` (line 81) is never consulted. `recordProfileVisit` dedups only on `ip_hash`, with no `visitorId === profileId` guard.
- **Why it is a bug**: A logged-in user opening their own profile inserts a `profile_visits` row with `visitor_id = themselves`, so their own avatar shows in their own "latest visitors" list and their `view_count` is bumped by self-views.
- **Confidence**: confirmed
- **Fix direction**: Skip the call when `isOwn` is true (or ignore self in `recordProfileVisit`).

## fp-2: Visitor list publicly leaks visitor identities on every profile
- **Severity**: high
- **Side**: server
- **File**: src/app/[locale]/profile/[username]/page.tsx:89-98, rendered at :416-439
- **Evidence**: Query `profile_visits.select("visitor:profiles(username, avatar_url)").eq("profile_id", profile.id).not("visitor_id","is",null).limit(12)` is rendered inside a public `{profile && (...)}` section with no `isOwn` check.
- **Why it is a bug**: Anyone (including logged-out users) can see the usernames/avatars of the last 12 identified visitors to any profile — a deanonymising privacy leak, and it is also shown to the profile owner (should at least be owner-only).
- **Confidence**: confirmed
- **Fix direction**: Gate the visitor list behind `isOwn`, or only expose it in aggregate counts.

## fp-3: Most ProfileCustomizer settings are stored but never applied to any page
- **Severity**: medium
- **Side**: shared
- **File**: src/components/account/ProfileCustomizer.tsx:148 (saves `customization: values`)
- **Evidence**: `customization: values,` persists the whole document; the only reader is `src/app/[locale]/account/page.tsx` (to re-populate the editor) and `achievements.ts`. The public profile page never reads `customization` — no use of `cardStyle`, `font`, `radius`, `nameGradient`, `avatarFrame`, `showStats`, `showInventory`, `showLevel`, `showCoins`, `showVisitors`, `density`, `aura`, `particles`, `profileTheme`, etc.
- **Why it is a bug**: The "15 creative + 20 common settings" appear to work (save succeeds) but change nothing; e.g. turning off `showVisitors` still shows visitors (see fp-2), `showStats` off still shows the stats grid.
- **Confidence**: confirmed
- **Fix direction**: Apply the document on the profile page, or remove the dead controls.

## fp-4: `seenIds` Set in FeedList grows without bound
- **Severity**: low
- **Side**: client
- **File**: src/components/FeedList.tsx:40,50
- **Evidence**: `const seenIds = useRef(new Set<number>(...));` … `for (const event of fresh) seenIds.current.add(event.id);` — ids are added but never pruned, while `events` is bounded (`slice(0, 60)`).
- **Why it is a bug**: On a long-lived `/feed` tab (5s polling), the Set accumulates every event id ever seen for the session — an unbounded memory leak that the `events` cap does not bound.
- **Confidence**: confirmed
- **Fix direction**: Bound `seenIds` (e.g. keep only ids present in `events`) or drop it in favour of id comparison against `events`.

## fp-5: FeedList relative-time hydration mismatch (`Date.now()` in render state)
- **Severity**: low
- **Side**: client
- **File**: src/components/FeedList.tsx:42,59,72-76
- **Evidence**: `const [nowTick, setNowTick] = useState(() => Date.now());` and `timeAgo` uses `nowTick` during render (`Math.floor((nowTick - new Date(iso).getTime())/1000)`); the correcting `requestAnimationFrame` only runs after hydration.
- **Why it is a bug**: The server-rendered HTML computes `timeAgo` with the server clock; the hydration render recomputes with the client clock, producing mismatched text (React hydration warning) whenever a time bucket boundary falls between the two.
- **Confidence**: likely
- **Fix direction**: Initialize `nowTick` to a server-supplied timestamp passed as a prop, or render relative times only after mount.

## fp-6: StealPanel shows hardcoded English error and an emoji
- **Severity**: low
- **Side**: client
- **File**: src/components/StealPanel.tsx:44,53
- **Evidence**: `setResult("Network error");` and `🥷 {t("hint", ...)}`.
- **Why it is a bug**: The network-failure string is untranslated and shown verbatim in all 11 locales (AGENTS.md: all UI strings go through `messages/<locale>.json`); the 🥷 emoji violates the "No emojis in UI; inline SVG icons" convention.
- **Confidence**: confirmed
- **Fix direction**: Add a `steal.networkError` message key and replace the emoji with an inline SVG.

## fp-7: DailyClaim shows "+undefined XP" on server errors
- **Severity**: medium
- **Side**: client
- **File**: src/components/DailyClaim.tsx:21-23
- **Evidence**: `const data = (await res.json()) as {...}; setReward(data); setState("done");` — only `429` is special-cased; any other non-OK response (500, etc.) is parsed as if it were a reward payload.
- **Why it is a bug**: A 500 returns `{error:...}`, so the button flips to "done" and renders `+undefined XP · +undefined <Coin> · streak: undefined`, falsely implying the daily was claimed.
- **Confidence**: likely
- **Fix direction**: Check `res.ok` (and `data.xp != null`) before setting `done`; revert to `idle` on failure.

## fp-8: CoinRainButton reports success on server failure and disables retry
- **Severity**: medium
- **Side**: client
- **File**: src/components/CoinRainButton.tsx:21,49,53
- **Evidence**: `setState(data.ok ? "done" : "again");` then `disabled={state === "busy" || state === "done" || state === "again"}` and both states render `✓`.
- **Why it is a bug**: When the API answers `{ok:false}` (rate limit, target disabled, etc.) the button becomes permanently disabled and shows a check-mark, so the user believes the gift succeeded and cannot retry without a reload.
- **Confidence**: likely
- **Fix direction**: Treat non-ok as a plain failure: revert to `idle` (or show an error) instead of a disabled `✓`.

## fp-9: AccountSettings showcase title hardcodes English "— remove"
- **Severity**: low
- **Side**: client
- **File**: src/components/account/AccountSettings.tsx:178
- **Evidence**: ``title={`${badge?.title ?? slug} — remove`}``
- **Why it is a bug**: "remove" is not routed through `messages/<locale>.json`, so every locale sees an English tooltip.
- **Confidence**: confirmed
- **Fix direction**: Use a `t("remove")` key.

## fp-10: DailyClaim uses 🎁 emoji in UI
- **Severity**: low
- **Side**: client
- **File**: src/components/DailyClaim.tsx:42,49,58
- **Evidence**: `🎁 ${t("dailyClaim")}` and `<span className="text-3xl">🎁</span>`
- **Why it is a bug**: Violates the project convention "No emojis in UI; inline SVG icons".
- **Confidence**: confirmed
- **Fix direction**: Replace with an inline SVG gift icon.

## fp-11: `customization` document stored raw and unbounded
- **Severity**: low
- **Side**: server
- **File**: src/app/api/account/route.ts:51-53
- **Evidence**: `if (body.customization && typeof body.customization === "object") { patch.customization = body.customization; }` — no size cap, no key whitelist, no per-value slice (unlike `display_name`/`bio`/`color`/`banner_url` which are validated above).
- **Why it is a bug**: While the shipped client only sends the fixed 35-field object, a crafted request can persist an arbitrarily large / arbitrary-shaped JSON blob (the 120-char limits are client-only `maxLength`), bloating the row and any future renderer that trusts it.
- **Confidence**: confirmed
- **Fix direction**: Whitelist the known keys and clamp each value's length server-side before storing.