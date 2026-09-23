"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import AdminStatus from "./AdminStatus";

type Stage = "passcode" | "setup" | "done";

/**
 * The bootstrap door: passcode, then owner registration. Both steps are
 * one-shot — once an owner exists the server answers 410 and this component
 * is never rendered again.
 */
export default function AdminGate({ stage }: { stage: "passcode" | "setup" }) {
  const t = useTranslations("admin");
  const router = useRouter();
  const [current, setCurrent] = useState<Stage>(stage);
  const [passcode, setPasscode] = useState("");
  const [username, setUsername] = useState("");
  const [twitchId, setTwitchId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submitPasscode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      if (!res.ok) {
        setError(
          res.status === 429
            ? t("gate.throttled")
            : res.status === 410
              ? t("gate.closed")
              : t("gate.invalid"),
        );
        return;
      }
      setCurrent("setup");
      router.refresh();
    } catch {
      setError(t("gate.network"));
    } finally {
      setBusy(false);
    }
  }

  async function submitSetup(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, twitchId }),
      });
      if (!res.ok) {
        setError(
          res.status === 404 ? t("setup.notFound") : t("setup.failed"),
        );
        return;
      }
      setCurrent("done");
      router.refresh();
    } catch {
      setError(t("gate.network"));
    } finally {
      setBusy(false);
    }
  }

  if (current === "done") {
    return (
      <div className="card p-6">
        <h1 className="text-lg font-bold">{t("setup.doneTitle")}</h1>
        <p className="mt-2 text-sm text-muted">{t("setup.doneBody")}</p>
      </div>
    );
  }

  if (current === "setup") {
    return (
      <form onSubmit={submitSetup} className="card space-y-4 p-6">
        <div>
          <h1 className="text-lg font-bold">{t("setup.title")}</h1>
          <p className="mt-1 text-sm text-muted">{t("setup.intro")}</p>
        </div>
        <label className="block text-sm font-semibold">
          {t("setup.usernameLabel")}
          <input
            className="input mt-1 w-full"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="twitchname"
            required
            minLength={3}
            maxLength={25}
            autoComplete="off"
          />
        </label>
        <label className="block text-sm font-semibold">
          {t("setup.twitchIdLabel")}
          <input
            className="input mt-1 w-full"
            value={twitchId}
            onChange={(event) => setTwitchId(event.target.value)}
            placeholder={t("setup.twitchIdPlaceholder")}
            inputMode="numeric"
            autoComplete="off"
          />
        </label>
        <AdminStatus error={error} />
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? t("common.working") : t("setup.submit")}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={submitPasscode} className="card space-y-4 p-6">
      <div>
        <h1 className="text-lg font-bold">{t("gate.title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("gate.intro")}</p>
      </div>
      <label className="block text-sm font-semibold">
        {t("gate.passcodeLabel")}
        <input
          className="input mt-1 w-full"
          type="password"
          value={passcode}
          onChange={(event) => setPasscode(event.target.value)}
          autoComplete="off"
          required
        />
      </label>
      <AdminStatus error={error} />
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? t("common.working") : t("gate.submit")}
      </button>
      <p className="text-xs text-muted">{t("gate.hint")}</p>
    </form>
  );
}