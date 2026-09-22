# Fix proposal — games-b (agent-03 audit)

Scope: `src/components/games/*`. Patch proposal only; **no project file was edited**.
Read for this proposal: `bugreports/agent-03-games-b.md`, `VaultGame.tsx`, `useGame.tsx`,
`MemoryGame.tsx`, `QuizGame.tsx`, `ShootGame.tsx`, `CatcherGame.tsx`, `TowerGame.tsx`.
Not requested by the brief (left untouched): games-b-7 (dead `balance`), games-b-11 (emoji glyphs).

All games gate on `busy` from `useGame` (which is set synchronously at the top of `play`,
so the *same-tick* double-dispatch is still possible where noted — hence the extra ref
guards below). Every patch is independent and can be shipped one finding at a time.

---

## games-b-1 proposal

- **Root cause**: `VaultGame.tsx:32-37` judges a hit against `zone = (30 + dial * 100) % 360`
  (30° / 130° / 230°), but `VaultGame.tsx:71` draws the single green marker at a fixed
  position (top of the circle ≈ 0°). The needle is rotated by `angle` (line 67), so the
  visual stop point and the judged stop point describe different angles; dials 2 and 3
  (130°/230°) are effectively unwinnable by aiming at the visible dot.

- **Exact change**: introduce one `zoneFor()` helper and use it for both judging and
  rendering, and rotate the marker layer to that angle.

  Before — `VaultGame.tsx:32-37`:
  ```ts
  function inZone(dial: number): boolean {
    const zone = (30 + dial * 100) % 360;
    const angle = angles[dial];
    const diff = Math.min(Math.abs(angle - zone), 360 - Math.abs(angle - zone));
    return diff <= 22;
  }
  ```
  After — add a module-level helper above the component body and rewrite `inZone`:
  ```ts
  function zoneFor(dial: number): number {
    return (30 + dial * 100) % 360;
  }
  ```
  ```ts
  function inZone(dial: number): boolean {
    const zone = zoneFor(dial);
    const angle = angles[dial];
    const diff = Math.min(Math.abs(angle - zone), 360 - Math.abs(angle - zone));
    return diff <= 22;
  }
  ```
  Before — `VaultGame.tsx:65-71`:
  ```tsx
              <div
                className="absolute inset-0"
                style={{ transform: `rotate(${angle}deg)` }}
              >
                <div className="absolute left-1/2 top-1.5 h-4 w-1 -translate-x-1/2 rounded bg-accent" />
              </div>
              <div className="absolute left-1/2 top-1 size-2 -translate-x-1/2 rounded-full bg-success" />
  ```
  After:
  ```tsx
              <div
                className="absolute inset-0"
                style={{ transform: `rotate(${angle}deg)` }}
              >
                <div className="absolute left-1/2 top-1.5 h-4 w-1 -translate-x-1/2 rounded bg-accent" />
              </div>
              <div
                className="absolute inset-0"
                style={{ transform: `rotate(${zoneFor(index)}deg)` }}
              >
                <div className="absolute left-1/2 top-1 size-2 -translate-x-1/2 rounded-full bg-success" />
              </div>
  ```

- **Why it is safe**: `inZone` is called only from `stop()` in this file; `zoneFor` is new
  and local. The marker is pure presentation — no state, no server contract, no i18n key.
  Rendering a rotated wrapper uses the same `rotate()` transform already applied to the
  needle layer, so layout/CSS is unchanged.

- **How to verify**: run the game; at dials 2 and 3 stop the needle when it visually points
  at the green dot and confirm the dial registers a match three times in a row. Or unit-
  check: for every `dial ∈ {0,1,2}`, `zoneFor(dial)` equals the angle at which
  `inZone(dial)` returns true.

- **Residual risk**: the ±22° tolerance is still drawn as a point, not a 44° arc, so the
  dot marks the centre of the win window rather than its extent. Widening it to an arc
  would be a further cosmetic change and is not included.

---

## games-b-2 proposal

- **Root cause**: `VaultGame.tsx:39-47` computes `nextPhase` from the `phase` captured in
  the render that created `stop`, and `VaultGame.tsx:78` does not disable the stop button
  while `busy`. Two clicks before the next re-render both see the same `phase`, both run
  `setPhase(nextPhase)` and, on the last dial, both call `play({ matches: newMatches })` —
  charging two rounds and crediting a phantom extra match for one dial.

