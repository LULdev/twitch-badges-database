"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import UptimeGauge from "@/components/stats/UptimeGauge";
import Reveal from "@/components/stats/Reveal";
import type { LiveProbe } from "@/lib/analytics";
import type { UptimeSource } from "@/lib/stats";
import AdminStatus from "./AdminStatus";

interface Payload {
  sources: UptimeSource[];
  probes: LiveProbe[];
  checkedAt: string;
}

function pct(ok: number, total: number): number | null {
  if (!total) return null;
  return Math.round((ok / total) * 1000) / 10;
}

/**
 * Service status: the recorded heartbeat history plus a live probe taken at the
 * moment the tab is opened. The two answer different questions — "has it been
 * healthy?" and "is it up right now?" — so both are shown instead of letting one
 * stand in for the other.
 */
export default function StatusPanel({ locale }: { locale: string }) {
  const t = useTranslations("admin.status");
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/status", { cache: "no-store" });
      if (!res.ok) throw new Error();
      setData((await res.json()) as Payload);
      setError(null);
    } catch {
      setError(t("loadFailed"));
    } finally {
      setBusy(false);
    }
  }, [setError, t]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  if (!data) {
    return <p className="card p-6 text-sm text-muted">{error ?? t("loading")}</p>;
  }

  const overall = data.sources.length
    ? pct(
        data.sources.reduce((sum, source) => sum + Number(source.ok_24h), 0),
        data.sources.reduce((sum, source) => sum + Number(source.checks_24h), 0),
      )
    : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-bold">{t("title")}</h2>
        <button type="button" className="btn px-3 py-1.5 text-xs" onClick={() => void load()} disabled={busy}>
          {busy ? t("probing") : t("reprobe")}
        </button>
      </div>
      <AdminStatus error={error} />

      <div className="grid gap-4 lg:grid-cols-4">
        <Reveal>
          <div className="card grid place-items-center p-4">
            <UptimeGauge value={overall} caption={t("uptime24")} locale={locale} />
          </div>
        </Reveal>
        <div className="lg:col-span-3 card p-4">
          <h3 className="mb-3 text-sm font-bold">{t("live")}</h3>
          <ul className="space-y-2">
            {data.probes.map((probe) => (
              <li key={probe.name} className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2">
                <span className={`status-pill status-${probe.ok ? "ok" : "down"}`}>
                  <span className="status-dot" aria-hidden />
                  {probe.name}
                </span>
                <span className="text-xs text-muted">
                  {probe.detail ? `${probe.detail} · ` : ""}
                  {probe.ms} ms
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">
            {t("checkedAt", { time: new Date(data.checkedAt).toLocaleTimeString(locale) })}
          </p>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("col.service")}</th>
              <th>{t("col.last")}</th>
              <th>{t("col.status")}</th>
              <th>{t("col.24h")}</th>
              <th>{t("col.7d")}</th>
              <th>{t("col.30d")}</th>
              <th>{t("col.avg")}</th>
            </tr>
          </thead>
          <tbody>
            {data.sources.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center text-muted">{t("empty")}</td>
              </tr>
            ) : (
              data.sources.map((source) => (
                <tr key={source.source}>
                  <td className="font-semibold">{source.source}</td>
                  <td className="text-muted">
                    {source.last_at ? new Date(source.last_at).toLocaleString(locale) : "—"}
                  </td>
                  <td>
                    <span className={`chip ${source.last_status === "ok" ? "" : "chip-danger"}`}>
                      {source.last_status ?? "—"}
                    </span>
                  </td>
                  <td>{pct(Number(source.ok_24h), Number(source.checks_24h)) ?? "—"}%</td>
                  <td>{pct(Number(source.ok_7d), Number(source.checks_7d)) ?? "—"}%</td>
                  <td>{pct(Number(source.ok_30d), Number(source.checks_30d)) ?? "—"}%</td>
                  <td className="text-muted">
                    {source.avg_ms_24h ? `${Math.round(Number(source.avg_ms_24h))} ms` : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="card p-4">
        <h3 className="mb-2 text-sm font-bold">{t("messages")}</h3>
        <ul className="space-y-1 text-xs text-muted">
          {data.sources
            .filter((source) => source.last_message)
            .map((source) => (
              <li key={source.source}>
                <span className="font-semibold">{source.source}</span>: {source.last_message}
              </li>
            ))}
          {data.sources.every((source) => !source.last_message) ? <li>{t("noMessages")}</li> : null}
        </ul>
      </div>
    </div>
  );
}