"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { formatCompact } from "@/components/badges/BadgeCard";
import AdminStatus from "./AdminStatus";

interface UserRow {
  id: string;
  username: string;
  display_name: string | null;
  twitch_id: string | null;
  avatar_url: string | null;
  role: string;
  is_admin: boolean;
  created_at: string;
  xp: number;
  coins: number;
  level: number;
  login_streak: number;
  banned: boolean;
  banned_until: string | null;
  ban_reason: string | null;
}

interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  color: string | null;
  banner_url: string | null;
  theme: string | null;
  mood: string | null;
  role: string;
  twitch_id: string | null;
  avatar_url: string | null;
  inventory_public: boolean | null;
  steal_enabled: boolean | null;
  steal_price: number | null;
  steal_max: number | null;
  showcase_slots: unknown;
  customization: unknown;
  view_count: number | null;
}

interface Progress {
  xp: number;
  coins: number;
  level: number;
  login_streak: number;
  best_login_streak: number;
}

interface Detail {
  profile: Profile;
  progress: Progress | null;
  achievements: Array<{ achievement_id: string; unlocked_at: string }>;
  ban: { reason: string; banned_until: string | null; created_at: string } | null;
}

interface CatalogEntry {
  id: string;
  category: string;
  title: string;
  points: number;
  active: boolean;
}

const ROLES = ["user", "moderator", "admin", "owner"] as const;