- **Exact change**:

  Before — `VaultGame.tsx:9-13` (add the guard ref):
  ```ts
  const [phase, setPhase] = useState<"idle" | "dial1" | "dial2" | "dial3" | "done">("idle");
  const [angles, setAngles] = useState([0, 0, 0]);
  const [matches, setMatches] = useState(0);
  const raf = useRef<number>(0);
  const dialIndex = phase === "dial1" ? 0 : phase === "dial2" ? 1 : phase === "dial3" ? 2 : -1;
  ```
  After:
  ```ts
  const [phase, setPhase] = useState<"idle" | "dial1" | "dial2" | "dial3" | "done">("idle");
  const [angles, setAngles] = useState([0, 0, 0]);
  const [matches, setMatches] = useState(0);
  const raf = useRef<number>(0);
  const stoppedDial = useRef(-1);
  const dialIndex = phase === "dial1" ? 0 : phase === "dial2" ? 1 : phase === "dial3" ? 2 : -1;
  ```
  Before — `VaultGame.tsx:39-53`:
  ```ts
  function stop() {
    cancelAnimationFrame(raf.current);
    const hit = inZone(dialIndex);
    const newMatches = matches + (hit ? 1 : 0);
    setMatches(newMatches);
    const nextPhase = phase === "dial1" ? "dial2" : phase === "dial2" ? "dial3" : "done";
    setPhase(nextPhase);
    if (nextPhase === "done") void play({ matches: newMatches });
  }

  function start() {
    setMatches(0);
    setAngles([0, 0, 0]);
    setPhase("dial1");
  }
  ```
  After:
  ```ts
  function stop() {
    if (dialIndex < 0 || stoppedDial.current === dialIndex) return;
    stoppedDial.current = dialIndex;
    cancelAnimationFrame(raf.current);
    const hit = inZone(dialIndex);
    const newMatches = matches + (hit ? 1 : 0);
    setMatches(newMatches);
    const nextPhase = phase === "dial1" ? "dial2" : phase === "dial2" ? "dial3" : "done";
    setPhase(nextPhase);
    if (nextPhase === "done") void play({ matches: newMatches });
  }

  function start() {
    stoppedDial.current = -1;
    setMatches(0);
    setAngles([0, 0, 0]);
    setPhase("dial1");
  }
  ```
  Before — `VaultGame.tsx:78-80`:
  ```tsx
        {dialIndex >= 0 && phase !== "done" && (
          <button type="button" onClick={stop} className="btn btn-primary w-full">{t("stop")}</button>
        )}
  ```
  After:
  ```tsx
        {dialIndex >= 0 && phase !== "done" && (
          <button type="button" disabled={busy} onClick={stop} className="btn btn-primary w-full">{t("stop")}</button>
        )}
  ```

- **Why it is safe**: `stoppedDial` is a new local ref, reset in `start()`. `dialIndex` is a
  pure derivation of `phase`; when `phase` advances, `stoppedDial !== new dialIndex`, so the
  next legitimate click passes. `busy` already exists on the hook. Nothing else reads
  `stop`, `stoppedDial`, or the stop button.

- **How to verify**: start a round and double-click the stop button rapidly on dials 1 and
  2 — `matches` must advance by at most one per dial and only one `/api/games/play` POST
  may fire for the round (check the network tab).

- **Residual risk**: the ref guards clicks only within the client; it cannot stop a
  determined user from replaying the request from devtools — server-side dedup is out of
  scope here.

---

## games-b-3 / games-b-4 / games-b-5 proposal (one shared fix: busy gate)

The same defect shape in four files: `started`/`running`/`round` is cleared *before* the
awaited `play()` resolves and the start/again control carries no `disabled={busy}`.

### MemoryGame (games-b-3)

- **Root cause**: `MemoryGame.tsx:82` calls `setStarted(false)` before `MemoryGame.tsx:83`
  `await play(...)`, so the `again` button at `MemoryGame.tsx:123-127` is live during the
  in-flight round; `start()` (`MemoryGame.tsx:24`) has no busy check.

