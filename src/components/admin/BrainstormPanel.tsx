"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import AdminStatus from "./AdminStatus";

interface Idea {
  id: number;
  category: string;
  title: string;
  body: string;
  status: string;
  votes: number;
  created_at: string;
}

// Kept in step with the check constraint in migration 0028: the XP/level
// system, the coin economy, the admin dashboard, performance, usability and
// game addons are separate buckets on purpose — two hundred ideas filed under
// "other" are ideas nobody finds again.
const CATEGORIES = [
  "profile", "game", "addon", "badge", "design", "content",
  "stats", "performance", "usability", "xp", "coin", "admin", "other",
] as const;
const STATUSES = ["idea", "planned", "done", "rejected"] as const;

/** Idea board: grouped by category, sorted by votes, with an inline editor. */
export default function BrainstormPanel() {
  const t = useTranslations("admin.ideas");
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [category, setCategory] = useState("");
  const [editing, setEditing] = useState<{ id?: number; category: string; title: string; body: string; status: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // In-flight guard: `post()` serves both Save and Delete, so guarding it here
  // covers both buttons. A double click used to create the idea twice.
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ resource: "ideas" });
      if (category) params.set("category", category);
      const res = await fetch(`/api/admin/ideas?${params}`);
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { ideas: Idea[] };
      setIdeas(data.ideas);
    } catch {
      setError(t("loadFailed"));
    }
  }, [category, setError, t]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function post(payload: Record<string, unknown>, successKey?: string) {
    if (busy) return false;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/ideas", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? t("failed"));
        return false;
      }
      if (successKey) setNotice(t(successKey));
      await load();
      return true;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{t("intro")}</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-semibold text-muted">
          {t("filter")}
          <select className="input mt-1" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">{t("allCategories")}</option>
            {CATEGORIES.map((entry) => (
              <option key={entry} value={entry}>{entry}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn btn-primary px-3 py-1.5 text-xs"
          onClick={() => setEditing({ category: "profile", title: "", body: "", status: "idea" })}
        >
          {t("new")}
        </button>
      </div>

      <AdminStatus error={error} notice={notice} />

      <div className="space-y-2">
        {ideas.length === 0 ? (
          <p className="card p-4 text-sm text-muted">{t("empty")}</p>
        ) : (
          ideas.map((idea) => (
            <div key={idea.id} className="card flex flex-wrap items-start gap-3 p-3">
              <div className="flex flex-col items-center gap-0.5">
                <button
                  type="button"
                  className="btn px-2 py-0.5 text-[0.6875rem]"
                  aria-label={t("upvote")}
                  onClick={() => void post({ action: "vote", id: idea.id, up: true })}
                >
                  ▲
                </button>
                <span className="text-sm font-bold">{idea.votes}</span>
                <button
                  type="button"
                  className="btn px-2 py-0.5 text-[0.6875rem]"
                  aria-label={t("downvote")}
                  onClick={() => void post({ action: "vote", id: idea.id, up: false })}
                >
                  ▼
                </button>
              </div>
              <div className="min-w-48 flex-1">
                <p className="font-semibold">{idea.title}</p>
                {idea.body ? <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted">{idea.body}</p> : null}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="chip">{idea.category}</span>
                  <span className={`chip ${idea.status === "done" ? "" : ""}`}>{idea.status}</span>
                  <span className="text-[0.6875rem] text-muted">
                    {new Date(idea.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  className="btn px-2 py-1 text-[0.6875rem]"
                  onClick={() =>
                    setEditing({ id: idea.id, category: idea.category, title: idea.title, body: idea.body, status: idea.status })
                  }
                >
                  {t("edit")}
                </button>
                <button
                  type="button"
                  className="btn px-2 py-1 text-[0.6875rem] text-danger"
                  disabled={busy}
                  onClick={async () => {
                    if (window.confirm(t("confirmDelete"))) await post({ action: "delete", id: idea.id }, "deleted");
                  }}
                >
                  {t("delete")}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {editing ? (
        <div className="card space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-semibold text-muted">
              {t("field.category")}
              <select className="input mt-1 w-full" value={editing.category} onChange={(event) => setEditing({ ...editing, category: event.target.value })}>
                {CATEGORIES.map((entry) => (
                  <option key={entry} value={entry}>{entry}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-muted">
              {t("field.status")}
              <select className="input mt-1 w-full" value={editing.status} onChange={(event) => setEditing({ ...editing, status: event.target.value })}>
                {STATUSES.map((entry) => (
                  <option key={entry} value={entry}>{entry}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-muted sm:col-span-1">
              {t("field.title")}
              <input className="input mt-1 w-full" value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} />
            </label>
          </div>
          <label className="block text-xs font-semibold text-muted">
            {t("field.body")}
            <textarea
              className="input mt-1 min-h-28 w-full text-xs"
              value={editing.body}
              onChange={(event) => setEditing({ ...editing, body: event.target.value })}
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-primary px-3 py-1.5 text-xs"
              disabled={busy}
              onClick={async () => {
                if (await post({ action: "save", id: editing.id, input: editing }, "saved")) setEditing(null);
              }}
            >
              {t("save")}
            </button>
            <button type="button" className="btn btn-ghost px-3 py-1.5 text-xs" onClick={() => setEditing(null)}>
              {t("cancel")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}