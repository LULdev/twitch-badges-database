# games-b (agent-03) — audit of src/components/games/*

Scope read (one Read each): useGame.tsx, MemoryGame.tsx, QuizGame.tsx, VaultGame.tsx,
ScratchGame.tsx, TowerGame.tsx, CatcherGame.tsx, ShootGame.tsx, SlotsGame.tsx.
Read-only audit; no project file was modified.

Note on the new server shape (`{ chance, won }`, fixed 2x payout): none of the five
skill clients (shoot, memory, quiz, vault, catcher) read a result field at all — they
never render win/loss or the payout from the response — so no `mult`/`sharp` reads were
found. The defects below are in what those clients do instead.

## games-b-1: Vault needle is aimed at a marker, but the hit zone is elsewhere
- **Severity**: high
- **Side**: client
- **File**: src/components/games/VaultGame.tsx:32-37 (logic) vs :62-70 (visual)
- **Evidence**:
  ```ts
  const zone = (30 + dial * 100) % 360;      // 30°, 130°, 230°
  return diff <= 22;
  ```
  ```tsx
  <div className="absolute left-1/2 top-1 size-2 -translate-x-1/2 rounded-full bg-success" />
  ```
- **Why it is a bug**: the green success marker is drawn at a fixed position (top, i.e.
  needle angle ≈ 0°) while the needle is rotated by `angle`. The stop is only a hit when
  the needle is within 22° of 30°/130°/230°. Even dial 1 (zone 30°) is off-centre against
  the marker, and dials 2/3 (130°, 230°) require stopping when the needle points away from
  the marker entirely — the player has no way to see where the real zone is and dials 2/3
  are effectively unwinnable by aiming at the visible target.
- **Confidence**: confirmed
- **Fix direction**: draw one marker per dial rotated to `zone` (or make `zone` a fixed
  0° and vary only the speed), so the visual and the tolerance describe the same angle.

## games-b-2: Vault double-click advances two dials and can charge two bets
- **Severity**: medium
- **Side**: client
- **File**: src/components/games/VaultGame.tsx:39-47, :78
- **Evidence**:
  ```ts
  const nextPhase = phase === "dial1" ? "dial2" : phase === "dial2" ? "dial3" : "done";
  setPhase(nextPhase);
  if (nextPhase === "done") void play({ matches: newMatches });
  ```
  `{dialIndex >= 0 && phase !== "done" && <button ... onClick={stop}>}`
- **Why it is a bug**: `stop` closes over `phase`/`matches` from the render it was created
  in, and the button is not disabled by `busy`. Two clicks dispatched before a re-render
  both see `phase === "dial3"`, both call `play(...)`, both increment `matches` (an extra
  "match" is credited for the same dial) — two spins are charged for one round and the
  score sent to the server is inflated.
- **Confidence**: confirmed
- **Fix direction**: disable the stop button while `busy` and derive the transition from a
  functional update (`setPhase(p => …)`) instead of the captured `phase`.

## games-b-3: MemoryGame "again" is not gated by the in-flight round
- **Severity**: medium
- **Side**: client
- **File**: src/components/games/MemoryGame.tsx:78-84, :122-126
- **Evidence**:
  ```ts
  setStarted(false);
  await play({ timeMs, misses: finalMisses });
  ```
  ```tsx
  {!started && cards.length > 0 && (<button type="button" onClick={start} ...>{t("again")}</button>)}
  ```
- **Why it is a bug**: `started` is cleared *before* `await play(...)` resolves, so the
  "again" button (and the still-clickable board) is live while the round is in flight. The
  button carries no `disabled={busy}`, and `start()` itself has no busy check — a fast
  click starts a second deal and a second `/api/games/play` call, charging the bet twice
  and leaving two responses racing into `useGame.last`/`balance`.
- **Confidence**: confirmed
- **Fix direction**: `disabled={busy || busyCards}` on the start/again buttons (and an
  early return in `start()` when `busy`).

## games-b-4: QuizGame's last answer re-enables start while the round is in flight
- **Severity**: medium
- **Side**: client
- **File**: src/components/games/QuizGame.tsx:48-56, :100
- **Evidence**:
  ```ts
  if (index + 1 >= round.length) {
    setRound(null);
    await play({ correct: newCorrect, total: round.length });
  ```
  ```tsx
  <button type="button" onClick={startRound} className="btn btn-primary w-full">{t("start")}</button>
  ```