export default function UsersPanel() {
  const t = useTranslations("admin.users");
  const [query, setQuery] = useState("");
  const [bannedOnly, setBannedOnly] = useState(false);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // `busy` drives the disabled buttons; the ref guards the same-tick double
  // dispatch, which a state flag has not re-rendered in time to catch.
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  // The latest member the operator asked to open, compared after every await so a
  // stale response cannot replace the drawer they are now looking at.
  const detailRequest = useRef<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "25" });
      if (query.trim()) params.set("q", query.trim());
      if (bannedOnly) params.set("banned", "1");
      const res = await fetch(`/api/admin/users?${params}`);
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { users: UserRow[]; total: number };
      setUsers(data.users);
      setTotal(data.total);
    } catch {
      setError(t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [query, bannedOnly, t]);

  // Debounced search: typing a Twitch name should not fire a request per key.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void load(), 250);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [load]);

  const openDetail = useCallback(async (id: string) => {
    setSelected(id);
    setDetail(null);
    setError(null);
    // Token: the latest member the operator asked to open. A slow response for a
    // member they have navigated away from must not overwrite the drawer they are
    // now looking at — without it A's detail landed after B was selected and the
    // form then edited A while the operator believed they had B.
    detailRequest.current = id;
    try {
      const [detailRes, achRes] = await Promise.all([
        fetch(`/api/admin/users?id=${id}`),
        fetch(`/api/admin/users/achievements?userId=${id}`),
      ]);
      if (!detailRes.ok) throw new Error("detail");
      const next = (await detailRes.json()) as Detail;
      if (detailRequest.current !== id) return;
      setDetail(next);
      if (achRes.ok) {
        const ach = (await achRes.json()) as { catalog: CatalogEntry[]; unlocked: string[] };
        if (detailRequest.current !== id) return;
        setCatalog(ach.catalog);
      }
    } catch {
      if (detailRequest.current !== id) return;
      setError(t("loadFailed"));
    }
  }, [t]);

  const act = useCallback(
    async (body: Record<string, unknown>, successKey: string) => {
      // In-flight guard: this panel was the one left out, so every action
      // (save/role/ban/delete/achievement) dispatched on a double click — the
      // second POST typically conflicted and set an error banner right after the
      // first had shown success.
      if (busyRef.current) return false;
      busyRef.current = true;
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const res = await fetch("/api/admin/users", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setError(data.error ?? t("actionFailed"));
          return false;
        }
        setNotice(t(successKey));
        await load();
        if (selected && body.action !== "delete") await openDetail(selected);
        return true;
      } catch {
        setError(t("actionFailed"));
        return false;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [load, openDetail, selected, t],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-56 text-xs font-semibold text-muted">
          {t("searchLabel")}
          <input
            className="input mt-1 w-full"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchPlaceholder")}
            autoComplete="off"
          />
        </label>
        <label className="flex items-center gap-2 text-xs font-semibold text-muted">
          <input
            type="checkbox"
            checked={bannedOnly}
            onChange={(event) => setBannedOnly(event.target.checked)}
          />
          {t("bannedOnly")}
        </label>
        <span className="text-xs text-muted">{t("count", { count: total })}</span>
      </div>

      <AdminStatus error={error} notice={notice} />

      <div className="card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("cols.user")}</th>
              <th>{t("cols.role")}</th>
              <th>{t("cols.level")}</th>
              <th>{t("cols.xp")}</th>
              <th>{t("cols.coins")}</th>
              <th>{t("cols.status")}</th>
              <th>{t("cols.joined")}</th>
            </tr>
          </thead>
          <tbody>
            {loading && users.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center text-muted">{t("loading")}</td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center text-muted">{t("empty")}</td>
              </tr>
            ) : (
              users.map((user) => (
                <tr
                  key={user.id}
                  onClick={() => void openDetail(user.id)}
                  className={`cursor-pointer ${selected === user.id ? "bg-surface-2" : ""}`}
                >
                  <td>
                    <div className="flex items-center gap-2">
                      {user.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={user.avatar_url} alt="" width={22} height={22} className="rounded-full" />
                      ) : (
                        <span className="grid size-[22px] place-items-center rounded-full bg-accent-soft text-[0.5625rem] font-bold text-accent">
                          {user.username.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                      {/* A real control, not just the row's onClick: a click-only
                          <tr> is unreachable by keyboard and announces nothing to
                          a screen reader. The row handler stays for pointer
                          convenience; stopPropagation keeps this from firing twice. */}
                      <button
                        type="button"
                        className="font-semibold hover:underline"
                        onClick={(event) => {
                          event.stopPropagation();
                          void openDetail(user.id);
                        }}
                      >
                        {user.username}
                      </button>
                    </div>
                  </td>
                  <td><span className="chip">{user.role}</span></td>
                  <td>{user.level}</td>
                  <td>{formatCompact(user.xp)}</td>
                  <td>{formatCompact(user.coins)}</td>
                  <td>
                    {user.banned ? (
                      <span className="chip chip-danger">{t("banned")}</span>
                    ) : (
                      <span className="text-muted">{t("active")}</span>
                    )}
                  </td>
                  <td className="text-muted">{new Date(user.created_at).toLocaleDateString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selected ? (
        <UserDrawer
          detail={detail}
          catalog={catalog}
          onClose={() => {
            detailRequest.current = null;
            setSelected(null);
            setDetail(null);
          }}
          act={act}
          busy={busy}
        />
      ) : null}
    </div>
  );
}

function UserDrawer({
  detail,
  catalog,
  onClose,
  act,
  busy,
}: {
  detail: Detail | null;
  catalog: CatalogEntry[];
  onClose: () => void;
  act: (body: Record<string, unknown>, successKey: string) => Promise<boolean>;
  busy: boolean;
}) {
  const t = useTranslations("admin.users");
  // The form keeps its own draft state, seeded once from the server row. The
  // `key` remounts it when a different member is selected — a useEffect that
  // copied detail into state would trip the React Compiler's
  // set-state-in-effect rule (and cascade a render on every refresh).
  if (!detail) {
    return <div className="card p-6 text-sm text-muted">{t("loading")}</div>;
  }
  return (
    <UserForm
      key={detail.profile.id}
      detail={detail}
      catalog={catalog}
      onClose={onClose}
      act={act}
      busy={busy}
    />
  );
}

function UserForm({
  detail,
  catalog,
  onClose,
  act,
  busy,
}: {
  detail: Detail;
  catalog: CatalogEntry[];
  onClose: () => void;
  act: (body: Record<string, unknown>, successKey: string) => Promise<boolean>;
  busy: boolean;
}) {
  const t = useTranslations("admin.users");
  const [fields, setFields] = useState<Partial<Profile>>({
    username: detail.profile.username,
    display_name: detail.profile.display_name ?? "",
    bio: detail.profile.bio ?? "",
    color: detail.profile.color ?? "",
    banner_url: detail.profile.banner_url ?? "",
    theme: detail.profile.theme ?? "",
    mood: detail.profile.mood ?? "",
    inventory_public: detail.profile.inventory_public ?? false,
    steal_enabled: detail.profile.steal_enabled ?? false,
    steal_price: detail.profile.steal_price ?? 0,
    steal_max: detail.profile.steal_max ?? 0,
  });
  const [progress, setProgress] = useState<Partial<Progress>>({
    xp: Number(detail.progress?.xp ?? 0),
    coins: Number(detail.progress?.coins ?? 0),
    level: Number(detail.progress?.level ?? 1),
    login_streak: Number(detail.progress?.login_streak ?? 0),
  });
  const [role, setRole] = useState(detail.profile.role);
  const [banReason, setBanReason] = useState("");
  const [banDays, setBanDays] = useState<number>(7);

  const unlocked = new Set(detail.achievements.map((a) => a.achievement_id));
  const id = detail.profile.id;

  return (
    <div className="card space-y-5 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-bold">
          {detail.profile.username}
          <span className="ms-2 text-xs font-normal text-muted">{id}</span>
        </h2>
        <button type="button" className="btn btn-ghost px-3 py-1.5 text-xs" onClick={onClose}>
          {t("close")}
        </button>
      </div>

      {detail.ban ? (
        <p className="rounded-lg bg-surface-2 p-3 text-xs text-muted">
          {t("ban.active", {
            reason: detail.ban.reason || t("ban.noReason"),
            until: detail.ban.banned_until
              ? new Date(detail.ban.banned_until).toLocaleString()
              : t("ban.permanent"),
          })}
        </p>
      ) : null}

      {/* Profile fields */}
      <section className="space-y-2">
        <h3 className="text-sm font-bold">{t("profile.title")}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {([
            ["username", "text"],
            ["display_name", "text"],
            ["bio", "text"],
            ["color", "text"],
            ["banner_url", "text"],
            ["theme", "text"],
            ["mood", "text"],
          ] as const).map(([key, kind]) => (
            <label key={key} className="text-xs font-semibold text-muted">
              {t(`field.${key}`)}
              <input
                className="input mt-1 w-full"
                type={kind}
                value={String(fields[key] ?? "")}
                onChange={(event) => setFields((f) => ({ ...f, [key]: event.target.value }))}
              />
            </label>
          ))}
          <label className="text-xs font-semibold text-muted">
            {t("field.steal_price")}
            <input
              className="input mt-1 w-full"
              type="number"
              min={0}
              value={fields.steal_price ?? 0}
              onChange={(event) => {
                // An emptied field used to become 0 via Number(""), so clearing a
                // value to retype it silently wrote a zero that Save persisted.
                const parsed = Number(event.target.value);
                setFields((f) => ({
                  ...f,
                  steal_price:
                    event.target.value.trim() !== "" && Number.isFinite(parsed)
                      ? Math.max(0, Math.trunc(parsed))
                      : f.steal_price,
                }));
              }}
            />
          </label>
          <label className="text-xs font-semibold text-muted">
            {t("field.steal_max")}
            <input
              className="input mt-1 w-full"
              type="number"
              min={0}
              value={fields.steal_max ?? 0}
              onChange={(event) => {
                // Same rule as steal_price above.
                const parsed = Number(event.target.value);
                setFields((f) => ({
                  ...f,
                  steal_max:
                    event.target.value.trim() !== "" && Number.isFinite(parsed)
                      ? Math.max(0, Math.trunc(parsed))
                      : f.steal_max,
                }));
              }}
            />
          </label>
          <label className="flex items-center gap-2 text-xs font-semibold text-muted">
            <input
              type="checkbox"
              checked={!!fields.inventory_public}
              onChange={(event) => setFields((f) => ({ ...f, inventory_public: event.target.checked }))}
            />
            {t("field.inventory_public")}
          </label>
          <label className="flex items-center gap-2 text-xs font-semibold text-muted">
            <input
              type="checkbox"
              checked={!!fields.steal_enabled}
              onChange={(event) => setFields((f) => ({ ...f, steal_enabled: event.target.checked }))}
            />
            {t("field.steal_enabled")}
          </label>
        </div>
        <button
          type="button"
          className="btn btn-primary px-3 py-1.5 text-xs"
          disabled={busy}
          onClick={() => void act({ action: "update", userId: id, patch: fields }, "saved")}
        >
          {t("profile.save")}
        </button>
      </section>

      {/* Progress */}
      <section className="space-y-2">
        <h3 className="text-sm font-bold">{t("progress.title")}</h3>
        <div className="grid gap-3 sm:grid-cols-4">
          {(["xp", "coins", "level", "login_streak"] as const).map((key) => (
            <label key={key} className="text-xs font-semibold text-muted">
              {t(`progress.${key}`)}
              <input
                className="input mt-1 w-full"
                type="number"
                min={0}
                value={progress[key] ?? 0}
                onChange={(event) => {
                  // Keep the last valid number while the field is empty.
                  const parsed = Number(event.target.value);
                  setProgress((p) => ({
                    ...p,
                    [key]:
                      event.target.value.trim() !== "" && Number.isFinite(parsed)
                        ? Math.max(0, Math.trunc(parsed))
                        : p[key],
                  }));
                }}
              />
            </label>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-primary px-3 py-1.5 text-xs"
          disabled={busy}
          onClick={() =>
            void act(
              {
                action: "progress",
                userId: id,
                xp: progress.xp,
                coins: progress.coins,
                level: progress.level,
                loginStreak: progress.login_streak,
              },
              "progressSaved",
            )
          }
        >
          {t("progress.save")}
        </button>
      </section>

      {/* Role */}
      <section className="space-y-2">
        <h3 className="text-sm font-bold">{t("role.title")}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="input"
            value={role}
            onChange={(event) => setRole(event.target.value)}
          >
            {ROLES.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          <button
            type="button"
            className="btn px-3 py-1.5 text-xs"
            disabled={busy}
            onClick={() => void act({ action: "role", userId: id, role }, "roleSaved")}
          >
            {t("role.apply")}
          </button>
        </div>
      </section>

      {/* Ban */}
      <section className="space-y-2">
        <h3 className="text-sm font-bold">{t("ban.title")}</h3>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex-1 min-w-40 text-xs font-semibold text-muted">
            {t("ban.reason")}
            <input
              className="input mt-1 w-full"
              value={banReason}
              onChange={(event) => setBanReason(event.target.value)}
            />
          </label>
          <label className="w-28 text-xs font-semibold text-muted">
            {t("ban.days")}
            <input
              className="input mt-1 w-full"
              type="number"
              min={0}
              value={banDays}
              onChange={(event) => {
                // Keep the last valid number while the field is empty or mid-edit,
                // the rule every other numeric field here uses. An emptied field
                // used to become null, which the server reads as a PERMANENT ban —
                // the harshest outcome, one click away with no confirmation.
                const parsed = Number(event.target.value);
                if (event.target.value.trim() !== "" && Number.isFinite(parsed) && parsed >= 0) {
                  setBanDays(Math.trunc(parsed));
                }
              }}
            />
          </label>
          <button
            type="button"
            className="btn px-3 py-1.5 text-xs"
            disabled={busy}
            onClick={() => {
              // 0 is the explicit "permanent" sentinel (the hint below says so) and
              // is the one outcome that deserves a confirmation: a timed ban has an
              // expiry to wait out, a permanent one does not.
              if (
                banDays === 0 &&
                !window.confirm(t("ban.confirmPermanent", { username: detail.profile.username }))
              ) {
                return;
              }
              void act(
                {
                  action: "ban",
                  userId: id,
                  reason: banReason,
                  days: banDays,
                },
                "ban.saved",
              );
            }}
          >
            {t("ban.apply")}
          </button>
          <button
            type="button"
            className="btn btn-ghost px-3 py-1.5 text-xs"
            disabled={busy}
            onClick={() => void act({ action: "unban", userId: id }, "ban.removed")}
          >
            {t("ban.lift")}
          </button>
        </div>
        <p className="text-xs text-muted">{t("ban.hint")}</p>
      </section>

      {/* Achievements */}
      <section className="space-y-2">
        <h3 className="text-sm font-bold">{t("achievements.title")}</h3>
        <div className="max-h-56 overflow-y-auto rounded-lg border border-line p-2">
          {catalog.filter((entry) => entry.active).map((entry) => {
            const has = unlocked.has(entry.id);
            return (
              <div key={entry.id} className="flex items-center justify-between gap-2 px-1 py-1">
                <span className="text-xs">
                  {entry.title}
                  <span className="ms-1 text-muted">({entry.points})</span>
                </span>
                <button
                  type="button"
                  className={`btn px-2 py-0.5 text-[0.6875rem] ${has ? "btn-ghost" : "btn-primary"}`}
                  disabled={busy}
                  onClick={() =>
                    void act(
                      {
                        action: has ? "revokeAchievement" : "grantAchievement",
                        userId: id,
                        achievementId: entry.id,
                      },
                      has ? "achievements.revoked" : "achievements.granted",
                    )
                  }
                >
                  {has ? t("achievements.revoke") : t("achievements.grant")}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* Danger zone */}
      <section className="space-y-2">
        <h3 className="text-sm font-bold text-danger">{t("danger.title")}</h3>
        <button
          type="button"
          className="btn px-3 py-1.5 text-xs text-danger"
          disabled={busy}
          onClick={() => {
            if (window.confirm(t("danger.confirm", { username: detail.profile.username }))) {
              void act({ action: "delete", userId: id }, "danger.deleted");
              onClose();
            }
          }}
        >
          {t("danger.delete")}
        </button>
      </section>
    </div>
  );
}