"use client";

import { useEffect, useRef, useState } from "react";
import { useGame, BetBar, GameError, RoundOutcome } from "./useGame";

export interface QuizBadge {
  slug: string;
  title: string;
  image: string | null;
}

/** Badge Quiz — name the badge from its image; 10 questions per round. */
export default function QuizGame({ badges }: { badges: QuizBadge[] }) {
  const { bet, setBet, busy, error, last, balance, play, t } = useGame("quiz");
  const [index, setIndex] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [choice, setChoice] = useState<string | null>(null);
  const advanceTimer = useRef<number>(0);

  useEffect(() => {
    return () => {
      if (advanceTimer.current) window.clearTimeout(advanceTimer.current);
    };
  }, []);
  const [round, setRound] = useState<Array<{ badge: QuizBadge; options: string[] }> | null>(null);

  function shuffle<T>(items: T[]): T[] {
    return [...items].sort(() => Math.random() - 0.5);
  }

  function startRound() {
    if (busy) return;
    const picks = shuffle(badges).slice(0, 10);
    setRound(
      picks.map((badge) => ({
        badge,
        options: shuffle([
          badge.title,
          ...shuffle(badges.filter((b) => b.slug !== badge.slug))
            .slice(0, 3)
            .map((b) => b.title),
        ]),
      })),
    );
    setIndex(0);
    setCorrect(0);
    setChoice(null);
  }

  async function answer(option: string) {
    if (choice !== null || !round) return;
    setChoice(option);
    const isCorrect = option === round[index].badge.title;
    const newCorrect = correct + (isCorrect ? 1 : 0);
    setCorrect(newCorrect);
    if (advanceTimer.current) window.clearTimeout(advanceTimer.current);
    advanceTimer.current = window.setTimeout(async () => {
      if (index + 1 >= round.length) {
        setRound(null);
        await play({ correct: newCorrect, total: round.length });
      } else {
        setIndex((prev) => prev + 1);
        setChoice(null);
      }
    }, 800);
  }

  return (
    <div className="space-y-4">
      <BetBar bet={bet} setBet={setBet} min={10} max={2000} busy={busy} balance={balance} />
      <GameError error={error} />
      <RoundOutcome last={last} />
      <div className="card space-y-4 p-6">
        {round ? (
          <>
            <p className="text-center text-xs font-bold uppercase tracking-widest text-muted">
              {t("question")} {index + 1}/{round.length} · {t("correct")}: {correct}
            </p>
            <div className="mx-auto grid size-32 place-items-center rounded-2xl border border-line bg-surface-2 p-3">
              {round[index].badge.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={round[index].badge.image} alt="" width={96} height={96} />
              ) : (
                <span className="text-3xl">✦</span>
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {round[index].options.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => answer(option)}
                  disabled={choice !== null}
                  className={`btn text-sm ${
                    choice === null
                      ? "btn-secondary"
                      : option === round[index].badge.title
                        ? "border-success bg-success/15 text-success"
                        : choice === option
                          ? "border-danger bg-danger/15 text-danger"
                          : "btn-secondary opacity-50"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </>
        ) : (
          <button type="button" onClick={startRound} className="btn btn-primary w-full">
            {t("start")}
          </button>
        )}
      </div>
    </div>
  );
}