- **Why it is a bug**: `setRound(null)` happens before the POST resolves, so the start
  button re-renders immediately with no `disabled={busy}` (`busy` from `useGame` is
  destructured at :14 but never used). Clicking it starts and can even finish a new round
  before the first `play` returns — two concurrent plays, two bets, and the earlier
  response overwriting `last`/`balance` out of order.
- **Confidence**: confirmed
- **Fix direction**: gate the start button on `busy` (`disabled={busy}`) and require the
  awaited `play` to settle before `setRound(null)`.

## games-b-5: Shoot and Catcher show the start overlay while a result is pending
- **Severity**: medium
- **Side**: client
- **File**: src/components/games/ShootGame.tsx:79-86, :144-150; src/components/games/CatcherGame.tsx:92-99, :153-159
- **Evidence**:
  ```ts
  const finish = requestAnimationFrame(() => {
    setRunning(false);
    ...
    void play({ hits: h, shots: sh });
  });
  ```
  ```tsx
  {!running && (<div className="absolute inset-0 grid place-items-center"><button ... onClick={start}>…</button></div>)}
  ```
- **Why it is a bug**: `setRunning(false)` runs a frame before `play` resolves, so the
  full-screen start button appears while the round's POST is still open, and it is not
  disabled by `busy`. Clicking it clears counters and re-runs `play` — the previous round's
  bet is still being settled and a second bet is charged for the new round.
- **Confidence**: confirmed
- **Fix direction**: keep `running` true until the `play` promise settles, or disable the
  start button with `busy` in both games.

## games-b-6: Catcher/Shoot mutate refs and call setState inside state updaters
- **Severity**: medium
- **Side**: client
- **File**: src/components/games/CatcherGame.tsx:41-80, :50-54; src/components/games/ShootGame.tsx:110-120
- **Evidence**:
  ```ts
  setItems((prev) => {
    ...
    if (item.bomb) { stateRef.current.caught = Math.max(0, stateRef.current.caught - 3); setCaught(...); }
    else { stateRef.current.caught += 1; setCaught((c) => c + 1); }
    ...
    if (Math.random() < 0.045) { next.push({ id: Math.random(), ... }); }
  ```
  ```ts
  setTargets((prev) => { ... stateRef.current.hits += 1; setHits((prevHits) => prevHits + 1); ... });
  ```
- **Why it is a bug**: the `setItems`/`setTargets` updaters are impure — they mutate
  `stateRef.current`, call another `setState`, and use `Math.random()`. React (React 19
  StrictMode, dev) intentionally double-invokes updaters, so every catch/miss/hit is
  counted twice in `stateRef` while the visible counter advances once. The score sent to
  the server (`hits`, `shots`, `caught`, `missed`) diverges from what the player saw, which
  is a scoring integrity bug now that the server derives `won`/`chance` from these inputs.
- **Confidence**: confirmed
- **Fix direction**: move collision resolution out of the updater — compute the frame's
  events in a ref/plain function, then apply the counters with one functional update
  outside the `setItems`/`setTargets` callback.

## games-b-7: useGame's balance is fetched and updated but never rendered
- **Severity**: medium
- **Side**: client
- **File**: src/components/games/useGame.tsx:20, :57, :117; consumers at MemoryGame.tsx:88, QuizGame.tsx:61, VaultGame.tsx:57, ScratchGame.tsx:30, TowerGame.tsx:19, CatcherGame.tsx:124, ShootGame.tsx:125, SlotsGame.tsx:71
- **Evidence**:
  ```ts
  const [balance, setBalance] = useState<number | null>(null);
  ...
  setBalance(data.balance);
  ```
  ```tsx
  <BetBar bet={bet} setBet={setBet} min={10} max={2000} busy={busy} balance={null} />
  ```
- **Why it is a bug**: every one of the eight games hardcodes `balance={null}` into the
  only component that renders a balance, so `useGame`'s `refresh()` fetch and the
  `setBalance(data.balance)` after each round are dead. The player never sees their coin
  balance, and — with the new fixed-2x payout — never sees the round's payout land either,
  because no component in scope reads `response.payout` or `response.won` into the UI.
- **Confidence**: confirmed (that the value is discarded; whether a shell elsewhere shows
  the balance could not be checked from the scope files)
- **Fix direction**: pass the hook's `balance` (or the payout delta) into `BetBar`, or drop
  the dead state/`refresh` so the omission is explicit.

