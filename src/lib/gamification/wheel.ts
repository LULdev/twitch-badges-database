import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { award, ensureProgress, logActivity, today } from "./xp";
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

/**
 * The Turbo slot's win probability. The slot is drawn SEPARATELY from the weighted
 * pick (see spinWheel) so its `weight` is informational — but it must still be the
 * real probability, or any consumer deriving odds from WHEEL_SLOTS publishes
 * 1 : 10,000,000 while the UI says 1 : 100,000,000.
 */
const TURBO_PROBABILITY = 0.00000001;

export const WHEEL_SLOTS: WheelSlot[] = [
  { id: "xp25", label: "+25 XP", xp: 25, coins: 10, weight: 4000 },
  { id: "xp50", label: "+50 XP", xp: 50, coins: 20, weight: 2500 },
  { id: "xp100", label: "+100 XP", xp: 100, coins: 40, weight: 1500 },
  { id: "xp250", label: "+250 XP", xp: 250, coins: 100, weight: 700 },
  { id: "xp500", label: "+500 XP", xp: 500, coins: 200, weight: 220 },
  { id: "xp1000", label: "+1,000 XP", xp: 1000, coins: 400, weight: 70 },
  { id: "xp2500", label: "+2,500 XP", xp: 2500, coins: 1000, weight: 10 },
  { id: "turbo", label: "Twitch Turbo!", xp: 5000, coins: 50000, weight: TURBO_PROBABILITY, turbo: true },
];

export interface SpinResult {
  slot: WheelSlot;
  turboWon: boolean;
  alreadySpunToday: boolean;
}

export async function spinWheel(userId: string): Promise<
  { ok: false; reason: "already" } | { ok: true; result: SpinResult }
> {
  const supabase = createAdminClient();

  // Atomic compare-and-set gate: exactly one of two parallel spins wins the
  // row (and with it the spin counter increment), so the daily spin cannot be
  // claimed twice. Fired BEFORE any row materialisation: a `true` proves the
  // row already existed (the gate's UPDATE matched it), so the ensureProgress
  // upsert — a no-op on every established player — is skipped on the happy
  // path. A `false` is ambiguous (already spun today OR no row yet, because
  // claim_wheel_gate in 0007 is UPDATE-only and matches 0 rows on a missing
  // row), so the first-time case materialises the row and retries the gate
  // ONCE; the retry is a fresh compare-and-set, so a parallel spin that won
  // the day in between still correctly answers "already".
  const gate = await supabase.rpc("claim_wheel_gate", {
    p_user_id: userId,
    p_today: today(),
  });
  if (gate.error) throw gate.error;
  if (!gate.data) {
    // The gate only UPDATEs, so a first-time user with no `user_progress` row
    // would match 0 rows and be told the wheel was already spun today. ON
    // CONFLICT DO NOTHING is idempotent, so this is safe on every path; a
    // second `false` after the row exists is a genuine "already spun".
    await ensureProgress(userId);
    const retry = await supabase.rpc("claim_wheel_gate", {
      p_user_id: userId,
      p_today: today(),
    });
    if (retry.error) throw retry.error;
    if (!retry.data) {
      return { ok: false, reason: "already" };
    }
  }

  // Turbo jackpot: drawn separately at exactly 1:100,000,000. The turbo_wins
  // row is written BEFORE the payout: inserting it after the award left a
  // paid-but-unrecorded window with no compensation (gate burned, client shown
  // an error). If anything below fails, the row is deleted again and the gate
  // released, so no unpaid spin can leave a jackpot record — or burn the day.
  const turboWon = Math.random() < TURBO_PROBABILITY;
  const slot = turboWon
    ? WHEEL_SLOTS[WHEEL_SLOTS.length - 1]
    : weightedPick(WHEEL_SLOTS.slice(0, -1));

  let turboRowId: number | undefined;
  try {
    if (turboWon) {
      // `.single()` rather than `.maybeSingle()`: an insert that returns no row
      // must be an error — a silently missing id would disable the compensating
      // delete below and strand a jackpot record behind an unpaid spin.
      const { data: turboRow, error: turboError } = await supabase
        .from("turbo_wins")
        .insert({ user_id: userId })
        .select("id")
        .single();
      if (turboError) throw turboError;
      turboRowId = (turboRow as { id: number }).id;
    }
    await award(userId, {
      xp: slot.xp,
      coins: slot.coins,
      source: "wheel",
      skipAchievements: false,
      feedKind: "wheel",
      feedTitle: `spun the Wheel of Fortune: ${slot.label}`,
      payload: { slot: slot.id },
    });
  } catch (error) {
    // Same reasoning as the daily gate: the gate already advanced `last_wheel_date`
    // and `wheel_spins`, so a failed award — or a failed jackpot insert — would
    // burn the day's spin with nothing paid and no way to retry. Release it (date
    // AND the counter, atomically) and rethrow. A pre-inserted jackpot row goes
    // with it — the spin ends unpaid, so no jackpot record may survive it.
    if (turboRowId != null) {
      const { error: voidError } = await supabase
        .from("turbo_wins")
        .delete()
        .eq("id", turboRowId);
      if (voidError) {
        console.warn("[wheel] could not void the jackpot row after a failed award:", voidError.message);
      }
    }
    try {
      const release = await supabase.rpc("release_wheel_gate", {
        p_user_id: userId,
        p_today: today(),
      });
      if (release.error) throw release.error;
    } catch (releaseError) {
      console.warn("[wheel] could not release the gate after a failed award:", releaseError);
    }
    throw error;
  }

  if (turboWon) {
    // The row is already persisted; the activity log and the feature post are
    // best-effort garnish (logActivity swallows internally, the post catches).
    // Neither is awaited any more: `afterResponse` hands both to the platform's
    // post-response queue, so the jackpot response is not held hostage by a
    // feed insert or a blog write. The compensating delete and the
    // `release_wheel_gate` call in the catch above stay on the critical path in
    // their original order — they unwind COMMITTED state (the pre-inserted
    // jackpot row, the burned gate) and are compensation, not garnish.
    afterResponse(() =>
      logActivity({
        userId,
        kind: "turbo_win",
        title: "WON THE TWITCH TURBO JACKPOT (1 : 100,000,000)!",
        body: "The impossible happened — a free Twitch Turbo subscription.",
        payload: { probability: TURBO_PROBABILITY },
      }),
    );
    afterResponse(() =>
      createFeaturePost({
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
      }).catch(() => undefined),
    );
  }

  return {
    ok: true,
    result: { slot, turboWon, alreadySpunToday: false },
  };
}

/**
 * Hand a task to the platform's post-response queue.
 *
 * `after()` is the only mechanism that keeps work ALIVE once the response has
 * been flushed — on Vercel the invocation is not frozen until every registered
 * callback settles, whereas a bare `void promise` is killed mid-flight. Outside
 * a request scope (a script, a unit test) `after()` throws synchronously, so
 * the task degrades to fire-and-forget rather than taking the spin down with
 * it. The task itself is responsible for swallowing its own errors; this only
 * guarantees it does not block or throw.
 */
function afterResponse(task: () => Promise<unknown>): void {
  try {
    after(task);
  } catch {
    void task().catch(() => undefined);
  }
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
