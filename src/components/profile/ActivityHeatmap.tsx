"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";

export interface HeatCell {
  /** UTC day, "YYYY-MM-DD" (the bucket key). */
  day: string;
  rounds: number;
  /** Precomputed intensity bucket ("0".."3" | "max") — the server's heatLevel. */
  level: string;
  /** Pre-built accessible label (the enriched title: rounds · net · best). */
  label: string;
}

export interface HeatRound {
  /** Server-localized game title — the island must NOT import GAMES (that
   *  would pull the service-role client into the browser bundle); the page
   *  resolves titles via its own games translator and ships them as props. */
  title: string;
  bet: number;
  payout: number;
}

/**
 * The profile's 30-day activity heatmap as a clickable island: picking a day
 * expands its settled rounds (game, bet → payout, net) under the grid. All
 * display-heavy inputs — intensity levels, accessible labels, localized game
 * titles — are prepared server-side; the island only toggles and formats.
 * Pure useState/onClick, no effects (the React Compiler contract).
 */
export default function ActivityHeatmap({
  cells,
  days,
}: {
  cells: HeatCell[];
  days: Record<string, HeatRound[]>;
}) {
  const t = useTranslations("profile");
  const locale = useLocale();
  const [selected, setSelected] = useState<string | null>(null);
  const rounds = selected ? days[selected] ?? [] : [];
  const dayFormat = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });

  return (
    <div>
      <div className="activity-heat">
        {cells.map((cell) => (
          <button
            key={cell.day}
            type="button"
            className="activity-heat-cell"
            data-level={cell.level}
            data-selected={selected === cell.day}
            aria-pressed={selected === cell.day}
            aria-label={cell.label}
            title={cell.label}
            onClick={() => setSelected(selected === cell.day ? null : cell.day)}
          />
        ))}
      </div>
      {selected && (
        <div className="mt-2 rounded-[var(--radius-input)] border border-line bg-surface-2 px-3 py-2 text-xs">
          <p className="font-bold">
            {t("dayDetailTitle", {
              date: dayFormat.format(new Date(`${selected}T00:00:00Z`)),
              n: rounds.length.toLocaleString(locale),
            })}
          </p>
          {rounds.length === 0 ? (
            <p className="mt-1 text-muted">{t("dayDetailEmpty")}</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {rounds.map((round, index) => {
                const net = round.payout - round.bet;
                return (
                  <li
                    key={`${selected}-${index}`}
                    className="flex flex-wrap items-baseline gap-x-2"
                  >
                    <span className="min-w-0 flex-1 truncate font-semibold">
                      {round.title}
                    </span>
                    <span dir="ltr" className="tabular-nums text-muted">
                      {round.bet.toLocaleString(locale)} →{" "}
                      {round.payout.toLocaleString(locale)}
                    </span>
                    <span
                      dir="ltr"
                      className={`font-bold tabular-nums ${
                        net >= 0 ? "text-success" : "text-danger"
                      }`}
                    >
                      {net >= 0 ? "+" : "−"}
                      {Math.abs(net).toLocaleString(locale)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
