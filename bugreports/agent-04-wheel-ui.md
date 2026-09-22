# Bug report — agent-04 "wheel-ui"

Scope: `src/components/WheelOfFortune.tsx`, `src/app/[locale]/wheel/page.tsx`,
`src/app/api/wheel/spin/route.ts`, `src/lib/gamification/wheel.ts`
(plus read-only checks of migration 0007/0008 and `messages/en.json`).

Verified sound (not bugs): the server picks the slot (`data.slot.id` is used, the
client never chooses); the landing math `360*6 + (360 - index*45 - 22.5)` puts the
pointer on the awarded segment including the turbo segment; the client `SEGMENTS`
xp/coins match `WHEEL_SLOTS` exactly; `claim_wheel_gate` returns `boolean` and
`if (!gate.data)` reads it correctly; `TURBO_PROBABILITY` is exactly `0.00000001`.

## wheel-1: Spin button never disables after the daily spin is used
- **Severity**: high
- **Side**: client
- **File**: src/components/WheelOfFortune.tsx:102
- **Evidence**: `disabled={spinning}` (no post-spin state; after `setSpinning(false)` in the 4200ms timeout the button is enabled again).
- **Why it is a bug**: `spinning` only covers the 4s animation. Once the result card shows, the button is active again, so the user can click repeatedly; each click re-POSTs and only then learns the spin is used (429).
- **Confidence**: confirmed
- **Fix direction**: add `const [spunToday, setSpunToday] = useState(false)`, set it on success and on the `already` error, and use `disabled={spinning || spunToday}`.

## wheel-2: Wheel does not reflect the "already spun today" state on page load
- **Severity**: high
- **Side**: client
- **File**: src/components/WheelOfFortune.tsx:29-40
- **Evidence**: component state starts `spinning=false, result=null, error=null`; there is no initial fetch of the user's spin status.
- **Why it is a bug**: a returning user who already spun loads a fully active wheel with no indication; the "already spun today" state (`t("already")`) is only reachable by burning a request. Server state and first paint disagree.
- **Confidence**: confirmed
- **Fix direction**: expose the gate (`user_progress.last_wheel_date`) through a GET/loader and initialise `spunToday`, or render the disabled/"come back tomorrow" state server-side.

## wheel-3: Turbo win can be recorded nowhere while the UI still claims the jackpot
- **Severity**: high
- **Side**: server
- **File**: src/lib/gamification/wheel.ts:72-101
- **Evidence**: `await supabase.from("turbo_wins").insert({ user_id: userId });` — the returned `{ error }` is never inspected, and `logActivity(...)` is awaited outside any `try` (only `createFeaturePost` has `.catch(() => undefined)`).
- **Why it is a bug**: `award()` at line 62 has already granted 5000 XP / 50000 coins before the turbo bookkeeping runs. A Supabase `.insert()` resolves `{ data, error }` on a DB error instead of rejecting, so an FK/RLS failure is silently discarded: the client receives `turboWon: true` and shows the jackpot card, while `turbo_wins` has no row (and a `logActivity` failure aborts before the blog post/feed entry without any signal).
- **Confidence**: likely
- **Fix direction**: check `error` on every turbo write, `try/catch` the block, and only return `turboWon: true` after the record commits (or grant the award after the record).

## wheel-4: Unguarded server throw + unchecked response burns the daily spin
- **Severity**: medium
- **Side**: shared
- **File**: src/app/api/wheel/spin/route.ts:9-11 ; src/lib/gamification/wheel.ts:47-70 ; src/components/WheelOfFortune.tsx:42-48
- **Evidence**: route `const result = await spinWheel(userId);` with no `try`; client does `const data = (await res.json()) as …` and only branches on `"error" in data` — `res.ok` / status is never checked.
- **Why it is a bug**: `claim_wheel_gate` commits `last_wheel_date = today` and `wheel_spins + 1` *before* `award()`/turbo writes. If anything after the gate rejects, the route 500s (or returns a body without `error`), the client shows "Network error", and the user's one daily spin is consumed with no reward.
- **Confidence**: likely
- **Fix direction**: wrap the post-gate work in `try/catch`, and have the client handle `!res.ok` generically instead of assuming a JSON `error` field.

