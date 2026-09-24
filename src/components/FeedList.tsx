"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import Coin from "@/components/Coin";

export interface FeedEvent {
  id: number;
  username: string | null;
  avatar_url: string | null;
  kind: string;
  title: string;
  body: string | null;
  xp_amount: number | null;
  coins_amount: number | null;
  created_at: string;
}

const KIND_COLORS: Record<string, string> = {
  xp: "var(--accent)",
  daily: "var(--info)",
  badge_claim: "var(--success)",
  wheel: "var(--warning)",
  game: "var(--accent)",
  achievement: "#fbbf24",
  steal: "#f87171",
  steal_defended: "var(--success)",
  level_up: "#a970ff",
  turbo_win: "#fbbf24",
  coin_rain: "var(--info)",
};

/** Public live feed with 5-second polling (real-time-ish). */
export default function FeedList({ initialEvents }: { initialEvents?: FeedEvent[] }) {
  const t = useTranslations("feed");
  const locale = useLocale();
  const [events, setEvents] = useState<FeedEvent[]>(initialEvents ?? []);
  const [paused, setPaused] = useState(false);
  const seenIds = useRef(new Set<number>((initialEvents ?? []).map((e) => e.id)));

  // Relative times are rendered only after mount: `Date.now()` during the
  // first render made the server and the hydrating client disagree by the
  // request latency, so any bucket boundary between the two clocks produced a
  // hydration mismatch on the "Xs/Xm/Xh" text.
  const [nowTick, setNowTick] = useState<number | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/feed?limit=30", { cache: "no-store" });
      const data = (await res.json()) as { events: FeedEvent[] };
      const fresh = (data.events ?? []).filter((event) => !seenIds.current.has(event.id));
      if (fresh.length > 0) {
        for (const event of fresh) seenIds.current.add(event.id);
        // The set exists only to de-duplicate incoming events; without a cap it
        // grows for as long as the page stays open.
        if (seenIds.current.size > 500) {
          const recent = new Set(
            (data.events ?? []).map((event) => event.id),
          );
          seenIds.current = recent;
        }
        setEvents((prev) => [...fresh, ...prev].slice(0, 60));
      }
    } catch {
      // ignore — next poll retries
    }
  }, []);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setNowTick(Date.now()));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (paused) return;
    const interval = setInterval(() => {
      // A background tab kept polling every 5s, burning requests and battery
      // for a feed nobody was looking at; it now resumes on the next tick
      // after the tab becomes visible again.
      if (document.hidden) return;
      setNowTick(Date.now());
      void poll();
    }, 5000);
    return () => clearInterval(interval);
  }, [paused, poll]);

  function timeAgo(iso: string, now: number): string {
    const seconds = Math.floor((now - new Date(iso).getTime()) / 1000);
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h`;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-xs font-semibold text-muted">
          <span className={`size-2 rounded-full ${paused ? "bg-muted" : "animate-pulse bg-success"}`} aria-hidden />
          {paused ? t("paused") : t("live")}
        </p>
        <button type="button" onClick={() => setPaused((prev) => !prev)} className="btn btn-ghost text-xs">
          {paused ? t("resume") : t("pause")}
        </button>
      </div>

      <ol className="space-y-2">
        {events.map((event) => (
          <li key={event.id} className="card flex items-start gap-3 p-3.5">
            <span
              aria-hidden
              className="mt-1.5 size-2 shrink-0 rounded-full"
              style={{ backgroundColor: KIND_COLORS[event.kind] ?? "var(--muted)" }}
            />
            {event.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={event.avatar_url} alt="" width={28} height={28} className="mt-0.5 rounded-full" />
            ) : (
              <span className="mt-0.5 grid size-7 place-items-center rounded-full bg-accent-soft text-[0.625rem] font-bold text-accent">
                {(event.username ?? "?").slice(0, 2).toUpperCase()}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-snug">
                {event.username ? (
                  <Link href={`/profile/${event.username}`} className="font-bold hover:text-accent">
                    {event.username}
                  </Link>
                ) : (
                  <span className="font-bold">{t("anonymous")}</span>
                )}{" "}
                {event.title}
              </p>
              {/* The `body` column was written by every producer (an achievement's
                  description, the level badge it unlocked) and selected by both feed
                  readers, but never rendered — so "unlocked: Ghost Town" had no
                  explanation anywhere. */}
              {event.body ? (
                <p className="mt-0.5 text-xs text-muted">{event.body}</p>
              ) : null}
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                <span>{t(event.kind)}</span>
                {nowTick !== null ? <span>· {timeAgo(event.created_at, nowTick)}</span> : null}
                {event.xp_amount ? <span className="font-bold text-accent">+{event.xp_amount} XP</span> : null}
                {event.coins_amount ? (
                  <span dir="ltr" className={`inline-flex items-center gap-1 font-bold ${event.coins_amount > 0 ? "text-success" : "text-danger"}`}>
                    {event.coins_amount > 0 ? "+" : ""}{event.coins_amount.toLocaleString(locale)} <Coin size={12} />
                  </span>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ol>
      {events.length === 0 && (
        <div className="card p-10 text-center text-sm text-muted">{t("empty")}</div>
      )}
    </div>
  );
}
