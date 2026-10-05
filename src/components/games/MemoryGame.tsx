"use client";

import { useEffect, useRef, useState } from "react";
import { useGame, BetBar, GameError, GameAction, RoundOutcome } from "./useGame";

interface Card {
  key: number;
  symbolId: string;
  image: string;
  flipped: boolean;
  matched: boolean;
}

/** Badge Memory — find all 6 pairs; speed and precision pay out. */
export default function MemoryGame() {
  const { bet, setBet, busy, error, last, balance, play, t } = useGame("memory");
  const [cards, setCards] = useState<Card[]>([]);
  const [busyCards, setBusyCards] = useState(false);
  const [misses, setMisses] = useState(0);
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const startTime = useRef(0);
  const firstPick = useRef<number | null>(null);
  const flipTimer = useRef<number | null>(null);
  // Cancel the pending state update on unmount: React 18 no longer warns about
  // setting state on an unmounted component, so nothing surfaced this.
  useEffect(
    () => () => {
      if (flipTimer.current !== null) window.clearTimeout(flipTimer.current);
    },
    [],
  );

  async function start() {
    const data = await fetch("/api/games/symbols").then((res) => res.json()).catch(() => null);
    const symbols: Array<{ id: string; image: string | null }> = (data?.symbols ?? [])
      ;
    // A failed symbols fetch returns []. Starting anyway leaves an empty board
    // with both action buttons hidden (started=true, cards.length===0), so the
    // player can only reload — surface the failure and stay on Start instead.
    if (symbols.length < 6) {
      setFailed(t("deckFailed"));
      return;
    }
    setFailed(null);
    const picked = symbols.slice(0, 6);
    const deck = [...picked, ...picked]
      .map((symbol, index) => ({
        key: index,
        symbolId: symbol.id,
        image: symbol.image ?? "",
        flipped: false,
        matched: false,
      }))
      .sort(() => Math.random() - 0.5)
      .map((card, index) => ({ ...card, key: index }));
    setCards(deck);
    setMisses(0);
    firstPick.current = null;
    setStarted(true);
    startTime.current = Date.now();
  }

  function flip(index: number) {
    if (busyCards || cards[index].flipped || cards[index].matched) return;
    const next = [...cards];
    next[index] = { ...next[index], flipped: true };
    setCards(next);

    if (firstPick.current === null) {
      firstPick.current = index;
      return;
    }
    const first = firstPick.current;
    firstPick.current = null;
    if (next[first].symbolId === next[index].symbolId) {
      const matched = next.map((card, i) =>
        i === first || i === index ? { ...card, matched: true } : card,
      );
      setCards(matched);
      if (matched.every((card) => card.matched)) void finish();
    } else {
      setBusyCards(true);
      setMisses((prev) => prev + 1);
      flipTimer.current = window.setTimeout(() => {
        setCards((prev) =>
          prev.map((card, i) =>
            i === first || i === index ? { ...card, flipped: false } : card,
          ),
        );
        setBusyCards(false);
      }, 700);
    }
  }

  async function finish() {
    // eslint-disable-next-line react-hooks/purity -- event-driven callback
    const timeMs = Date.now() - startTime.current;
    const finalMisses = misses;
    setStarted(false);
    await play({ timeMs, misses: finalMisses });
  }

  return (
    <div className="space-y-4">
      <BetBar bet={bet} setBet={setBet} min={10} max={2000} busy={busy} balance={balance} />
      <GameError error={error} />
      <RoundOutcome last={last} />
      <div className="card space-y-4 p-6">
        <div className="mx-auto grid max-w-md grid-cols-4 gap-2">
          {cards.map((card, index) => (
            <button
              key={card.key}
              type="button"
              onClick={() => flip(index)}
              className={`grid aspect-square place-items-center rounded-xl border transition-all duration-300 ${
                card.matched
                  ? "border-success/60 bg-success/10"
                  : card.flipped
                    ? "border-accent bg-accent-soft"
                    : "border-line bg-surface-3"
              }`}
            >
              {card.flipped || card.matched ? (
                card.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={card.image} alt="" width={40} height={40} />
                ) : null
              ) : (
                <span className="text-lg">✦</span>
              )}
            </button>
          ))}
        </div>
        {!started && cards.length === 0 && (
          <>
            <GameAction onClick={start} disabled={busy}>
              {t("start")}
            </GameAction>
            {failed ? <p className="text-center text-sm text-danger">{failed}</p> : null}
          </>
        )}
        {!started && cards.length > 0 && (
          <GameAction variant="secondary" onClick={start} disabled={busy}>
            {t("again")}
          </GameAction>
        )}
        {started && (
          <p className="text-center text-xs text-muted">
            {t("misses")}: {misses}
          </p>
        )}
      </div>
    </div>
  );
}
