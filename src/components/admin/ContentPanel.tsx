"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import AdminStatus from "./AdminStatus";

interface Post {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  status: string;
  is_auto: boolean;
  locale: string;
  tags: string[];
  author: string | null;
  published_at: string;
}
interface PostFull extends Post {
  content: string;
  cover_url: string | null;
}

interface ChangelogRow {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  created_at: string;
}

const KINDS = [
  "feature",
  "bugfix",
  "data_sync",
  "badge_added",
  "badge_updated",
  "badge_removed",
  "blog",
  "push",
] as const;

async function call(payload: Record<string, unknown>) {
  const res = await fetch("/api/admin/content", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: res.ok, error: data.error };
}

export default function ContentPanel() {
  const t = useTranslations("admin.content");
  const [tab, setTab] = useState<"blog" | "changelog">("blog");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <nav className="flex gap-1">
        {(["blog", "changelog"] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => {
              setTab(entry);
              // The error/notice banner is shared by both sub-views; clear it on
              // switch so a Blog failure is not shown as the Changelog's.
              setError(null);
              setNotice(null);
            }}
            className={`rounded-lg px-3 py-1.5 text-[0.8125rem] font-semibold ${
              tab === entry ? "bg-accent-soft text-accent" : "text-muted hover:text-foreground"
            }`}
          >
            {t(`tabs.${entry}`)}
          </button>
        ))}
      </nav>
      <AdminStatus error={error} notice={notice} />
      {tab === "blog" ? (
        <BlogAdmin setError={setError} setNotice={setNotice} />
      ) : (
        <ChangelogAdmin setError={setError} setNotice={setNotice} />
      )}
    </div>
  );
}

