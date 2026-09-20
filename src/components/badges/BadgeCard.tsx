import { getTranslations } from "next-intl/server";
import type { BadgeRow } from "@/lib/queries";
import { BadgeImage } from "./BadgeImage";
import RarityChip from "./RarityChip";
import Countdown from "./Countdown";
import { Link } from "@/i18n/navigation";

export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "—";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export async function StatusChip({ status }: { status: BadgeRow["status"] }) {
  const t = await getTranslations("common");
  if (status === "active") {
    return (
      <span className="chip chip-live pointer-events-none">
        <span className="live-dot" aria-hidden />
        {t(status)}
      </span>
    );
  }
  const styles: Record<string, string> = {
    upcoming: "border-[color-mix(in_srgb,var(--info)_40%,transparent)] text-info",
    expired: "border-[color-mix(in_srgb,var(--muted)_35%,transparent)] text-muted",
    removed: "border-[color-mix(in_srgb,var(--danger)_35%,transparent)] text-danger",
  };
  return (
    <span className={`chip pointer-events-none ${styles[status] ?? ""}`}>
      {t(status)}
    </span>
  );
}

export default async function BadgeCard({
  badge,
  showCountdown = true,
}: {
  badge: BadgeRow;
  showCountdown?: boolean;
}) {
  const t = await getTranslations("badges");
  // "NEW" marker is computed against request time; catalog pages revalidate
  // on a short ISR window so this stays acceptably fresh.
  // eslint-disable-next-line react-hooks/purity -- async server component
  const now = Date.now();

  return (
    <Link
      href={`/badges/${badge.slug}`}
      className="card card-interactive badge-tile group"
    >
      <div className="relative">
        <BadgeImage badge={badge} size={56} className="transition-transform duration-200 group-hover:scale-110" />
        {badge.first_seen_at &&
          now - new Date(badge.first_seen_at).getTime() < 14 * 86_400_000 && (
            <span className="absolute -end-1 -top-1 rounded-full bg-accent px-1.5 py-px text-[0.5625rem] font-bold uppercase tracking-wider text-accent-ink">
              NEW
            </span>
          )}
      </div>

      <div className="w-full">
        <p className="line-clamp-2 min-h-8 text-[0.8125rem] font-semibold leading-tight">
          {badge.title}
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
          <RarityChip tier={badge.rarity_tier} compact />
          <StatusChip status={badge.status} />
        </div>
        {showCountdown && badge.end_date && badge.status === "active" && (
          <div className="mt-2 flex justify-center">
            <Countdown target={badge.end_date} mode="expires" />
          </div>
        )}
        {badge.owner_count !== null && (
          <p className="mt-2 text-[0.6875rem] text-muted">
            {formatCompact(badge.owner_count)} {t("owners")}
          </p>
        )}
      </div>
    </Link>
  );
}