- **Exact change**:

  Before — `MemoryGame.tsx:24`:
  ```ts
  async function start() {
    const data = await fetch("/api/games/symbols").then((res) => res.json()).catch(() => null);
  ```
  After:
  ```ts
  async function start() {
    if (busy) return;
    const data = await fetch("/api/games/symbols").then((res) => res.json()).catch(() => null);
  ```
  Before — `MemoryGame.tsx:118-127`:
  ```tsx
        {!started && cards.length === 0 && (
          <button type="button" onClick={start} className="btn btn-primary w-full">
            {t("start")}
          </button>
        )}
        {!started && cards.length > 0 && (
          <button type="button" onClick={start} className="btn btn-secondary w-full">
            {t("again")}
          </button>
        )}
  ```
  After:
  ```tsx
        {!started && cards.length === 0 && (
          <button type="button" disabled={busy} onClick={start} className="btn btn-primary w-full">
            {t("start")}
          </button>
        )}
        {!started && cards.length > 0 && (
          <button type="button" disabled={busy || busyCards} onClick={start} className="btn btn-secondary w-full">
            {t("again")}
          </button>
        )}
  ```

- **Why it is safe**: `busy` and `busyCards` are already in scope (lines 16, 18); the guard
  only prevents an entry that would double-charge. `start` is referenced only by these two
  buttons.

- **How to verify**: finish a round; while the POST for the finished round is still open,
  click `again` — no second POST fires and no second deck is dealt.

- **Residual risk**: it does not re-enable the board after a failed `play` beyond what
  `busy` already does; the error path still surfaces through `GameError` as before.

### QuizGame (games-b-4)

- **Root cause**: `QuizGame.tsx:50` calls `setRound(null)` before `QuizGame.tsx:51`
  `await play(...)`, so the start button at `QuizGame.tsx:101-103` re-renders during the
  in-flight round and is not gated by `busy` (destructured at `:14`, never used).

- **Exact change**:

  Before — `QuizGame.tsx:101-103`:
  ```tsx
          <button type="button" onClick={startRound} className="btn btn-primary w-full">
            {t("start")}
          </button>
  ```
  After:
  ```tsx
          <button type="button" disabled={busy} onClick={startRound} className="btn btn-primary w-full">
            {t("start")}
          </button>
  ```
  Before — `QuizGame.tsx:24`:
  ```ts
  function startRound() {
    const picks = shuffle(badges).slice(0, 10);
  ```
  After:
  ```ts
  function startRound() {
    if (busy) return;
    const picks = shuffle(badges).slice(0, 10);
  ```

- **Why it is safe**: `busy` was already destructured and unused; using it is the intended
  wire-up. `startRound` is referenced only by this button.

- **How to verify**: answer question 10; while the POST is open, click start — no second
  `/api/games/play` fires.

- **Residual risk**: `setRound(null)` still precedes the await, so the start button becomes
  *visible* (just disabled) during the round; a purely cosmetic alternative is to move
  `setRound(null)` after the await, which changes the visible layout for one frame only.

### ShootGame (games-b-5)

- **Root cause**: `ShootGame.tsx:80` calls `setRunning(false)` inside the rAF finish, one
  frame before `ShootGame.tsx:84` `play(...)` resolves; the overlay at
  `ShootGame.tsx:145-151` is not disabled by `busy`.

- **Exact change**:

  Before — `ShootGame.tsx:147`:
  ```tsx
            <button type="button" onClick={start} className="btn btn-primary px-8 py-3">
  ```
  After:
  ```tsx
            <button type="button" disabled={busy} onClick={start} className="btn btn-primary px-8 py-3">
  ```
  Before — `ShootGame.tsx:93`:
  ```ts
  function start() {
    stateRef.current = { hits: 0, shots: 0 };
  ```
  After:
  ```ts
  function start() {
    if (busy) return;
    stateRef.current = { hits: 0, shots: 0 };
  ```

- **Why it is safe**: `busy` already in scope (line 17); `start` is referenced only by the
  overlay button. See also games-b-6 for the `targetsRef` rewrite of the same file — apply
  both, they are independent hunks.

- **How to verify**: let the 30 s timer expire; while the POST is pending the start button
  is disabled and clicking it does nothing.

- **Residual risk**: none beyond the games-b-6 change; the round's verdict is still shown by
  `RoundOutcome`.

### CatcherGame (games-b-5)

- **Root cause**: `CatcherGame.tsx:94` calls `setRunning(false)` before
  `CatcherGame.tsx:96` `play(...)` resolves; the overlay at `CatcherGame.tsx:154-160` is not
  gated by `busy`.

