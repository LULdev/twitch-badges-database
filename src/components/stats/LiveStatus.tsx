"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";

interface HealthPayload {
  ok: boolean;
  status: "ok" | "degraded" | "error";
  checkedAt: string;
  responseMs: number;
  db: { ok: boolean; latencyMs: number | null; error: string | null };
  catalog: { total: number | null; lastSeenAt: string | null };
  runtime: {
    region: string;
    environment: string;
    node: string;
    instanceUptimeSec: number;
  };
}

interface Ping {
  ms: number;
  ok: boolean;
}

/**
 * Live probe of /api/health. Each successful probe also records a `web`
 * heartbeat server-side, which is what the availability section measures.
 */
export default function LiveStatus({
  labels,
  intervalMs = 30_000,
}: {
  labels: {
    online: string;
    degraded: string;
    offline: string;
    checking: string;
    response: string;
    database: string;
    region: string;
    environment: string;
    history: string;
    lastCheck: string;
    refresh: string;
  };
  intervalMs?: number;
}) {
  const locale = useLocale();
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pings, setPings] = useState<Ping[]>([]);
  const mountedRef = useRef(true);

  const probe = useCallback(async () => {
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      const payload = (await response.json()) as HealthPayload;
      if (!mountedRef.current) return;
      setHealth(payload);
      setError(payload.db.error);
      setPings((previous) =>
        [...previous, { ms: payload.responseMs, ok: payload.ok }].slice(-24),
      );
    } catch (caught) {
      if (!mountedRef.current) return;
      setError(caught instanceof Error ? caught.message : "unreachable");
      setPings((previous) => [...previous, { ms: 0, ok: false }].slice(-24));
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    // Kick the first probe off asynchronously — a synchronous setState inside
    // the effect body would cascade renders (react-hooks/set-state-in-effect).
    const kickoff = window.setTimeout(() => void probe(), 0);
    const timer = window.setInterval(() => void probe(), intervalMs);
    return () => {
      mountedRef.current = false;
      window.clearTimeout(kickoff);
      window.clearInterval(timer);
    };
  }, [probe, intervalMs]);

  const tone = !health
    ? error
      ? "down"
      : "degraded"
    : health.ok
      ? health.status === "ok"
        ? "ok"
        : "degraded"
      : "down";
  const statusLabel = !health
    ? error
      ? labels.offline
      : labels.checking
    : tone === "ok"
      ? labels.online
      : tone === "degraded"
        ? labels.degraded
        : labels.offline;

  const peak = Math.max(1, ...pings.map((ping) => ping.ms));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className={`status-pill status-${tone}`}>
          <span className="status-dot" aria-hidden />
          {statusLabel}
        </span>
        <button
          type="button"
          onClick={() => void probe()}
          className="text-xs font-semibold text-accent hover:underline"
        >
          {labels.refresh}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <div className="ping-value">
            {health ? `${health.responseMs} ms` : "—"}
          </div>
          <div className="kpi-label">{labels.response}</div>
        </div>
        <div>
          <div className="ping-value">
            {health?.db.latencyMs !== null && health?.db.latencyMs !== undefined
              ? `${health.db.latencyMs} ms`
              : "—"}
          </div>
          <div className="kpi-label">{labels.database}</div>
        </div>
        <div>
          <div className="ping-value truncate">{health?.runtime.region ?? "—"}</div>
          <div className="kpi-label">{labels.region}</div>
        </div>
        <div>
          <div className="ping-value truncate">
            {health?.runtime.environment ?? "—"}
          </div>
          <div className="kpi-label">{labels.environment}</div>
        </div>
      </div>

      <div>
        <div className="kpi-label mb-1.5">{labels.history}</div>
        <div className="ping-bars" aria-hidden>
          {pings.length === 0 ? (
            <span className="text-xs text-muted">—</span>
          ) : (
            pings.map((ping, index) => (
              <span
                key={`${index}-${ping.ms}`}
                className="ping-bar"
                style={{
                  height: `${Math.max(10, (ping.ms / peak) * 100)}%`,
                  background: ping.ok ? "var(--accent)" : "var(--danger)",
                }}
              />
            ))
          )}
        </div>
        {health ? (
          <p className="mt-2 text-[11px] text-muted">
            {labels.lastCheck}: {new Date(health.checkedAt).toLocaleTimeString(locale)}
          </p>
        ) : null}
      </div>
    </div>
  );
}
