import type { BadgeRow } from "@/lib/queries";
import BadgeCard from "./BadgeCard";

export default async function BadgeGrid({
  badges,
  showCountdown = true,
  columns = "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6",
}: {
  badges: BadgeRow[];
  showCountdown?: boolean;
  columns?: string;
}) {
  return (
    <div className={`grid gap-3 ${columns}`}>
      {badges.map((badge) => (
        <BadgeCard key={badge.id} badge={badge} showCountdown={showCountdown} />
      ))}
    </div>
  );
}