function BlogAdmin({
  setError,
  setNotice,
}: {
  setError: (value: string | null) => void;
  setNotice: (value: string | null) => void;
}) {
  const t = useTranslations("admin.content");
  const [posts, setPosts] = useState<Post[]>([]);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<PostFull | null>(null);
  const [loading, setLoading] = useState(false);
  // A double click used to POST twice; for a new entry both posts carry
  // `id: undefined`, so the second collides on the derived slug while the first
  // reported "saved" — one success and one error banner for one action.
  const [busy, setBusy] = useState(false);
  // The latest post the operator asked to edit, compared after the await so a
  // stale response cannot replace the editor they are now looking at.
  const editingRequest = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ resource: "blog", limit: "20" });
      if (query.trim()) params.set("q", query.trim());
      const res = await fetch(`/api/admin/content?${params}`);
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { posts: Post[] };
      setPosts(data.posts);
    } catch {
      setError(t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [query, setError, t]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  async function openEditor(id: string) {
    editingRequest.current = id;
    const res = await fetch(`/api/admin/content?resource=blog&id=${id}`);
    if (!res.ok) return setError(t("loadFailed"));
    const full = (await res.json()) as PostFull;
    // Discard a response for a post the operator has already navigated away from.
    if (editingRequest.current !== id) return;
    setEditing(full);
  }

  function newPost() {
    setEditing({
      id: "",
      slug: "",
      title: "",
      excerpt: "",
      content: "",
      cover_url: "",
      author: "Twitch Badges Database",
      status: "draft",
      is_auto: false,
      locale: "en",
      tags: [],
      published_at: new Date().toISOString(),
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-56 flex-1 text-xs font-semibold text-muted">
          {t("search")}
          <input className="input mt-1 w-full" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <button type="button" className="btn btn-primary px-3 py-1.5 text-xs" onClick={newPost}>
          {t("new")}
        </button>
      </div>

      <div className="card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("col.title")}</th>
              <th>{t("col.slug")}</th>
              <th>{t("col.status")}</th>
              <th>{t("col.date")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading && posts.length === 0 ? (
              <tr><td colSpan={5} className="text-center text-muted">{t("loading")}</td></tr>
            ) : posts.length === 0 ? (
              <tr><td colSpan={5} className="text-center text-muted">{t("empty")}</td></tr>
            ) : (
              posts.map((post) => (
                <tr key={post.id}>
                  <td>
                    {post.title}
                    {post.is_auto ? <span className="ms-2 chip">{t("auto")}</span> : null}
                  </td>
                  <td className="text-muted">{post.slug}</td>
                  <td><span className="chip">{post.status}</span></td>
                  <td className="text-muted">{new Date(post.published_at).toLocaleDateString()}</td>
                  <td className="text-end">
                    <button type="button" className="btn px-2 py-1 text-[0.6875rem]" onClick={() => void openEditor(post.id)}>
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
              {t("field.title")}
              <input className="input mt-1 w-full" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
            </label>
            <label className="text-xs font-semibold text-muted">
              {t("field.slug")}
              <input className="input mt-1 w-full" value={editing.slug} onChange={(e) => setEditing({ ...editing, slug: e.target.value })} placeholder={t("field.slugHint")} />
            </label>
            <label className="text-xs font-semibold text-muted">
              {t("field.author")}
              <input className="input mt-1 w-full" value={editing.author ?? ""} onChange={(e) => setEditing({ ...editing, author: e.target.value })} />
            </label>
            <label className="text-xs font-semibold text-muted">
              {t("field.locale")}
              <input className="input mt-1 w-full" value={editing.locale} onChange={(e) => setEditing({ ...editing, locale: e.target.value })} />
            </label>
            <label className="text-xs font-semibold text-muted">
              {t("field.status")}
              <select className="input mt-1 w-full" value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
                <option value="draft">draft</option>
                <option value="published">published</option>
              </select>
            </label>
            <label className="text-xs font-semibold text-muted">
              {t("field.cover")}
              <input className="input mt-1 w-full" value={editing.cover_url ?? ""} onChange={(e) => setEditing({ ...editing, cover_url: e.target.value })} />
            </label>
            <label className="text-xs font-semibold text-muted sm:col-span-2">
              {t("field.tags")}
              <input className="input mt-1 w-full" value={editing.tags.join(", ")} onChange={(e) => setEditing({ ...editing, tags: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} placeholder={t("field.tagsHint")} />
            </label>
            <label className="text-xs font-semibold text-muted sm:col-span-2">
              {t("field.excerpt")}
              <input className="input mt-1 w-full" value={editing.excerpt ?? ""} onChange={(e) => setEditing({ ...editing, excerpt: e.target.value })} />
            </label>
          </div>
          <label className="block text-xs font-semibold text-muted">
            {t("field.content")}
            <textarea
              className="input mt-1 min-h-48 w-full font-mono text-xs"
              value={editing.content}
              onChange={(e) => setEditing({ ...editing, content: e.target.value })}
              placeholder={t("field.contentHint")}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-primary px-3 py-1.5 text-xs"
              disabled={busy}
              onClick={async () => {
                if (busy) return;
                setBusy(true);
                try {
                  const { ok, error } = await call({
                    resource: "blog",
                    action: "save",
                    id: editing.id || undefined,
                    input: {
                      slug: editing.slug,
                      title: editing.title,
                      excerpt: editing.excerpt,
                      content: editing.content,
                      coverUrl: editing.cover_url,
                      author: editing.author,
                      status: editing.status,
                      locale: editing.locale,
                      tags: editing.tags,
                    },
                  });
                  if (ok) {
                    setNotice(t("saved"));
                    setEditing(null);
                    await load();
                  } else setError(error ?? t("saveFailed"));
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
                    const { ok, error } = await call({ resource: "blog", action: "delete", id: editing.id });
                    if (ok) {
                      setNotice(t("deleted"));
                      setEditing(null);
                      await load();
                    } else setError(error ?? t("saveFailed"));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t("delete")}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ChangelogAdmin({
  setError,
  setNotice,
}: {
  setError: (value: string | null) => void;
  setNotice: (value: string | null) => void;
}) {
  const t = useTranslations("admin.content");
  const [entries, setEntries] = useState<ChangelogRow[]>([]);
  const [draft, setDraft] = useState<{ id?: number; kind: string; title: string; body: string; payload: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/content?resource=changelog&limit=30");
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { entries: ChangelogRow[] };
      setEntries(data.entries);
    } catch {
      setError(t("loadFailed"));
    }
  }, [setError, t]);

  useEffect(() => {
    // Deferred by a tick: the React Compiler lint rule rejects a setState that
    // runs synchronously in an effect body.
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <div className="space-y-3">
      <button type="button" className="btn btn-primary px-3 py-1.5 text-xs" onClick={() => setDraft({ kind: "feature", title: "", body: "", payload: "" })}>
        {t("new")}
      </button>

      <div className="card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("changelog.kind")}</th>
              <th>{t("col.title")}</th>
              <th>{t("col.date")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr><td colSpan={4} className="text-center text-muted">{t("empty")}</td></tr>
            ) : (
              entries.map((entry) => (
                <tr key={entry.id}>
                  <td><span className="chip">{entry.kind}</span></td>
                  <td>{entry.title}</td>
                  <td className="text-muted">{new Date(entry.created_at).toLocaleDateString()}</td>
                  <td className="text-end">
                    <button
                      type="button"
                      className="btn px-2 py-1 text-[0.6875rem]"
                      onClick={() =>
                        setDraft({
                          id: entry.id,
                          kind: entry.kind,
                          title: entry.title,
                          body: entry.body ?? "",
                          payload: "",
                        })
                      }
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

      {draft ? (
        <div className="card space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-muted">
              {t("changelog.kind")}
              <select className="input mt-1 w-full" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
                {KINDS.map((kind) => (
                  <option key={kind} value={kind}>{kind}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-muted">
              {t("field.title")}
              <input className="input mt-1 w-full" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </label>
          </div>
          <label className="block text-xs font-semibold text-muted">
            {t("changelog.body")}
            <textarea className="input mt-1 min-h-32 w-full text-xs" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          </label>
          {draft.id === undefined ? (
            <label className="block text-xs font-semibold text-muted">
              {t("changelog.payload")}
              <input
                className="input mt-1 w-full font-mono text-xs"
                value={draft.payload}
                onChange={(e) => setDraft({ ...draft, payload: e.target.value })}
                placeholder='{"key": "value"}'
              />
            </label>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-primary px-3 py-1.5 text-xs"
              disabled={busy}
              onClick={async () => {
                if (busy) return;
                let payload: unknown = null;
                if (draft.payload.trim()) {
                  try {
                    payload = JSON.parse(draft.payload);
                  } catch {
                    setError(t("badJson"));
                    return;
                  }
                }
                setBusy(true);
                try {
                  const input: Record<string, unknown> = {
                    kind: draft.kind,
                    title: draft.title,
                    body: draft.body,
                  };
                  // An EDIT sends no `payload` unless the operator typed one: the
                  // field is hidden for existing entries, and sending an explicit
                  // null (which is not `undefined`) nulled the stored payload of
                  // every entry an operator merely renamed.
                  if (draft.id === undefined || draft.payload.trim()) {
                    input.payload = payload;
                  }
                  const { ok, error } = await call({
                    resource: "changelog",
                    action: "save",
                    id: draft.id,
                    input,
                  });
                  if (ok) {
                    setNotice(t("saved"));
                    setDraft(null);
                    await load();
                  } else setError(error ?? t("saveFailed"));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t("save")}
            </button>
            <button type="button" className="btn btn-ghost px-3 py-1.5 text-xs" onClick={() => setDraft(null)}>
              {t("cancel")}
            </button>
            {draft.id !== undefined ? (
              <button
                type="button"
                className="btn px-3 py-1.5 text-xs text-danger"
                disabled={busy}
                onClick={async () => {
                  if (busy) return;
                  if (!window.confirm(t("confirmDelete"))) return;
                  setBusy(true);
                  try {
                    const { ok, error } = await call({ resource: "changelog", action: "delete", id: draft.id });
                    if (ok) {
                      setNotice(t("deleted"));
                      setDraft(null);
                      await load();
                    } else setError(error ?? t("saveFailed"));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t("delete")}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}