- **Exact change**:

  Before — `CatcherGame.tsx:156`:
  ```tsx
            <button type="button" onClick={start} className="btn btn-primary px-8 py-3">
  ```
  After:
  ```tsx
            <button type="button" disabled={busy} onClick={start} className="btn btn-primary px-8 py-3">
  ```
  Before — `CatcherGame.tsx:113`:
  ```ts
  function start() {
    stateRef.current = { caught: 0, missed: 0, basketX: 50 };
  ```
  After:
  ```ts
  function start() {
    if (busy) return;
    stateRef.current = { caught: 0, missed: 0, basketX: 50 };
  ```

- **Why it is safe**: `busy` already in scope (line 17); `start` is referenced only by the
  overlay button.

- **How to verify**: as Shoot — let the timer expire and click the overlay during the POST.

- **Residual risk**: same as Shoot.

---

## games-b-6 proposal

- **Root cause**: `CatcherGame.tsx:41-80` runs the whole collision pass, ref mutation
  (`stateRef.current.caught/missed`), nested `setCaught`/`setMissed` and `Math.random()`
  inside the `setItems` updater; `ShootGame.tsx:58-69` (movement/spawn) and
  `ShootGame.tsx:110-120` (`shoot`) do the same inside `setTargets`. React double-invokes
  updaters in StrictMode/dev, so `stateRef` counters double-advance while the visible
  counter advances once — the score posted to the server diverges from what the player saw.

