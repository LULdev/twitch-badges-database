"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import AdminStatus from "./AdminStatus";

type Target = "global" | "badgebase" | "potat";

interface RunResult {
  ok: boolean;
  target: Target;
  durationMs: number;
  summary?: unknown;
  error?: string;
}

/**
 * Ad-hoc sync triggers. The summary is printed verbatim: the dashboards's job
 * here is to show what the engine actually reported (added/updated counts, a
 * "skipped" note, a provider incident), not to paraphrase it.
 */
export default function SyncPanel() {
  const t = useTranslations("admin.sync");
  const [running, setRunning] = useState<Target | null>(null);
  const [results, setResults] = useState<RunResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function run(target: Target) {
    setRunning(target);
    setError(null);
    try {
      const res = await fetch("/api/admin/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target }),
      });
      const data = (await res.json().catch(() => ({}))) as RunResult & { error?: string };
      if (!res.ok) {
        setError(data.error ?? t("failed"));
        return;
      }
      setResults((current) => [data, ...current].slice(0, 5));
    } catch {
      setError(t("failed"));
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{t("intro")}</p>
      <AdminStatus error={error} />

      <div className="grid gap-3 sm:grid-cols-3">
        {(["global", "badgebase", "potat"] as const).map((target) => (
          <div key={target} className="card space-y-2 p-4">
            <h3 className="text-sm font-bold">{t(`${target}.title`)}</h3>
            <p className="text-xs text-muted">{t(`${target}.hint`)}</p>
            <button
              type="button"
              className="btn btn-primary px-3 py-1.5 text-xs"
              disabled={running !== null}
              onClick={() => void run(target)}
            >
              {running === target ? t("running") : t("run")}
            </button>
          </div>
        ))}
      </div>

      {results.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-sm font-bold">{t("results")}</h3>
          {results.map((result, index) => (
            <div key={`${result.target}-${index}`} className="card p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold">
                  {t(`${result.target}.title`)}
                  <span className={`ms-2 chip ${result.ok ? "" : "chip-danger"}`}>
                    {result.ok ? t("ok") : t("failed")}
                  </span>
                </span>
                <span className="text-xs text-muted">{result.durationMs} ms</span>
              </div>
              {result.error ? <p className="mt-1 text-xs text-danger">{result.error}</p> : null}
              {result.summary ? (
                <pre className="mt-2 overflow-x-auto rounded-lg bg-surface-2 p-2 text-[0.6875rem]">
                  {JSON.stringify(result.summary, null, 2)}
                </pre>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}