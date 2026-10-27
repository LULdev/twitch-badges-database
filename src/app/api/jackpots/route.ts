import { getJackpots, getJackpotPotsYesterday } from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * Public live-pot feed (0069): every jackpot pot's current value, the exact
 * same anon read the hub strip / game heroes / wheel page use — as JSON so
 * the client-side pot ticker can refresh between page loads.
 *
 * Each pot also carries `delta_day` (0078 round): live pot minus yesterday's
 * 06:00 UTC snapshot from jackpot_pot_history (0072), null when the pot has
 * no baseline row yet. The delta rides the PAYLOAD, not a prop — the client
 * replaces its whole state on every poll, so a server-computed prop would go
 * stale 15 seconds in.
 *
 * Deliberately unpaged and uncached (no-store): the whole table is 15 rows,
 * and the point is freshness between polls.
 */
export async function GET() {
  const [jackpots, yesterday] = await Promise.all([
    getJackpots(),
    getJackpotPotsYesterday(),
  ]);
  const feed = jackpots.map((pot) => ({
    ...pot,
    delta_day: Object.prototype.hasOwnProperty.call(yesterday, pot.scope)
      ? pot.pot - yesterday[pot.scope]
      : null,
  }));
  return Response.json(
    { jackpots: feed, at: new Date().toISOString() },
    { headers: { "cache-control": "no-store" } },
  );
}