- **Exact change** (Catcher): mirror the array in a ref and resolve collisions outside the
  updater.

  Before — `CatcherGame.tsx:26`:
  ```ts
  const stateRef = useRef({ caught: 0, missed: 0, basketX: 50 });
  ```
  After:
  ```ts
  const stateRef = useRef({ caught: 0, missed: 0, basketX: 50 });
  const itemsRef = useRef<Falling[]>([]);
  ```
  Before — `CatcherGame.tsx:38-88`:
  ```ts
  useEffect(() => {
    if (!running) return;
    const tick = () => {
      setItems((prev) => {
        const width = areaRef.current?.clientWidth ?? 600;
        const height = areaRef.current?.clientHeight ?? 320;
        const basketPx = (stateRef.current.basketX / 100) * width;
        const next: Falling[] = [];
        for (const item of prev) {
          const y = item.y + item.speed;
          if (y >= height - 36 && Math.abs(item.x - basketPx) < 42) {
            if (item.bomb) {
              stateRef.current.caught = Math.max(0, stateRef.current.caught - 3);
              setCaught((c) => Math.max(0, c - 3));
            } else {
              stateRef.current.caught += 1;
              setCaught((c) => c + 1);
            }
            continue;
          }
          if (y > height) {
            if (!item.bomb) {
              stateRef.current.missed += 1;
              setMissed((m) => m + 1);
            }
            continue;
          }
          next.push({ ...item, y });
        }
        if (Math.random() < 0.045) {
          next.push({
            id: Math.random(),
            x: 20 + Math.random() * (width - 60),
            y: -20,
            speed: 1.4 + Math.random() * 2.2,
            image: images.current.length
              ? images.current[Math.floor(Math.random() * images.current.length)]
              : "",
            bomb: Math.random() < 0.18,
          });
        }
        return next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    const start = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(start);
      cancelAnimationFrame(raf.current);
    };
  }, [running]);
  ```
  After:
  ```ts
  useEffect(() => {
    if (!running) return;
    const tick = () => {
      const width = areaRef.current?.clientWidth ?? 600;
      const height = areaRef.current?.clientHeight ?? 320;
      const basketPx = (stateRef.current.basketX / 100) * width;
      const next: Falling[] = [];
      let caughtNext = stateRef.current.caught;
      let missedNext = stateRef.current.missed;
      for (const item of itemsRef.current) {
        const y = item.y + item.speed;
        if (y >= height - 36 && Math.abs(item.x - basketPx) < 42) {
          if (item.bomb) caughtNext = Math.max(0, caughtNext - 3);
          else caughtNext += 1;
          continue;
        }
        if (y > height) {
          if (!item.bomb) missedNext += 1;
          continue;
        }
        next.push({ ...item, y });
      }
      if (Math.random() < 0.045) {
        next.push({
          id: Math.random(),
          x: 20 + Math.random() * (width - 60),
          y: -20,
          speed: 1.4 + Math.random() * 2.2,
          image: images.current.length
            ? images.current[Math.floor(Math.random() * images.current.length)]
            : "",
          bomb: Math.random() < 0.18,
        });
      }
      itemsRef.current = next;
      setItems(next);
      if (caughtNext !== stateRef.current.caught) {
        stateRef.current.caught = caughtNext;
        setCaught(caughtNext);
      }
      if (missedNext !== stateRef.current.missed) {
        stateRef.current.missed = missedNext;
        setMissed(missedNext);
      }
      raf.current = requestAnimationFrame(tick);
    };
    const start = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(start);
      cancelAnimationFrame(raf.current);
    };
  }, [running]);
  ```
  Before — `CatcherGame.tsx:113-120`:
  ```ts
  function start() {
    stateRef.current = { caught: 0, missed: 0, basketX: 50 };
    setCaught(0);
    setMissed(0);
    setItems([]);
    setTimeLeft(30);
    setRunning(true);
  }
  ```
  After:
  ```ts
  function start() {
    stateRef.current = { caught: 0, missed: 0, basketX: 50 };
    itemsRef.current = [];
    setCaught(0);
    setMissed(0);
    setItems([]);
    setTimeLeft(30);
    setRunning(true);
  }
  ```

  Shoot — same pattern: add `targetsRef` and move movement/spawn and hit resolution out of
  the updaters.

  Before — `ShootGame.tsx:26`:
  ```ts
  const stateRef = useRef({ hits: 0, shots: 0 });
  ```
  After:
  ```ts
  const stateRef = useRef({ hits: 0, shots: 0 });
  const targetsRef = useRef<Target[]>([]);
  ```
  Before — `ShootGame.tsx:52-74`:
  ```ts
  useEffect(() => {
    if (!running) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 16.7;
      last = now;
      setTargets((prev) => {
        const width = areaRef.current?.clientWidth ?? 600;
        const next = prev
          .map((target) => ({
            ...target,
            x: target.x + target.vx * dt,
            y: target.y + target.vy * dt,
          }))
          .filter((target) => target.y > -40 && target.x > -40 && target.x < width + 40);
        if (next.length < 6 && Math.random() < 0.06) next.push(spawn());
        return next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [running, spawn]);
  ```
  After:
  ```ts
  useEffect(() => {
    if (!running) return;
    let prevTime = performance.now();
    const tick = (now: number) => {
      const dt = (now - prevTime) / 16.7;
      prevTime = now;
      const width = areaRef.current?.clientWidth ?? 600;
      const next = targetsRef.current
        .map((target) => ({
          ...target,
          x: target.x + target.vx * dt,
          y: target.y + target.vy * dt,
        }))
        .filter((target) => target.y > -40 && target.x > -40 && target.x < width + 40);
      if (next.length < 6 && Math.random() < 0.06) next.push(spawn());
      targetsRef.current = next;
      setTargets(next);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [running, spawn]);
  ```
  Before — `ShootGame.tsx:93-101`:
  ```ts
  function start() {
    stateRef.current = { hits: 0, shots: 0 };
    setHits(0);
    setShots(0);
    setSummary(null);
    setTimeLeft(30);
    setTargets(Array.from({ length: 4 }, () => spawn()));
    setRunning(true);
  }
  ```
  After:
  ```ts
  function start() {
    if (busy) return;
    stateRef.current = { hits: 0, shots: 0 };
    targetsRef.current = Array.from({ length: 4 }, () => spawn());
    setHits(0);
    setShots(0);
    setSummary(null);
    setTimeLeft(30);
    setTargets(targetsRef.current);
    setRunning(true);
  }
  ```
  Before — `ShootGame.tsx:103-121`:
  ```ts
  function shoot(event: React.MouseEvent<HTMLDivElement>) {
    if (!running) return;
    stateRef.current.shots += 1;
    setShots((prev) => prev + 1);
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    setTargets((prev) => {
      const hitIndex = prev.findIndex(
        (target) => Math.hypot(target.x + 22 - x, target.y + 22 - y) < 30,
      );
      if (hitIndex === -1) return prev;
      const next = [...prev];
      next.splice(hitIndex, 1);
      stateRef.current.hits += 1;
      setHits((prevHits) => prevHits + 1);
      return next;
    });
  }
  ```
  After:
  ```ts
  function shoot(event: React.MouseEvent<HTMLDivElement>) {
    if (!running) return;
    stateRef.current.shots += 1;
    setShots((prev) => prev + 1);
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const prev = targetsRef.current;
    const hitIndex = prev.findIndex(
      (target) => Math.hypot(target.x + 22 - x, target.y + 22 - y) < 30,
    );
    if (hitIndex === -1) return;
    const next = [...prev];
    next.splice(hitIndex, 1);
    targetsRef.current = next;
    setTargets(next);
    stateRef.current.hits += 1;
    setHits((prevHits) => prevHits + 1);
  }
  ```

