import { createAdminClient } from "@/lib/supabase/admin";
import { award, getProgress, logActivity, today } from "./xp";
import { createFeaturePost } from "@/lib/blog";

/**
 * Wheel of Fortune — one spin per day.
 * Weighted XP prizes + a Twitch Turbo subscription jackpot at
 * probability 0.00000001 (1 : 100,000,000).
 */

export interface WheelSlot {
  id: string;
  label: string;
  xp: number;
  coins: number;
  weight: number;
  turbo?: boolean;
}

export const WHEEL_SLOTS: WheelSlot[] = [
  { id: "xp25", label: "+25 XP", xp: 25, coins: 10, weight: 4000 },
  { id: "xp50", label: "+50 XP", xp: 50, coins: 20, weight: 2500 },
  { id: "xp100", label: "+100 XP", xp: 100, coins: 40, weight: 1500 },
  { id: "xp250", label: "+250 XP", xp: 250, coins: 100, weight: 700 },
  { id: "xp500", label: "+500 XP", xp: 500, coins: 200, weight: 220 },
  { id: "xp1000", label: "+1,000 XP", xp: 1000, coins: 400, weight: 70 },
  { id: "xp2500", label: "+2,500 XP", xp: 2500, coins: 1000, weight: 10 },
  { id: "turbo", label: "Twitch Turbo!", xp: 5000, coins: 50000, weight: 0.0000001, turbo: true },
];

const TURBO_PROBABILITY = 0.00000001;

export interface SpinResult {
  slot: WheelSlot;
  turboWon: boolean;
  alreadySpunToday: boolean;
}

export async function spinWheel(userId: string): Promise<
  { ok: false; reason: "already" } | { ok: true; result: SpinResult }
> {
  const supabase = createAdminClient();
  const progress = await getProgress(userId);
  if (progress.last_wheel_date === today()) {
    return { ok: false, reason: "already" };
  }

  // Turbo jackpot: drawn separately at exactly 1:100,000,000.
  const turboWon = Math.random() < TURBO_PROBABILITY;
  const slot = turboWon
    ? WHEEL_SLOTS[WHEEL_SLOTS.length - 1]
    : weightedPick(WHEEL_SLOTS.slice(0, -1));

  const { error: progressError } = await supabase
    .from("user_progress")
    .update({
      last_wheel_date: today(),
      wheel_spins: progress.wheel_spins + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  if (progressError) throw progressError;

  await award(userId, {
    xp: slot.xp,
    coins: slot.coins,
    source: "wheel",
    skipAchievements: false,
    feedKind: "wheel",
    feedTitle: `spun the Wheel of Fortune: ${slot.label}`,
    payload: { slot: slot.id },
  });

  if (turboWon) {
    await supabase.from("turbo_wins").insert({ user_id: userId });
    await logActivity({
      userId,
      kind: "turbo_win",
      title: "WON THE TWITCH TURBO JACKPOT (1 : 100,000,000)!",
      body: "The impossible happened — a free Twitch Turbo subscription.",
      payload: { probability: TURBO_PROBABILITY },
    });
    await createFeaturePost({
      slug: "turbo-jackpot-won",
      title: "Twitch Turbo jackpot won!",
      excerpt: "Someone beat the 1 : 100,000,000 odds on the Wheel of Fortune.",
      content:
        "The Wheel of Fortune on Twitch Badges Database carries one slot that " +
        "is never expected to be hit: a free Twitch Turbo subscription with a " +
        "win probability of 0.00000001 — one in a hundred million. Today that " +
        "impossible line was crossed. A lucky collector spun the daily wheel, " +
        "watched it slow down on the golden Turbo segment and instantly became " +
        "part of this site's history. Beyond the subscription itself (worth a " +
        "full year of ad-free, emerald-badge Twitch), the winner also received " +
        "5,000 XP, 50,000 coins and the ultra-rare 'One in a Hundred Million' " +
        "achievement that only jackpot winners can ever hold. If this post " +
        "proves anything, it is that every daily spin matters: the odds are " +
        "astronomical, but they are not zero. Claim your daily spin, keep your " +
        "login streak alive and who knows — the next headline could feature " +
        "your name. Congratulations from the whole badge-collecting community!",
      tags: ["wheel", "turbo", "jackpot"],
    }).catch(() => undefined);
  }

  return {
    ok: true,
    result: { slot, turboWon, alreadySpunToday: false },
  };
}

function weightedPick(slots: WheelSlot[]): WheelSlot {
  const total = slots.reduce((sum, slot) => sum + slot.weight, 0);
  let roll = Math.random() * total;
  for (const slot of slots) {
    roll -= slot.weight;
    if (roll <= 0) return slot;
  }
  return slots[slots.length - 1];
}