## wheel-5: Hardcoded English and emoji in the UI
- **Severity**: medium
- **Side**: client
- **File**: src/components/WheelOfFortune.tsx:68,97,108,110 ; src/app/[locale]/wheel/page.tsx:35
- **Evidence**: `▼` (68); `SPIN` (97); `{result.turbo ? "🎁 TWITCH TURBO!" : result.label}` (108); segment labels `"TURBO"` / `"+25 XP"` (23); page `<h1>🎡 {t("title")}</h1>` (35). Also raw server strings surfaced directly: `setError(data.error)` renders `"not authenticated"` (47) and `setError("Network error")` (61).
- **Why it is a bug**: AGENTS.md requires all UI strings in `messages/<locale>.json` and "No emojis in UI; inline SVG icons". On the 10 non-English locales these strings stay English, and errors are shown as untranslated server codes.
- **Confidence**: confirmed
- **Fix direction**: move "SPIN"/"TURBO"/labels/errors into the `wheel` namespace (and reuse `feed.turbo_win`), replace the emoji with inline SVG, and map error codes to keys.

## wheel-6: turbo slot `weight` contradicts the real probability (dead but misleading)
- **Severity**: low
- **Side**: server
- **File**: src/lib/gamification/wheel.ts:28,31,60
- **Evidence**: `{ id: "turbo", …, weight: 0.0000001, turbo: true }` vs `const TURBO_PROBABILITY = 0.00000001;` and `turboWon ? WHEEL_SLOTS[WHEEL_SLOTS.length - 1] : weightedPick(WHEEL_SLOTS.slice(0, -1))`.
- **Why it is a bug**: the turbo `weight` is 10× the documented probability and is unused (turbo is excluded from `weightedPick`). Any future edit that folds turbo back into the weighted draw would silently give 1:10,000,000 odds instead of 1:100,000,000.
- **Confidence**: confirmed
- **Fix direction**: drop the `weight` from the turbo slot (or set it to `TURBO_PROBABILITY`) and comment that turbo is drawn separately.

## wheel-7: Number formatting forced to English in all locales
- **Severity**: low
- **Side**: client
- **File**: src/components/WheelOfFortune.tsx:110
- **Evidence**: `+{result.coins.toLocaleString("en")}`
- **Why it is a bug**: the site ships 11 locales; coins are always formatted with the English locale (and `+` is hardcoded), so e.g. locale-specific separators never apply.
- **Confidence**: confirmed
- **Fix direction**: format with the active locale from `useLocale()` and localise the prefix.

## wheel-8: Winner is told "already spun today" if the progress row is missing
- **Severity**: low
- **Side**: server
- **File**: src/lib/gamification/wheel.ts:47-54
- **Evidence**: `claim_wheel_gate` is `update public.user_progress … where user_id = p_user_id and last_wheel_date is distinct from p_today; return claimed > 0;` (migration 0007:81-99) — an UPDATE that matches zero rows returns `false` → `{ ok: false, reason: "already" }` → 429 `already-spun-today`.
- **Why it is a bug**: a user with no `user_progress` row yet (row not provisioned) is permanently told they already spun, with no way to claim the daily spin, instead of "not spun".
- **Confidence**: unconfirmed
- **Fix direction**: upsert the progress row before/inside the gate, or insert-if-absent then re-run the compare-and-set.

## wheel-9: Result card omits the XP that the slot promised
- **Severity**: low
- **Side**: client
- **File**: src/components/WheelOfFortune.tsx:108-111 ; src/lib/gamification/wheel.ts:21-28
- **Evidence**: `result.label` (e.g. "+25 XP") is shown only before the spin; the card body renders `+{result.coins} <Coin>` and never `result.xp`, while the server awards both `xp` and `coins`.
- **Why it is a bug**: the user sees only the coin amount for the prize and cannot see the XP actually credited (turbo's XP is likewise invisible), so the UI under-reports the award.
- **Confidence**: confirmed
- **Fix direction**: render both `+{result.xp} XP` and the coin line in the result card.