- **Why it is safe**: the ref mirror is written only where the state is written (tick,
  `start`, `shoot`), and `setState` is still called with the same value, so rendering is
  unchanged. The rAF loops already own the mutation cadence; moving resolution out of the
  updater does not change the frame logic, only *where* the counters advance — and it makes
  them advance exactly once per frame. These two files' effects/`start`/`shoot` are
  self-contained (no other module reads `setItems`/`setTargets`).
  Order of `prev` iteration is preserved, so bomb-vs-badge ordering and clamping behave
  exactly as before.

- **How to verify**: run Catcher and Shoot in dev; the on-screen `caught`/`missed` and
  `hits`/`shots` counters must match the values in the `input` of the POST body
  (network tab) for the same round. Before the fix they differ under StrictMode.

- **Residual risk**: if a future change adds a second writer to `items`/`targets` that does
  not also update the ref, the ref can drift. Today there is exactly one writer per array.

---

## games-b-8 proposal

- **Root cause**: `TowerGame.tsx:10` types `last` as `{ floor; survived; payout }`, and
  `TowerGame.tsx:14` does `setLast(result.result as typeof last)` — a blind cast of the
  server's untyped `result`. `TowerGame.tsx:25-26` then read `last.floor`/`last.survived`,
  and `TowerGame.tsx:66` calls `last.payout.toLocaleString("en")`. If the tower response is
  the `{ chance, won }` shape the other skill games use, `last.floor` is `undefined` (every
  row grey, round always "crashed") and `last.payout` is `undefined` → `toLocaleString`
  throws at render and the page crashes. Separately, `TowerGame.tsx:44` hardcodes the
  multiplier ladder `1 + floor * 0.22` client-side, which is never reconciled with the
  server's payout.

- **Exact change**: render the verdict and payout from the hook's `PlayResponse` (which
  always has `won` and `payout`), and read the optional `result.floor`/`result.survived`
  through explicit `typeof` guards instead of a cast.

  Before — `TowerGame.tsx:8-15`:
  ```ts
  const { bet, setBet, busy, error, play, t } = useGame("tower");
  const [cashoutAt, setCashoutAt] = useState(5);
  const [last, setLast] = useState<{ floor: number; survived: boolean; payout: number } | null>(null);

  async function climb() {
    const result = await play({ cashoutAt });
    if (result) setLast(result.result as typeof last);
  }
  ```
  After:
  ```ts
  const { bet, setBet, busy, error, last, play, t } = useGame("tower");
  const [cashoutAt, setCashoutAt] = useState(5);
  const result = last?.result as Partial<{ floor: number; survived: boolean }> | undefined;
  const reachedFloor = typeof result?.floor === "number" ? result.floor : cashoutAt;
  const survived = typeof result?.survived === "boolean" ? result.survived : (last?.won ?? true);

  async function climb() {
    await play({ cashoutAt });
  }
  ```
  Before — `TowerGame.tsx:24-26`:
  ```ts
            const reached = last ? floor <= last.floor : floor <= cashoutAt;
            const survived = last ? last.survived : true;
            const isCashout = floor === cashoutAt;
  ```
  After:
  ```ts
            const reached = last ? floor <= reachedFloor : floor <= cashoutAt;
            const isCashout = floor === cashoutAt;
  ```
  (the `survived` name now comes from the component-scope constant above; remove the
  per-row `const survived = …` line — the row markup at `:36-38` keeps using `survived`.)
  Before — `TowerGame.tsx:64-68`:
  ```tsx
        {last && (
          <p className={`text-center text-lg font-extrabold ${last.survived ? "text-success" : "text-danger"}`}>
            {last.survived ? t("youWin") : t("crashed")} (<span className="inline-flex items-center gap-1">{last.payout.toLocaleString("en")} <Coin size={14} /></span>)
          </p>
        )}
  ```
  After:
  ```tsx
        {last && (
          <p className={`text-center text-lg font-extrabold ${last.won ? "text-success" : "text-danger"}`}>
            {last.won ? t("youWin") : t("crashed")} (<span className="inline-flex items-center gap-1">{last.payout.toLocaleString("en")} <Coin size={14} /></span>)
          </p>
        )}
  ```
  Also — `TowerGame.tsx:19` (use the hook's balance, consistent with the other games):
  ```tsx
        <BetBar bet={bet} setBet={setBet} min={10} max={2000} busy={busy} balance={null} />
  ```
  →
  ```tsx
        <BetBar bet={bet} setBet={setBet} min={10} max={2000} busy={busy} balance={balance} />
  ```
  (requires destructuring `balance` at `:8`).

- **Why it is safe**: `last` and `balance` are the hook's own fields (`useGame.tsx:20,24`);
  every render now reads `won`/`payout`, which `PlayResponse` guarantees and `RoundOutcome`
  already relies on. The `typeof` guards make `result.floor` optional-safe — the ladder still
  falls back to `cashoutAt` when the server does not send a floor, and never throws.
  `TowerGame` is rendered only from its own page.

- **How to verify**: play one tower round and confirm the page does not throw, the result
  line reads win/lose from `last.won`, and the payout matches the POST response's `payout`.

- **Residual risk**: **unclear** — the server's tower `result` shape was not in this
  proposal's read scope, so `result.floor`/`result.survived` may be absent (ladder then
  shows only the `cashoutAt` marker, which is a cosmetic degradation). The client-side
  ladder `1 + floor * 0.22` at `:44` is still an unverified approximation and is **not**
  fixed here; it should be replaced with a server-provided table once that shape is known.

