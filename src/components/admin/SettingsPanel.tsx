"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import AdminStatus from "./AdminStatus";

interface Economy {
  dailyXp: number; dailyCoins: number;
  streakXpPerDay: number; streakXpCap: number;
  streakCoinsPerDay: number; streakCoinsCap: number;
  gameWinXp: number; gameLoseXp: number;
  coinRainCoins: number; stealPrice: number; stealMax: number;
  stealFloodMinutes: number; stealPerHour: number;
}
interface GameSetting { enabled: boolean; minBet: number; maxBet: number }
interface Features {
  feed: boolean; wheel: boolean; steals: boolean;
  coinRain: boolean; compare: boolean; games: boolean;
}
interface Grant { profileId: string; username: string; role: string; addedAt: string }

interface SettingsPayload {
  economy: Economy;
  games: { enabled: boolean; games: Record<string, GameSetting> };
  features: Features;
  admin: { profileId?: string; username?: string; grants?: Grant[] };
  catalog: Array<{ id: string; title: string; type: string; minBet: number; maxBet: number }>;
}

const ECONOMY_FIELDS: Array<[keyof Economy, string]> = [
  ["dailyXp", "dailyXp"],
  ["dailyCoins", "dailyCoins"],
  ["streakXpPerDay", "streakXpPerDay"],
  ["streakXpCap", "streakXpCap"],
  ["streakCoinsPerDay", "streakCoinsPerDay"],
  ["streakCoinsCap", "streakCoinsCap"],
  ["gameWinXp", "gameWinXp"],
  ["gameLoseXp", "gameLoseXp"],
  ["coinRainCoins", "coinRainCoins"],
  ["stealPrice", "stealPrice"],
  ["stealMax", "stealMax"],
  ["stealFloodMinutes", "stealFloodMinutes"],
  ["stealPerHour", "stealPerHour"],
];

const FEATURE_KEYS: Array<keyof Features> = [
  "feed", "wheel", "steals", "coinRain", "compare", "games",
];

