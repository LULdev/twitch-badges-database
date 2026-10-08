import { createAdminClient } from "@/lib/supabase/admin";
import { createFeaturePost } from "@/lib/blog";

/**
 * Shared garnish for the progressive jackpots (0069) — the pieces both the
 * arcade engine (games.ts) and the wheel need, kept here so neither imports
 * the other.
 */

export interface MegaWinContext {
  /** The game being played when the Mega pot hit; null = the daily wheel. */
  game: { id: string; title: string } | null;
  /** The live 1-in-N Mega odds (economy setting — quoted in the post copy). */
  odds: number;
}

/**
 * Publish the auto blog post for a Mega Jackpot hit.
 *
 * Date-stamped slug (`mega-jackpot-YYYY-MM-DD`, the recap convention) so a
 * second hit on another day gets its own post instead of silently colliding
 * like the fixed-slug turbo precedent. Idempotent per UTC day through
 * createFeaturePost's ignoreDuplicates (returns false on a same-day re-run).
 *
 * The push broadcast is deliberately NOT here: both call sites already fire
 * the jackpot alert (tag "jackpot") when the win settles, and a second
 * notification for the same moment would land twice in every tray.
 */
export async function createMegaJackpotPost(
  userId: string,
  amount: number,
  context: MegaWinContext,
): Promise<boolean> {
  const supabase = createAdminClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", userId)
    .maybeSingle();
  const who = (profile as { username: string | null } | null)?.username ?? "Someone";
  const coins = amount.toLocaleString("en-US");
  const day = new Date().toISOString().slice(0, 10);
  const where = context.game
    ? `while playing ${context.game.title}`
    : "on the daily Wheel of Fortune";

  const title = "Mega Jackpot won!";
  const excerpt =
    `${who} beat the 1 : ${context.odds.toLocaleString("en-US")} odds and took ` +
    `the ${coins} BadgesCoins Mega Jackpot ${where}.`;

  const content =
    `The moment the whole arcade plays for happened today: the Mega Jackpot was struck. ` +
    `Every arcade game and every daily Wheel of Fortune spin feeds this single pot — ` +
    `a fixed share of every lost coin lands in it — so it grows a little with every ` +
    `round anyone plays, until one lucky round takes it all. ${who} hit it ${where} and ` +
    `walked away with ${coins} BadgesCoins, and the pot immediately reseeded itself and ` +
    `started climbing again with the very next round.\n\n` +
    `The odds are 1 : ${context.odds.toLocaleString("en-US")} per settled round — rare ` +
    `enough to feel special, reachable enough that somebody will get there. The per-game ` +
    `jackpots tick in parallel: every game in the arcade carries its own pot, fed only by ` +
    `the coins lost inside that game, and each of those can hit on any round too. Every ` +
    `pot, big or small, always pays at least its seed value.\n\n` +
    `Want your name on this page? Every round with a real stake rolls the dice, and the ` +
    `live pots are on the games hub — watch one tick up while you play.`;

  return createFeaturePost({
    slug: `mega-jackpot-${day}`,
    title,
    excerpt,
    content,
    cover: context.game ? `/games/art/${context.game.id}.svg` : null,
    tags: ["jackpot", "mega", context.game ? "arcade" : "wheel"],
  });
}