---

## games-b-9 proposal

- **Root cause**: `ShootGame.tsx:83` builds `setSummary(`${h} / ${sh} — …%`)` from raw
  accuracy and shows it as the round result, while the server decides `won`/`chance`; the
  player can be shown "100%" (success framing) while the server recorded a loss. The `%`
  string is also hardcoded English outside `messages/*.json`. `RoundOutcome` *is* rendered
  (`:127`) but the summary is the more prominent, contradictory line.

- **Exact change**: move the summary update after `play` resolves and derive it from the
  server verdict, using the existing `games.youWin`/`games.youLose` keys already used by
  `RoundOutcome` and TowerGame — no new message key is introduced.

  Before — `ShootGame.tsx:79-85`:
  ```ts
      const finish = requestAnimationFrame(() => {
        setRunning(false);
        cancelAnimationFrame(raf.current);
        const { hits: h, shots: sh } = stateRef.current;
        setSummary(`${h} / ${sh} — ${sh > 0 ? Math.round((h / sh) * 100) : 0}%`);
        void play({ hits: h, shots: sh });
      });
  ```
  After:
  ```ts
      const finish = requestAnimationFrame(() => {
        setRunning(false);
        cancelAnimationFrame(raf.current);
        const { hits: h, shots: sh } = stateRef.current;
        void play({ hits: h, shots: sh }).then((res) => {
          if (res) setSummary(`${h} / ${sh} — ${res.won ? t("youWin") : t("youLose")}`);
        });
      });
  ```

- **Why it is safe**: `t` is already in scope (`:17`, from `useGame`), and `youWin`/`youLose`
  are existing keys (used at `useGame.tsx:151` and `TowerGame.tsx:66`). The summary text is
  only rendered at `:158-162`. No new i18n key, so the 11 locale files stay key-identical.

- **How to verify**: shoot a round with 10/10 hits; the summary must read `youWin`/`youLose`
  in the active locale, matching `RoundOutcome`'s verdict and the POST response's `won`.

- **Residual risk**: the raw `h/sh` counters are still concatenated into one string with an
  em dash rather than fully templated through `messages/*.json`; a future `games.score`
  template would be the cleaner form but requires touching all 11 locale files and is left
  out to keep the patch self-contained.

---

## games-b-10 proposal

- **Root cause**: `QuizGame.tsx:48` starts an 800 ms `window.setTimeout` whose id is never
  stored or cleared, so unmounting (or a locale navigation) during the window fires
  `setIndex`/`setRound`/`play` on an unmounted component and can submit an in-flight round
  after the user left the page.

