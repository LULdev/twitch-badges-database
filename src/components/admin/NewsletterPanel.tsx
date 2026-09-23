"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import AdminStatus from "./AdminStatus";

interface Draft {
  id: number;
  subject: string;
  body: string;
  status: string;
  channel: string;
  recipient_count: number;
  sent_at: string | null;
  created_at: string;
}

/** Recipient counts only — nullable, because the count can fail. Configuration is
 *  reported separately and never inferred from a failed count. */
interface Audience {
  emails: number | null;
  pushSubscriptions: number | null;
}

interface SendResult {
  channel: string;
  sent: number;
  failed: number;
  note: string;
}

const CHANNELS = ["push", "email", "both"] as const;

export default function NewsletterPanel() {
  const t = useTranslations("admin.newsletter");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [audience, setAudience] = useState<Audience | null>(null);
  const [emailConfigured, setEmailConfigured] = useState<boolean | null>(null);
  const [editing, setEditing] = useState<{ id?: number; subject: string; body: string; channel: string } | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/newsletter");
      if (!res.ok) throw new Error();
      const data = (await res.json()) as {
        drafts: Draft[];
        audience: Audience | null;
        emailConfigured: boolean;
      };
      setDrafts(data.drafts);
      setAudience(data.audience);
      setEmailConfigured(data.emailConfigured);
    } catch {
      setError(t("loadFailed"));
    }
  }, [setError, t]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function post(payload: Record<string, unknown>, successKey: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/newsletter", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; result?: SendResult };
      if (!res.ok) {
        setError(data.error ?? t("failed"));
        return false;
      }
      setNotice(t(successKey));
      if (data.result) setResult(data.result);
      await load();
      return true;
    } catch {
      setError(t("failed"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{t("intro")}</p>
      {audience || emailConfigured !== null ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="card p-3">
            <p className="text-xs font-semibold text-muted">{t("audienceEmails")}</p>
            <p className="text-xl font-bold">{audience ? (audience.emails ?? "—") : "—"}</p>
          </div>
          <div className="card p-3">
            <p className="text-xs font-semibold text-muted">{t("audiencePush")}</p>
            <p className="text-xl font-bold">
              {audience ? (audience.pushSubscriptions ?? "—") : "—"}
            </p>
          </div>
          <div className="card p-3">
            <p className="text-xs font-semibold text-muted">{t("provider")}</p>
            <p className={`text-sm font-bold ${emailConfigured ? "text-success" : "text-danger"}`}>
              {emailConfigured === null
                ? "—"
                : emailConfigured
                  ? t("providerResend")
                  : t("providerNone")}
            </p>
          </div>
        </div>
      ) : null}
      {emailConfigured === false ? (
        <p className="rounded-lg bg-surface-2 p-3 text-xs text-muted">{t("noProviderHint")}</p>
      ) : null}

      <AdminStatus error={error} notice={notice} />
      {result ? (
        <p className="rounded-lg bg-surface-2 p-3 text-xs text-muted">
          {t("delivery", { channel: result.channel, sent: result.sent, failed: result.failed })} — {result.note}
        </p>
      ) : null}

      <button
        type="button"
        className="btn btn-primary px-3 py-1.5 text-xs"
        onClick={() =>
          setEditing({
            subject: "",
            body: "",
            // Chosen from the PROVIDER state, never from the recipient count. With
            // the provider unknown, "both" is the safe default: push is the fallback
            // either way, whereas defaulting to "push" would skip the mail path on
            // an installation that does have a provider.
            channel: emailConfigured === null ? "both" : emailConfigured ? "email" : "push",
          })
        }
      >
        {t("new")}
      </button>

      <div className="card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("col.subject")}</th>
              <th>{t("col.channel")}</th>
              <th>{t("col.status")}</th>
              <th>{t("col.recipients")}</th>
              <th>{t("col.date")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {drafts.length === 0 ? (
              <tr><td colSpan={6} className="text-center text-muted">{t("empty")}</td></tr>
            ) : (
              drafts.map((draft) => (
                <tr key={draft.id}>
                  <td>{draft.subject}</td>
                  <td><span className="chip">{draft.channel}</span></td>
                  <td>{draft.status}</td>
                  <td>{draft.recipient_count}</td>
                  <td className="text-muted">
                    {new Date(draft.sent_at ?? draft.created_at).toLocaleDateString()}
                  </td>
                  <td className="text-end">
                    <button
                      type="button"
                      className="btn px-2 py-1 text-[0.6875rem]"
                      onClick={() =>
                        setEditing({ id: draft.id, subject: draft.subject, body: draft.body, channel: draft.channel })
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

      {editing ? (
        <div className="card space-y-3 p-4">
          <label className="block text-xs font-semibold text-muted">
            {t("field.subject")}
            <input
              className="input mt-1 w-full"
              value={editing.subject}
              onChange={(event) => setEditing({ ...editing, subject: event.target.value })}
            />
          </label>
          <label className="block text-xs font-semibold text-muted">
            {t("field.body")}
            <textarea
              className="input mt-1 min-h-40 w-full text-xs"
              value={editing.body}
              onChange={(event) => setEditing({ ...editing, body: event.target.value })}
            />
          </label>
          <label className="block text-xs font-semibold text-muted">
            {t("field.channel")}
            <select
              className="input mt-1"
              value={editing.channel}
              onChange={(event) => setEditing({ ...editing, channel: event.target.value })}
            >
              {CHANNELS.map((channel) => (
                <option key={channel} value={channel}>{channel}</option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-primary px-3 py-1.5 text-xs"
              disabled={busy}
              onClick={async () => {
                if (await post({ action: "save", ...editing }, "saved")) setEditing(null);
              }}
            >
              {t("save")}
            </button>
            {editing.id !== undefined ? (
              <button
                type="button"
                className="btn px-3 py-1.5 text-xs"
                disabled={busy}
                onClick={async () => {
                  if (!window.confirm(t("confirmSend"))) return;
                  await post({ action: "send", id: editing.id }, "sent");
                }}
              >
                {t("send")}
              </button>
            ) : null}
            <button type="button" className="btn btn-ghost px-3 py-1.5 text-xs" onClick={() => setEditing(null)}>
              {t("cancel")}
            </button>
            {editing.id !== undefined ? (
              <button
                type="button"
                className="btn px-3 py-1.5 text-xs text-danger"
                disabled={busy}
                onClick={async () => {
                  if (!window.confirm(t("confirmDelete"))) return;
                  if (await post({ action: "delete", id: editing.id }, "deleted")) setEditing(null);
                }}
              >
                {t("delete")}
              </button>
            ) : null}
          </div>
          <p className="text-xs text-muted">{t("sendHint")}</p>
        </div>
      ) : null}
    </div>
  );
}