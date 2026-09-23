"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import AdminStatus from "./AdminStatus";

interface AuditRow {
  id: number;
  actor: string;
  actor_id: string | null;
  action: string;
  target: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

const ACTION_PREFIXES = [
  "user.",
  "blog.",
  "changelog.",
  "badge.",
  "settings.",
  "admin.",
  "sync.",
  "newsletter.",
  "idea.",
];

/** The audit trail: every admin mutation, newest first, filterable. */
export default function AuditPanel({ locale }: { locale: string }) {
  const t = useTranslations("admin.audit");
  const [entries, setEntries] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ resource: "audit", limit: "100" });
      if (action) params.set("action", action);
      if (actor.trim()) params.set("actor", actor.trim());
      const res = await fetch(`/api/admin/ideas?${params}`);
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { entries: AuditRow[]; total: number };
      setEntries(data.entries);
      setTotal(data.total);
    } catch {
      setError(t("loadFailed"));
    }
  }, [action, actor, setError, t]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{t("intro")}</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-semibold text-muted">
          {t("filterAction")}
          <select className="input mt-1" value={action} onChange={(event) => setAction(event.target.value)}>
            <option value="">{t("allActions")}</option>
            {ACTION_PREFIXES.map((prefix) => (
              <option key={prefix} value={prefix}>{prefix}</option>
            ))}
          </select>
        </label>
        <label className="min-w-40 text-xs font-semibold text-muted">
          {t("filterActor")}
          <input className="input mt-1 w-full" value={actor} onChange={(event) => setActor(event.target.value)} />
        </label>
        <span className="text-xs text-muted">{t("count", { count: total })}</span>
      </div>

      <AdminStatus error={error} />

      <div className="card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("col.when")}</th>
              <th>{t("col.actor")}</th>
              <th>{t("col.action")}</th>
              <th>{t("col.target")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr><td colSpan={5} className="text-center text-muted">{t("empty")}</td></tr>
            ) : (
              entries.map((entry) => (
                <Fragment key={entry.id}>
                  <tr>
                    <td className="text-muted">{new Date(entry.created_at).toLocaleString(locale)}</td>
                    <td className="font-semibold">{entry.actor}</td>
                    <td><span className="chip">{entry.action}</span></td>
                    <td className="text-muted">{entry.target || "—"}</td>
                    <td className="text-end">
                      {entry.payload ? (
                        <button
                          type="button"
                          className="btn px-2 py-1 text-[0.6875rem]"
                          onClick={() => setOpen(open === entry.id ? null : entry.id)}
                        >
                          {open === entry.id ? t("hide") : t("details")}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                  {open === entry.id && entry.payload ? (
                    <tr>
                      <td colSpan={5}>
                        <pre className="overflow-x-auto rounded-lg bg-surface-2 p-2 text-[0.6875rem]">
                          {JSON.stringify(entry.payload, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}