## games-b-8: TowerGame hardcodes its own payout table and assumes old result fields
- **Severity**: medium
- **Side**: client
- **File**: src/components/games/TowerGame.tsx:10, :14, :25-26, :66
- **Evidence**:
  ```ts
  const [last, setLast] = useState<{ floor: number; survived: boolean; payout: number } | null>(null);
  ...
  if (result) setLast(result.result as typeof last);
  ...
  {last.survived ? t("youWin") : t("crashed")} (… {last.payout.toLocaleString("en")} …)
  ```
  ```tsx
  <span>{isCashout ? `← ${t("cashout")}` : `×${(1 + floor * 0.22).toFixed(2)}`}</span>
  ```
- **Why it is a bug**: the multiplier ladder shown to the player is computed entirely
  client-side (`1 + floor*0.22`) and is never reconciled with the server's `payout`;
  if tower was migrated to the same `{ chance, won }` shape as the other skill games, then
  `last.floor`/`last.survived` are `undefined` (every floor renders grey, the round always
  reads "crashed") and `last.payout.toLocaleString(...)` throws at render, breaking the
  page. The result is displayed from the response, so any drift in the response shape is a
  hard crash here rather than a wrong number.
- **Confidence**: likely (the field names in the response for `tower` could not be verified
  from the scope files)
- **Fix direction**: render the payout from `PlayResponse.payout` (already on the hook) and
  guard `last` with explicit `typeof`/optional access instead of a blind cast.

## games-b-9: Shoot and Catcher claim a client-side outcome that can contradict the server
- **Severity**: low
- **Side**: client
- **File**: src/components/games/ShootGame.tsx:83, :157-161
- **Evidence**:
  ```ts
  setSummary(`${h} / ${sh} — ${sh > 0 ? Math.round((h / sh) * 100) : 0}%`);
  ```
- **Why it is a bug**: the summary is computed from the raw accuracy and is shown as the
  round's result, but the server now decides the round from `won`/`chance`; a player can be
  shown "10 / 10 — 100%" (success framing) while the server recorded a loss and a 0 payout,
  with nothing on screen showing the actual win/loss. Also a hardcoded English `%` string
  outside `messages/*.json`.
- **Confidence**: confirmed
- **Fix direction**: derive the displayed verdict from `PlayResponse.won` and format the
  summary through `t(...)`.

## games-b-10: QuizGame leaves an 800 ms timer running past unmount
- **Severity**: low
- **Side**: client
- **File**: src/components/games/QuizGame.tsx:48-56
- **Evidence**:
  ```ts
  window.setTimeout(async () => {
    if (index + 1 >= round.length) { setRound(null); await play({ correct: newCorrect, total: round.length }); }
    else { setIndex((prev) => prev + 1); setChoice(null); }
  }, 800);
  ```
- **Why it is a bug**: the timeout id is never stored or cleared. Unmounting (or a locale
  navigation) during the 800 ms window lets the callback fire afterwards, calling
  `setIndex`/`setRound`/`play` on an unmounted component — an in-flight round can also be
  submitted after the user has left the page.
- **Confidence**: confirmed
- **Fix direction**: keep the id in a ref and clear it in a `useEffect` cleanup.

## games-b-11: Emoji glyphs used as game UI
- **Severity**: low
- **Side**: client
- **File**: src/components/games/CatcherGame.tsx:133, :161, :163; src/components/games/ShootGame.tsx:153, :154; src/components/games/SlotsGame.tsx:100
- **Evidence**: `💣`, `⏱ {timeLeft}s`, `🏅 {caught} · ✗ {missed}`, `🎯 {hits}/{shots}`, `🎰 {t("spin")}`
- **Why it is a bug**: AGENTS.md requires "No emojis in UI; inline SVG icons", and these
  glyphs also bypass i18n and render inconsistently across platforms/font sets.
- **Confidence**: confirmed
- **Fix direction**: replace with the existing inline SVG icon components.

## games-b-12: MemoryGame's miss count uses a tautological ternary
- **Severity**: low
- **Side**: client
- **File**: src/components/games/MemoryGame.tsx:81
- **Evidence**: `const finalMisses = finalCards.every((c) => c.matched) ? misses : misses;`
- **Why it is a bug**: both branches yield `misses`, so the expression is dead code — it
  reads as though a different value was intended on completion (e.g. clearing or re-reading
  the count) and it silently captures the closure's `misses` rather than the final count.
  Harmless today only because the calling render always has the up-to-date value.
- **Confidence**: confirmed
- **Fix direction**: delete the ternary and pass `misses` directly, or read the count from a
  ref if the final value must be guaranteed.