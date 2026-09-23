"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import UsersPanel from "./UsersPanel";
import ContentPanel from "./ContentPanel";
import BadgesPanel from "./BadgesPanel";
import SyncPanel from "./SyncPanel";
import SettingsPanel from "./SettingsPanel";
import StatsPanel from "./StatsPanel";
import StatusPanel from "./StatusPanel";
import NewsletterPanel from "./NewsletterPanel";
import BrainstormPanel from "./BrainstormPanel";
import AuditPanel from "./AuditPanel";

type TabId =
  | "users"
  | "content"
  | "badges"
  | "sync"
  | "settings"
  | "stats"
  | "status"
  | "newsletter"
  | "brainstorm"
  | "audit";

const TABS: Array<{ id: TabId; labelKey: string; ready: boolean }> = [
  { id: "users", labelKey: "tabs.users", ready: true },
  { id: "content", labelKey: "tabs.content", ready: true },
  { id: "badges", labelKey: "tabs.badges", ready: true },
  { id: "sync", labelKey: "tabs.sync", ready: true },
  { id: "settings", labelKey: "tabs.settings", ready: true },
  { id: "stats", labelKey: "tabs.stats", ready: true },
  { id: "status", labelKey: "tabs.status", ready: true },
  { id: "newsletter", labelKey: "tabs.newsletter", ready: true },
  { id: "brainstorm", labelKey: "tabs.brainstorm", ready: true },
  { id: "audit", labelKey: "tabs.audit", ready: true },
];

/**
 * The ACP frame: a tab strip plus the active panel. Tabs whose phase has not
 * landed yet stay visible but inert, so the shape of the panel is legible
 * instead of a mystery.
 */
export default function AdminShell({
  role,
  actor,
  locale,
}: {
  role: string;
  actor: string;
  locale: string;
}) {
  const t = useTranslations("admin");
  const [tab, setTab] = useState<TabId>("users");

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold tracking-tight">{t("dashboard.title")}</h1>
        <p className="text-xs text-muted">{t("dashboard.signedInAs", { role: `${actor} (${role})` })}</p>
      </header>

      <nav className="flex flex-wrap gap-1" aria-label={t("tabs.label")}>
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => entry.ready && setTab(entry.id)}
            disabled={!entry.ready}
            aria-current={tab === entry.id ? "page" : undefined}
            className={`rounded-lg px-3 py-1.5 text-[0.8125rem] font-semibold transition-colors ${
              tab === entry.id
                ? "bg-accent-soft text-accent"
                : entry.ready
                  ? "text-muted hover:bg-surface-2 hover:text-foreground"
                  : "cursor-not-allowed text-muted/40"
            }`}
          >
            {t(entry.labelKey)}
          </button>
        ))}
      </nav>

      {tab === "users" ? <UsersPanel /> : null}
      {tab === "content" ? <ContentPanel /> : null}
      {tab === "badges" ? <BadgesPanel /> : null}
      {tab === "sync" ? <SyncPanel /> : null}
      {tab === "settings" ? <SettingsPanel /> : null}
      {tab === "stats" ? <StatsPanel locale={locale} /> : null}
      {tab === "status" ? <StatusPanel locale={locale} /> : null}
      {tab === "newsletter" ? <NewsletterPanel /> : null}
      {tab === "brainstorm" ? <BrainstormPanel /> : null}
      {tab === "audit" ? <AuditPanel locale={locale} /> : null}
      {!TABS.find((entry) => entry.id === tab)?.ready ? (
        <p className="card p-6 text-sm text-muted">{t("tabs.soon")}</p>
      ) : null}
    </div>
  );
}