import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { getMostOwnedBadges, getRarestBadges, getSiteLeaderboard } = await import("@/lib/queries");
  const { fetchOwnedLeaderboard, fetchBadgesBlogRanking } = await import("@/lib/twitch/potat");

  const timed = async <T>(label: string, fn: () => Promise<T>) => {
    const start = Date.now();
    try {
      const r = await fn();
      console.log(`${label}: OK in ${Date.now() - start}ms (${JSON.stringify(r).length} bytes)`);
    } catch (e) {
      console.log(`${label}: THROW after ${Date.now() - start}ms: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  await timed("getSiteLeaderboard(25)", () => getSiteLeaderboard(25));
  await timed("getMostOwnedBadges(10)", () => getMostOwnedBadges(10));
  await timed("getRarestBadges(10)", () => getRarestBadges(10));
  await timed("fetchOwnedLeaderboard(2)", () => fetchOwnedLeaderboard(2));
  await timed("fetchBadgesBlogRanking", () => fetchBadgesBlogRanking());
}
main();