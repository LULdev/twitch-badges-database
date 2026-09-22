# Bug report — agent-06 "profile-steal-ui"

## prof-1: Steal panel still rendered (with a live button) for victims who disabled stealing
- **Severity**: high
- **Side**: client
- **File**: src/app/[locale]/profile/[username]/page.tsx:452-457
- **Evidence**:
```tsx
{profile && !isOwn && (
  <StealPanel
    victim={profile.username}
    price={profile.steal_enabled === false ? 0 : (profile.steal_price ?? 100)}
    maxAmount={profile.steal_max ?? 250}
  />
)}
```
- **Why it is a bug**: The panel is shown unconditionally to every non-owner. When `steal_enabled === false` it is rendered with `price=0` and an enabled "attempt" button (StealPanel.tsx:55). The user sees a free steal offer, clicks, and the server rejects with "This collector disabled stealing." (daily.ts:96). The displayed price (0) also disagrees with the real settings.
- **Confidence**: confirmed
- **Fix direction**: Do not render `StealPanel` when `profile.steal_enabled === false` (or pass the real price and render a disabled/"stealing disabled" state), and mirror the server's clamps (`Math.max(0, price)`, `Math.max(10, maxAmount)`).

## prof-2: All steal error messages are hardcoded English strings shown in the UI
- **Severity**: medium
- **Side**: shared
- **File**: src/app/api/steal/route.ts:11-12 → src/lib/gamification/daily.ts:88,89,96,100,112,121,125
- **Evidence**:
```ts
if (!victimProfile || !victimProfile.id) return { ok: false, error: "Victim not found." };
if (victimProfile.id === thiefId) return { ok: false, error: "You cannot steal from yourself." };
...
return { ok: false, error: "Flood check: wait 5 minutes between attempts on the same collector." };
```
consumed verbatim at src/components/StealPanel.tsx:35 `setResult(data.error);`
- **Why it is a bug**: AGENTS.md requires all UI strings to go through `messages/<locale>.json` across 11 locales. Every steal failure renders an untranslated English sentence in every non-English locale.
- **Confidence**: confirmed
- **Fix direction**: Return stable error codes from `attemptSteal` and translate client-side via `t(...)` keys.

## prof-3: DailyClaim treats every non-429 failure as success and renders undefined values
- **Severity**: medium
- **Side**: client
- **File**: src/components/DailyClaim.tsx:16-23 (render at 36, 58-63)
- **Evidence**:
```ts
const res = await fetch("/api/daily/claim", { method: "POST" });
if (res.status === 429) { setState("already"); return; }
const data = (await res.json()) as { xp: number; coins: number; streak: number };
setReward(data);
setState("done");
```
- **Why it is a bug**: Only 429 is handled. A 401 (logged-out) or 500 returns a JSON body like `{error:…}`; it is cast to the reward shape, so `reward.xp/coins/streak` are `undefined` and the panel renders "+undefined XP · +undefined" while the button is permanently disabled as "done" even though nothing was claimed. The compact title at line 36 renders `+undefined XP · Tag undefined`.
- **Confidence**: confirmed
- **Fix direction**: Check `res.ok` (and validate `typeof data.xp === "number"`) before setting the reward; set an error state otherwise.

## prof-4: CoinRainButton reports a false ✓ and permanently disables on any `ok:false`
- **Severity**: medium
- **Side**: client
- **File**: src/components/CoinRainButton.tsx:20-22,49,53
- **Evidence**:
```ts
const data = (await res.json()) as { ok: boolean; already?: boolean };
setState(data.ok ? "done" : "again");
...
disabled={state === "busy" || state === "done" || state === "again"}
```
- **Why it is a bug**: `coinRain` returns `{ ok: false }` for a non-existent owner (daily.ts:207) and `{ ok: false, already: true }` for a repeat. The client lumps both into "again", which renders `<Coin/> ✓` exactly like a successful gift (line 53) and permanently disables the button — the user is told the coin was sent when the server never granted it. The `already` flag is ignored.
- **Confidence**: confirmed
- **Fix direction**: Distinguish `already` from generic failure; only show ✓ for `ok`/`already`, show a retryable error state for other failures.

## prof-5: Emoji in UI (project forbids emoji, requires inline SVG)
- **Severity**: low
- **Side**: client
- **File**: src/components/StealPanel.tsx:53; src/components/DailyClaim.tsx:42,49
- **Evidence**:
```tsx
🥷 {t("hint", { price: price.toLocaleString("en"), max: maxAmount.toLocaleString("en") })}
...
: `🎁 ${t("dailyClaim")}`   /   <span className="text-3xl">🎁</span>
```
- **Why it is a bug**: AGENTS.md: "No emojis in UI; inline SVG icons." The ninja and gift emoji are hardcoded outside i18n and violate the design rule.
- **Confidence**: confirmed
- **Fix direction**: Replace with inline SVG icons (or an existing icon component).

## prof-6: Hardcoded strings outside i18n ("Network error", "Tag")
- **Severity**: low
- **Side**: client
- **File**: src/components/StealPanel.tsx:44; src/components/DailyClaim.tsx:36
- **Evidence**:
```ts
} catch { setResult("Network error"); }
...
title={reward ? `+${reward.xp} XP · Tag ${reward.streak}` : undefined}
```
- **Why it is a bug**: Both are user-visible strings that bypass `messages/<locale>.json`, so they stay English/German ("Tag" = day in German) in all 11 locales.
- **Confidence**: confirmed
- **Fix direction**: Move both through translation keys.

## Notes / checked, no defect found
- Self-steal and disabled-victim steal are blocked server-side (daily.ts:89,96) and the panel is only mounted for `!isOwn`; no client path bypasses it. (unconfirmed as a bug — correctly guarded.)
- Steal LIKE-pattern injection is escaped (daily.ts:78-82).
- ShareButtons builds `new URL(path, origin)` from the page-supplied `path` (`/${locale}/profile/${handle}`), which includes the locale; no wrong-URL defect found in scope.
- StealPanel busy flag is cleared in `finally`; no stuck-busy path found.