export default function SettingsPanel() {
  const t = useTranslations("admin.settings");
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [grantName, setGrantName] = useState("");
  const [grantRole, setGrantRole] = useState("moderator");
  // In-flight guard for every save/action in this panel: a double click used to
  // dispatch the same POST twice, so one action produced two requests and, when
  // the second failed, a success banner plus a contradicting error banner.
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/settings");
      if (!res.ok) throw new Error();
      setData((await res.json()) as SettingsPayload);
    } catch {
      setError(t("loadFailed"));
    }
  }, [setError, t]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const save = useCallback(
    async (section: string, value: unknown) => {
      if (busy) return false;
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const res = await fetch("/api/admin/settings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ section, value }),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setError(body.error ?? t("saveFailed"));
          return false;
        }
        setNotice(t("saved"));
        return true;
      } finally {
        setBusy(false);
      }
    },
    [busy, setError, setNotice, t],
  );

  const act = useCallback(
    async (payload: Record<string, unknown>) => {
      if (busy) return false;
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const res = await fetch("/api/admin/settings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setError(body.error ?? t("saveFailed"));
          return false;
        }
        setNotice(t("saved"));
        await load();
        return true;
      } finally {
        setBusy(false);
      }
    },
    [busy, load, setError, setNotice, t],
  );

  if (!data) {
    return <p className="card p-6 text-sm text-muted">{error ?? t("loading")}</p>;
  }

  return (
    <div className="space-y-5">
      <AdminStatus error={error} notice={notice} />

      {/* Features */}
      <section className="card space-y-3 p-4">
        <h3 className="text-sm font-bold">{t("features.title")}</h3>
        <p className="text-xs text-muted">{t("features.hint")}</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {FEATURE_KEYS.map((key) => (
            <label key={key} className="flex items-center gap-2 text-xs font-semibold text-muted">
              <input
                type="checkbox"
                checked={data.features[key]}
                onChange={(event) =>
                  setData({ ...data, features: { ...data.features, [key]: event.target.checked } })
                }
              />
              {t(`features.${key}`)}
            </label>
          ))}
        </div>
        <button type="button" className="btn btn-primary px-3 py-1.5 text-xs" disabled={busy} onClick={() => void save("features", data.features)}>
          {t("save")}
        </button>
      </section>

      {/* Economy */}
      <section className="card space-y-3 p-4">
        <h3 className="text-sm font-bold">{t("economy.title")}</h3>
        <p className="text-xs text-muted">{t("economy.hint")}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {ECONOMY_FIELDS.map(([key, label]) => (
            <label key={key} className="text-xs font-semibold text-muted">
              {t(`economy.${label}`)}
              <input
                className="input mt-1 w-full"
                type="number"
                min={0}
                value={data.economy[key]}
                onChange={(event) => {
                  // An emptied field used to become 0 via Number(""), so clearing
                  // a value to retype it silently wrote a zero that a later Save
                  // persisted. Keep the last valid number until digits appear —
                  // these fields are non-negative integers.
                  const parsed = Number(event.target.value);
                  const next =
                    event.target.value.trim() !== "" && Number.isFinite(parsed)
                      ? Math.max(0, Math.trunc(parsed))
                      : data.economy[key];
                  setData({ ...data, economy: { ...data.economy, [key]: next } });
                }}
              />
            </label>
          ))}
        </div>
        <button type="button" className="btn btn-primary px-3 py-1.5 text-xs" disabled={busy} onClick={() => void save("economy", data.economy)}>
          {t("save")}
        </button>
      </section>

      {/* Games */}
      <section className="card space-y-3 p-4">
        <h3 className="text-sm font-bold">{t("games.title")}</h3>
        <p className="text-xs text-muted">{t("games.hint")}</p>
        <label className="flex items-center gap-2 text-xs font-semibold text-muted">
          <input
            type="checkbox"
            checked={data.games.enabled}
            onChange={(event) => setData({ ...data, games: { ...data.games, enabled: event.target.checked } })}
          />
          {t("games.master")}
        </label>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("games.col.game")}</th>
                <th>{t("games.col.enabled")}</th>
                <th>{t("games.col.min")}</th>
                <th>{t("games.col.max")}</th>
              </tr>
            </thead>
            <tbody>
              {data.catalog.map((game) => {
                const setting = data.games.games[game.id] ?? { enabled: true, minBet: game.minBet, maxBet: game.maxBet };
                return (
                  <tr key={game.id}>
                    <td>{game.title}</td>
                    <td>
                      <input
                        type="checkbox"
                        checked={setting.enabled}
                        onChange={(event) =>
                          setData({
                            ...data,
                            games: {
                              ...data.games,
                              games: { ...data.games.games, [game.id]: { ...setting, enabled: event.target.checked } },
                            },
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="input w-24"
                        type="number"
                        min={0}
                        value={setting.minBet}
                        onChange={(event) => {
                          // Same empty-string rule as the economy fields: Number("")
                          // is 0, which a later Save would persist silently.
                          const parsed = Number(event.target.value);
                          const next =
                            event.target.value.trim() !== "" && Number.isFinite(parsed)
                              ? Math.max(0, Math.trunc(parsed))
                              : setting.minBet;
                          setData({
                            ...data,
                            games: {
                              ...data.games,
                              games: { ...data.games.games, [game.id]: { ...setting, minBet: next } },
                            },
                          });
                        }}
                      />
                    </td>
                    <td>
                      <input
                        className="input w-24"
                        type="number"
                        min={1}
                        value={setting.maxBet}
                        onChange={(event) => {
                          // min={1}: an emptied field keeps the previous value
                          // instead of collapsing to 0 (which the API would reject
                          // anyway, after a silent, confusing banner).
                          const parsed = Number(event.target.value);
                          const next =
                            event.target.value.trim() !== "" && Number.isFinite(parsed)
                              ? Math.max(1, Math.trunc(parsed))
                              : setting.maxBet;
                          setData({
                            ...data,
                            games: {
                              ...data.games,
                              games: { ...data.games.games, [game.id]: { ...setting, maxBet: next } },
                            },
                          });
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button type="button" className="btn btn-primary px-3 py-1.5 text-xs" disabled={busy} onClick={() => void save("games", data.games)}>
          {t("save")}
        </button>
      </section>

      {/* Admins */}
      <section className="card space-y-3 p-4">
        <h3 className="text-sm font-bold">{t("admins.title")}</h3>
        <p className="text-xs text-muted">{t("admins.hint")}</p>
        {data.admin.username ? (
          <p className="text-xs text-muted">
            {t("admins.owner", { username: data.admin.username })}
          </p>
        ) : null}
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-40 flex-1 text-xs font-semibold text-muted">
            {t("admins.username")}
            <input className="input mt-1 w-full" value={grantName} onChange={(event) => setGrantName(event.target.value)} />
          </label>
          <label className="text-xs font-semibold text-muted">
            {t("admins.role")}
            <select className="input mt-1" value={grantRole} onChange={(event) => setGrantRole(event.target.value)}>
              <option value="moderator">moderator</option>
              <option value="admin">admin</option>
            </select>
          </label>
          <button
            type="button"
            className="btn btn-primary px-3 py-1.5 text-xs"
            disabled={busy}
            onClick={async () => {
              if (await act({ section: "admins", action: "add", username: grantName, role: grantRole })) {
                setGrantName("");
              }
            }}
          >
            {t("admins.add")}
          </button>
        </div>
        <ul className="space-y-1">
          {(data.admin.grants ?? []).map((grant) => (
            <li key={grant.profileId} className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2">
              <span className="text-xs">
                <span className="font-semibold">{grant.username}</span>
                <span className="ms-2 chip">{grant.role}</span>
              </span>
              <button
                type="button"
                className="btn px-2 py-1 text-[0.6875rem] text-danger"
                disabled={busy}
                onClick={() => void act({ section: "admins", action: "remove", profileId: grant.profileId })}
              >
                {t("admins.remove")}
              </button>
            </li>
          ))}
          {(data.admin.grants ?? []).length === 0 ? (
            <li className="text-xs text-muted">{t("admins.empty")}</li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}