- **Exact change**:

  Before — `QuizGame.tsx:3`:
  ```ts
  import { useState } from "react";
  ```
  After:
  ```ts
  import { useEffect, useRef, useState } from "react";
  ```
  Before — `QuizGame.tsx:14-18`:
  ```ts
  const { bet, setBet, busy, error, last, balance, play, t } = useGame("quiz");
  const [index, setIndex] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [choice, setChoice] = useState<string | null>(null);
  const [round, setRound] = useState<Array<{ badge: QuizBadge; options: string[] }> | null>(null);
  ```
  After:
  ```ts
  const { bet, setBet, busy, error, last, balance, play, t } = useGame("quiz");
  const [index, setIndex] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [choice, setChoice] = useState<string | null>(null);
  const [round, setRound] = useState<Array<{ badge: QuizBadge; options: string[] }> | null>(null);
  const answerTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (answerTimer.current !== null) window.clearTimeout(answerTimer.current);
    };
  }, []);
  ```
  Before — `QuizGame.tsx:48`:
  ```ts
    window.setTimeout(async () => {
  ```
  After:
  ```ts
    answerTimer.current = window.setTimeout(async () => {
  ```

- **Why it is safe**: the cleanup only clears the timer; the `useEffect` has an empty dep
  array and no other side effects. `answerTimer` is new and local to this component.

- **How to verify**: answer the last question and navigate to another route within 800 ms —
  no `setState`-on-unmounted warning and no `/api/games/play` POST is emitted after
  navigation.

- **Residual risk**: a cleared timer means a round abandoned mid-answer is simply dropped
  (no bet is taken), which is the desired behaviour but means the round is not settled — no
  refund path exists for an abandoned round today.

---

## games-b-12 proposal

- **Root cause**: `MemoryGame.tsx:81` —
  `const finalMisses = finalCards.every((c) => c.matched) ? misses : misses;` — both
  branches are `misses`, so the ternary is dead code and reads as though a different value
  was intended on completion.

- **Exact change**: drop the tautology and the now-unused parameter, and pass `misses`
  directly.

  Before — `MemoryGame.tsx:63`:
  ```ts
        if (matched.every((card) => card.matched)) void finish(matched);
  ```
  After:
  ```ts
        if (matched.every((card) => card.matched)) void finish();
  ```
  Before — `MemoryGame.tsx:78-84`:
  ```ts
  async function finish(finalCards: Card[]) {
    // eslint-disable-next-line react-hooks/purity -- event-driven callback
    const timeMs = Date.now() - startTime.current;
    const finalMisses = finalCards.every((c) => c.matched) ? misses : misses;
    setStarted(false);
    await play({ timeMs, misses: finalMisses });
  }
  ```
  After:
  ```ts
  async function finish() {
    // eslint-disable-next-line react-hooks/purity -- event-driven callback
    const timeMs = Date.now() - startTime.current;
    setStarted(false);
    await play({ timeMs, misses });
  }
  ```

- **Why it is safe**: `finish` is called only at `:63`; removing the parameter drops the
  only use of `finalCards` (removing it avoids an unused-parameter lint error). `misses` is
  the same state the ternary returned in every branch, so behaviour is identical.

- **How to verify**: complete a board with 0 misses and with N misses; the POST body's
  `input.misses` equals the on-screen miss count.

- **Residual risk**: `misses` is still read from the render closure at the moment
  `setCards(matched)` schedules the completion; it is correct today because `finish` is
  called from the same event handler in which the last miss was counted, but a ref would be
  the belt-and-braces form if the flush timing ever changes.

---

## Apply order

1. games-b-2 (Vault stop guard) — prevents doubling while b-1 changes the same file.
2. games-b-1 (Vault zone marker) — independent hunk in the same file.
3. games-b-12, games-b-3 (Memory) — one file, two small hunks.
4. games-b-4, games-b-10 (Quiz) — one file, two hunks.
5. games-b-6 then games-b-5/games-b-9 (Shoot) — games-b-6 rewrites `shoot`/`start`, the
   others only add `disabled`/summary lines, so apply b-6 first and re-apply the smaller
   hunks on top.
6. games-b-6, games-b-5 (Catcher).
7. games-b-8 (Tower) — last, because it carries the one unverified assumption.