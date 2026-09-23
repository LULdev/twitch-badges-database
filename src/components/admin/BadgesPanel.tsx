"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import AdminStatus from "./AdminStatus";

interface BadgeRow {
  id: string;
  set_id: string;
  version: string;
  slug: string;
  title: string;
  category: string;
  status: string;
  source: string;
  owner_count: number | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
}

interface BadgeFull extends BadgeRow {
  description: string | null;
  how_to_earn: string | null;
  image_url_1x: string | null;
  image_url_2x: string | null;
  image_url_4x: string | null;
  click_url: string | null;
  is_paid: boolean;
}

const CATEGORIES = [
  "events",
  "subscriptions",
  "bits",
  "achievements",
  "predictions",
  "other",
] as const;
const STATUSES = ["active", "upcoming", "expired", "removed"] as const;

async function call(payload: Record<string, unknown>) {
  const res = await fetch("/api/admin/content", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: res.ok, error: data.error };
}

function toLocalInput(value: string | null): string {
  if (!value) return "";
  // datetime-local wants "YYYY-MM-DDTHH:mm" in local time.
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function BadgesPanel() {
  const t = useTranslations("admin.badges");
  const [query, setQuery] = useState("");
  const [customOnly, setCustomOnly] = useState(true);
  const [badges, setBadges] = useState<BadgeRow[]>([]);
  const [editing, setEditing] = useState<BadgeFull | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // In-flight guard: a double click re-POSTed, and for a new row both posts
  // carried `id: undefined`, so the second collided on (set_id, version).
  const [busy, setBusy] = useState(false);
  // The latest badge the operator asked to edit, compared after the await so a
  // stale response cannot replace the editor they are now looking at.
  const editingRequest = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ resource: "badges", limit: "25" });
      if (query.trim()) params.set("q", query.trim());
      if (customOnly) params.set("source", "custom");
      const res = await fetch(`/api/admin/content?${params}`);
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { badges: BadgeRow[] };
      setBadges(data.badges);
    } catch {
      setError(t("loadFailed"));
    }
  }, [query, customOnly, setError, t]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  function newBadge() {
    setEditing({
      id: "",
      set_id: "custom-",
      version: "1",
      slug: "",
      title: "",
      category: "events",
      status: "active",
      source: "custom",
      owner_count: null,
      start_date: null,
      end_date: null,
      created_at: new Date().toISOString(),
      description: "",
      how_to_earn: "",
      image_url_1x: "",
      image_url_2x: "",
      image_url_4x: "",
      click_url: "",
      is_paid: false,
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-56 flex-1 text-xs font-semibold text-muted">
          {t("search")}
          <input
            className="input mt-1 w-full"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchPlaceholder")}
          />
        </label>
        <label className="flex items-center gap-2 text-xs font-semibold text-muted">
          <input type="checkbox" checked={customOnly} onChange={(event) => setCustomOnly(event.target.checked)} />
          {t("customOnly")}
        </label>
        <button type="button" className="btn btn-primary px-3 py-1.5 text-xs" onClick={newBadge}>
          {t("new")}
        </button>
      </div>
      <p className="text-xs text-muted">{t("hint")}</p>
      <AdminStatus error={error} notice={notice} />

      <div className="card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("col.badge")}</th>
              <th>{t("col.setId")}</th>
              <th>{t("col.category")}</th>
              <th>{t("col.status")}</th>
              <th>{t("col.source")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {badges.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-muted">{t("empty")}</td>
              </tr>
            ) : (
              badges.map((badge) => (
                <tr key={badge.id}>
                  <td>{badge.title}</td>
                  <td className="text-muted">{badge.set_id} v{badge.version}</td>
                  <td><span className="chip">{badge.category}</span></td>
                  <td>{badge.status}</td>
                  <td className="text-muted">{badge.source}</td>
                  <td className="text-end">
                    <button
                      type="button"
                      className="btn px-2 py-1 text-[0.6875rem]"
                      onClick={async () => {
                        editingRequest.current = badge.id;
                        const res = await fetch(`/api/admin/content?resource=badges&id=${badge.id}`);
                        if (!res.ok) return;
                        const full = (await res.json()) as BadgeFull;
                        // Discard a response for a badge the operator has already
                        // navigated away from.
                        if (editingRequest.current !== badge.id) return;
                        setEditing(full);
                      }}
                    >
                      {t("edit")}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editing ? (
        <div className="card space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-muted">
              {t("field.setId")}
              <input className="input mt-1 w-full" value={editing.set_id} onChange={(e) => setEditing({ ...editing, set_id: e.target.value })} />
            </label>
            <label className="text-xs font-semibold text-muted">
              {t("field.version")}
              <input className="input mt-1 w-full" value={editing.version} onChange={(e) => setEditing({ ...editing, version: e.target.value })} />
            </label>
            <label className="text-xs font-semibold text-muted sm:col-span-2">
              {t("field.title")}
              <input className="input mt-1 w-full" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
            </label>
            <label className="text-xs font-semibold text-muted">
              {t("field.category")}
              <select className="input mt-1 w-full" value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>
                {CATEGORIES.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-muted">
              {t("field.status")}
              <select className="input mt-1 w-full" value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
                {STATUSES.map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-muted">
              {t("field.start")}
              <input className="input mt-1 w-full" type="datetime-local" value={toLocalInput(editing.start_date)} onChange={(e) => setEditing({ ...editing, start_date: e.target.value ? new Date(e.target.value).toISOString() : null })} />
            </label>
            <label className="text-xs font-semibold text-muted">
              {t("field.end")}
              <input className="input mt-1 w-full" type="datetime-local" value={toLocalInput(editing.end_date)} onChange={(e) => setEditing({ ...editing, end_date: e.target.value ? new Date(e.target.value).toISOString() : null })} />
            </label>
            <label className="text-xs font-semibold text-muted sm:col-span-2">
              {t("field.image")}
              <input className="input mt-1 w-full" value={editing.image_url_1x ?? ""} onChange={(e) => setEditing({ ...editing, image_url_1x: e.target.value })} />
            </label>
            <label className="text-xs font-semibold text-muted sm:col-span-2">
              {t("field.clickUrl")}
              <input className="input mt-1 w-full" value={editing.click_url ?? ""} onChange={(e) => setEditing({ ...editing, click_url: e.target.value })} />
            </label>
            <label className="text-xs font-semibold text-muted sm:col-span-2">
              {t("field.description")}
              <input className="input mt-1 w-full" value={editing.description ?? ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            </label>
            <label className="text-xs font-semibold text-muted sm:col-span-2">
              {t("field.howToEarn")}
              <input className="input mt-1 w-full" value={editing.how_to_earn ?? ""} onChange={(e) => setEditing({ ...editing, how_to_earn: e.target.value })} />
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold text-muted">
              <input type="checkbox" checked={editing.is_paid} onChange={(e) => setEditing({ ...editing, is_paid: e.target.checked })} />
              {t("field.paid")}
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-primary px-3 py-1.5 text-xs"
              disabled={busy}
              onClick={async () => {
                if (busy) return;
                setBusy(true);
                try {
                  const { ok, error: failure } = await call({
                    resource: "badges",
                    action: "save",
                    id: editing.id || undefined,
                    input: {
                      setId: editing.set_id,
                      version: editing.version,
                      title: editing.title,
                      description: editing.description,
                      howToEarn: editing.how_to_earn,
                      category: editing.category,
                      imageUrl1x: editing.image_url_1x,
                      imageUrl2x: editing.image_url_2x,
                      imageUrl4x: editing.image_url_4x,
                      clickUrl: editing.click_url,
                      isPaid: editing.is_paid,
                      startDate: editing.start_date,
                      endDate: editing.end_date,
                      status: editing.status,
                    },
                  });
                  if (ok) {
                    setNotice(t("saved"));
                    setEditing(null);
                    await load();
                  } else setError(failure ?? t("saveFailed"));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t("save")}
            </button>
            <button type="button" className="btn btn-ghost px-3 py-1.5 text-xs" onClick={() => setEditing(null)}>
              {t("cancel")}
            </button>
            {editing.id ? (
              <button
                type="button"
                className="btn px-3 py-1.5 text-xs text-danger"
                disabled={busy}
                onClick={async () => {
                  if (busy) return;
                  if (!window.confirm(t("confirmDelete"))) return;
                  setBusy(true);
                  try {
                    const { ok, error: failure } = await call({ resource: "badges", action: "delete", id: editing.id });
                    if (ok) {
                      setNotice(t("deleted"));
                      setEditing(null);
                      await load();
                    } else setError(failure ?? t("saveFailed"));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t("delete")}
              </button>
            ) : null}
          </div>
          {editing.id && editing.source !== "custom" ? (
            <p className="text-xs text-muted">{t("providerHint")}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}