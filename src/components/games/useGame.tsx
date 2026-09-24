"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Coin from "@/components/Coin";

export interface PlayResponse {
  ok: boolean;
  error?: string;
  bet: number;
  payout: number;
  won: boolean;
  balance: number;
  result: Record<string, unknown>;
}

/** Shared game state: balance, bet controls and the /api/games/play call. */
export function useGame(gameId: string) {
  const t = useTranslations("games");
  const [balance, setBalance] = useState<number | null>(null);
  const [bet, setBet] = useState(50);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<PlayResponse | null>(null);
  // A ref, not the `busy` state: a state transition can fire play() again in the
  // same commit, before `busy` has re-rendered (Vault's "again" did exactly this),
  // so the guard has to be synchronous.
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/progress");
      const data = (await res.json()) as { coins?: number };
      if (typeof data.coins === "number") setBalance(data.coins);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  const play = useCallback(
    async (input: Record<string, unknown> = {}): Promise<PlayResponse | null> => {
      // One round at a time: a second call while a round is open would charge a
      // second bet and race two responses into `last`/`balance`.
      if (inFlight.current) return null;
      inFlight.current = true;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/games/play", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ game: gameId, bet, input }),
        });
        const data = (await res.json()) as PlayResponse;
        if (!data.ok) {
          setError(t("roundFailed"));
          return null;
        }
        setLast(data);
        setBalance(data.balance);
        return data;
      } catch {
        setError(t("networkError"));
        return null;
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [bet, gameId, t],
  );

  return { balance, bet, setBet, busy, error, last, play, refresh, t };
}

export function BetBar({
  bet,
  setBet,
  min,
  max,
  busy,
  balance,
}: {
  bet: number;
  setBet: (value: number) => void;
  min: number;
  max: number;
  busy: boolean;
  balance: number | null;
}) {
  const locale = useLocale();
  const t = useTranslations("games");
  // A string draft while the field is being typed. Clamping on every keystroke made
  // an arbitrary bet impossible to enter: the first digit was pulled up to `min`
  // (or down to `max`) before the rest arrived, so "1000" settled on 10.
  const [draft, setDraft] = useState<string | null>(null);

  function commitDraft() {
    if (draft === null) return;
    const parsed = Number(draft);
    if (draft.trim() !== "" && Number.isFinite(parsed)) {
      setBet(Math.max(min, Math.min(max, parsed)));
    }
    setDraft(null);
  }

  return (
    <div className="card flex flex-wrap items-center gap-3 p-4">
      <span className="text-xs font-semibold text-muted">{t("bet")}</span>
      <div className="flex items-center gap-1.5">
        {[min, 50, 100, 500].map((step) => (
          <button
            key={step}
            type="button"
            disabled={busy || step < min || step > max}
            onClick={() => setBet(step)}
            className={`chip ${bet === step ? "chip-active" : ""}`}
          >
            {step}
          </button>
        ))}
      </div>
      <input
        type="number"
        className="input w-28 py-2 text-sm"
        value={draft ?? String(bet)}
        min={min}
        max={max}
        onFocus={() => setDraft(String(bet))}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        aria-label={t("bet")}
      />
      {balance !== null && (
        <span className="ms-auto text-sm font-bold tabular-nums">
          <Coin size={15} /> {balance.toLocaleString(locale)}
        </span>
      )}
    </div>
  );
}

export function GameError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="rounded-[var(--radius-input)] border border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger">
      {error}
    </p>
  );
}

/**
 * The server decides the outcome (the score for the skill games is only a hint
 * to the win chance), so the round verdict has to be rendered from the
 * response — the clients used to show their own numbers instead, which showed
 * nothing once payouts moved fully server-side.
 */
export function RoundOutcome({ last }: { last: PlayResponse | null }) {
  const t = useTranslations("games");
  if (!last) return null;
  return (
    <p
      role="status"
      className={`flex items-center justify-center gap-2 rounded-[var(--radius-input)] px-4 py-2 text-sm font-semibold ${
        last.won
          ? "border border-success/40 bg-success/10 text-success"
          : "border border-line bg-surface-2 text-muted"
      }`}
    >
      <span>{last.won ? t("youWin") : t("youLose")}</span>
      {last.payout > 0 ? (
        <span className="inline-flex items-center gap-1 tabular-nums">
          +{last.payout}
          <Coin size={12} />
        </span>
      ) : null}
    </p>
  );
}
