import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { RecordBreakLeader, RecordBreakPeriod } from "@/lib/stats";
import Coin from "@/components/Coin";

const PERIODS: Array<{ value: RecordBreakPeriod; days?: number }> = [
  { value: "7", days: 7 },
  { value: "30", days: 30 },
  { value: "all" },
];

/**
 * Public leaderboard on /stats (RPC 0058): whose all-time personal best rose
 * most often in the selected period. The metric is progress, not luck — a
 * player's own record falling counts no matter how small the amounts are.
 * The period toggle is plain links (?period=7|30|all) — the page is
 * request-dynamic, so no client state is needed. Every name links to the
 * player's profile.
 */
export default async function RecordLeaders({
  leaders,
  activePeriod = "7",
  id = "record-leaders",
}: {
  leaders: RecordBreakLeader[];
  activePeriod?: RecordBreakPeriod;
  id?: string;
}) {
  const t = await getTranslations("stats");
  const locale = await getLocale();

  const rankColors = ["var(--rank-gold)", "var(--rank-silver)", "var(--rank-bronze)"];

  return (
    <section className="card p-5" aria-labelledby={id}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="text-lg font-extrabold tracking-tight">
          {t("recordLeadersTitle")}
        </h2>
        <div className="flex gap-1.5">
          {PERIODS.map((period) => (
            <Link
              key={period.value}
              href={`/stats?period=${period.value}`}
              className={`chip ${activePeriod === period.value ? "chip-active" : ""}`}
              aria-current={activePeriod === period.value ? "true" : undefined}
            >
              {period.days !== undefined ? t("periodDays", { n: period.days }) : t("periodAll")}
            </Link>
          ))}
        </div>
      </div>
      <ol className="mt-3 space-y-2">
        {leaders.map((leader, index) => (
          <li key={leader.username} className="flex items-center gap-2.5 text-sm">
            <span
              className="w-4 text-center font-extrabold"
              style={{ color: rankColors[index] ?? "var(--muted)" }}
            >
              {index + 1}
            </span>
            {leader.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={leader.avatar_url} alt="" width={24} height={24} className="rounded-full" />
            ) : (
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-[0.5rem] font-bold text-accent">
                {leader.username.slice(0, 2).toUpperCase()}
              </span>
            )}
            <Link href={`/profile/${leader.username}`} className="min-w-0 truncate font-bold hover:text-accent">
              {leader.username}
            </Link>
            <span className="ms-auto shrink-0 font-black text-warning tabular-nums" dir="ltr">
              {leader.breaks}×
            </span>
            <span
              dir="ltr"
              className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-success tabular-nums"
            >
              +{leader.bestNet.toLocaleString(locale)} <Coin size={11} />
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-muted">{t("recordLeadersNote")}</p>
    </section>
  );
}
