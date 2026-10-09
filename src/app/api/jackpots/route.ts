import { getJackpots } from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * Public live-pot feed (0069): every jackpot pot's current value, the exact
 * same anon read the hub strip / game heroes / wheel page use — as JSON so
 * the client-side pot ticker can refresh between page loads.
 *
 * Deliberately unpaged and uncached (no-store): the whole table is 15 rows,
 * and the point is freshness between polls.
 */
export async function GET() {
  const jackpots = await getJackpots();
  return Response.json(
    { jackpots, at: new Date().toISOString() },
    { headers: { "cache-control": "no-store" } },
  );
}
