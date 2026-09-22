import { config } from "dotenv";

config({ path: ".env.local" });

/**
 * Functional verification of the atomic economy fixes (B5/B6/B10).
 *
 * Isolates the arithmetic with `skipAchievements` (an award normally cascades
 * into achievement XP, which would mask the deltas) and leaves no trace: the
 * full progress row is snapshotted and restored, and every row the test
 * created is deleted again.
 */
async function main() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { award, adjustCoins, getProgress } = await import("@/lib/gamification/xp");
  const { evaluateAchievements, ACTIVE_ACHIEVEMENTS } = await import(
    "@/lib/gamification/achievements"
  );

  const supabase = createAdminClient();

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, username")
    .limit(1);
  if (!profiles?.length) {
    console.log("no profile in the database — skipping live award test");
    return;
  }
  const profile = profiles[0];
  console.log("test profile:", profile.username, profile.id);

  const snapshot = await getProgress(profile.id);
  const eventHigh = Number(
    (
      await supabase
        .from("activity_events")
        .select("id")
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle()
    ).data?.id ?? 0,
  );
  const achievementHigh = new Date().toISOString();

  let failures = 0;
  const check = (label: string, actual: number, expected: number) => {
    const ok = actual === expected;
    if (!ok) failures += 1;
    console.log(
      `  ${ok ? "PASS" : "FAIL"} ${label}: got ${actual}, expected ${expected}`,
    );
  };

  try {
    // 1) one award moves xp and coins by exactly the requested amounts
    await award(profile.id, {
      xp: 3,
      coins: 2,
      source: "verify/single",
      skipAchievements: true,
    });
    const afterSingle = await getProgress(profile.id);
    check("single award xp", Number(afterSingle.xp) - Number(snapshot.xp), 3);
    check(
      "single award coins",
      Number(afterSingle.coins) - Number(snapshot.coins),
      2,
    );

    // 2) THE regression test: two overlapping awards must both survive
    const concurrent = await Promise.all([
      award(profile.id, {
        xp: 11,
        coins: 5,
        source: "verify/parallel-a",
        skipAchievements: true,
      }),
      award(profile.id, {
        xp: 13,
        coins: 7,
        source: "verify/parallel-b",
        skipAchievements: true,
      }),
    ]);
    const afterParallel = await getProgress(profile.id);
    check(
      "concurrent xp survives (3+11+13)",
      Number(afterParallel.xp) - Number(snapshot.xp),
      27,
    );
    check(
      "concurrent coins survive (2+5+7)",
      Number(afterParallel.coins) - Number(snapshot.coins),
      14,
    );
    console.log(
      "  reported:",
      concurrent.map((r) => `${r.xpAwarded}xp/${r.coinsAwarded}c`).join(" "),
    );

    // 3) atomic helper round-trip nets back to the same balance
    const bumped = await adjustCoins(profile.id, 7);
    const back = await adjustCoins(profile.id, -7);
    check("bumpCoins +7", bumped - Number(afterParallel.coins), 7);
    check("bumpCoins round-trip returns to start", back, bumped - 7);

    // 4) the balance never drops below zero
    check("negative guard", await adjustCoins(profile.id, -1_000_000), 0);

    // ---------------------------------------------------------------
    // Migration 0007: counters and daily gates
    // ---------------------------------------------------------------

    // 5) five concurrent counter bumps must all land
    const countersBefore = await getProgress(profile.id);
    await Promise.all(
      Array.from({ length: 5 }, () =>
        supabase.rpc("bump_counters", {
          p_user_id: profile.id,
          p_deltas: { games_played: 1, times_robbed: 1 },
        }),
      ),
    );
    const countersAfter = await getProgress(profile.id);
    check(
      "5 concurrent games_played bumps",
      Number(countersAfter.games_played) - Number(countersBefore.games_played),
      5,
    );
    check(
      "5 concurrent times_robbed bumps",
      Number(countersAfter.times_robbed) - Number(countersBefore.times_robbed),
      5,
    );

    // 6) the daily login gate must be won by exactly one of two callers.
    //    The gate columns are cleared first, otherwise the account's real
    //    claim for today makes both callers legitimately lose.
    await supabase
      .from("user_progress")
      .update({ last_login_date: null, login_streak: 0, last_wheel_date: null })
      .eq("user_id", profile.id);
    const dailyToday = new Date().toISOString().slice(0, 10);
    const [gateA, gateB] = await Promise.all([
      supabase.rpc("claim_daily_gate", { p_user_id: profile.id, p_today: dailyToday }),
      supabase.rpc("claim_daily_gate", { p_user_id: profile.id, p_today: dailyToday }),
    ]);
    const gateResults = [Number(gateA.data ?? -1), Number(gateB.data ?? -1)];
    const winners = gateResults.filter((value) => value >= 0).length;
    check("daily gate: exactly one winner", winners, 1);
    console.log("  gate results:", gateResults.join(" / "));
    const dailyAfter = await getProgress(profile.id);
    check("daily gate: winner got streak 1", Number(dailyAfter.login_streak), 1);
    check(
      "daily gate: last_login_date stamped",
      dailyAfter.last_login_date === dailyToday ? 1 : 0,
      1,
    );
    // a second round of two callers must now both lose
    const [againA, againB] = await Promise.all([
      supabase.rpc("claim_daily_gate", { p_user_id: profile.id, p_today: dailyToday }),
      supabase.rpc("claim_daily_gate", { p_user_id: profile.id, p_today: dailyToday }),
    ]);
    check(
      "daily gate: nobody wins twice",
      [Number(againA.data ?? -1), Number(againB.data ?? -1)].filter((v) => v >= 0).length,
      0,
    );

    // 7) the wheel gate must also be won exactly once
    const [wheelA, wheelB] = await Promise.all([
      supabase.rpc("claim_wheel_gate", { p_user_id: profile.id, p_today: dailyToday }),
      supabase.rpc("claim_wheel_gate", { p_user_id: profile.id, p_today: dailyToday }),
    ]);
    const wheelWins = [wheelA.data, wheelB.data].filter(Boolean).length;
    check("wheel gate: exactly one winner", wheelWins, 1);

    // 8) the 100 XP/day game budget cannot be overshot
    await supabase
      .from("user_progress")
      .update({ game_xp_day: null, game_xp_today: 0 })
      .eq("user_id", profile.id);
    const [first, second] = await Promise.all([
      supabase.rpc("consume_game_xp", {
        p_user_id: profile.id,
        p_today: dailyToday,
        p_requested: 80,
      }),
      supabase.rpc("consume_game_xp", {
        p_user_id: profile.id,
        p_today: dailyToday,
        p_requested: 80,
      }),
    ]);
    const granted = Number(first.data ?? 0) + Number(second.data ?? 0);
    check("game XP budget capped at 100", granted, 100);
    console.log("  granted:", first.data, "+", second.data);

    // The award calls above pass skipAchievements, so the evaluation itself had
    // no coverage — and that is where the two newest signals live
    // (accountAgeDays from profiles.created_at, isTopCoinHolder from a ranked
    // user_progress query). Running it here also proves the whole path still
    // evaluates without throwing; the restore below deletes whatever it unlocks.
    const unlocked = await evaluateAchievements(profile.id);
    check("achievement evaluation returns a list", Array.isArray(unlocked) ? 1 : 0, 1);
    console.log(
      "  achievements evaluated:",
      ACTIVE_ACHIEVEMENTS.length,
      "| unlocked for this profile:",
      unlocked.length,
    );
  } finally {
    // restore every column of the progress row
    const {
      user_id,
      created_at,
      ...restorable
    } = snapshot as unknown as Record<string, unknown>;
    void user_id;
    void created_at;
    await supabase
      .from("user_progress")
      .update({ ...restorable, updated_at: new Date().toISOString() })
      .eq("user_id", profile.id);

    const { data: feedRows } = await supabase
      .from("activity_events")
      .delete()
      .gt("id", eventHigh)
      .select("id");
    const { data: achievementRows } = await supabase
      .from("user_achievements")
      .delete()
      .eq("user_id", profile.id)
      .gt("unlocked_at", achievementHigh)
      .select("achievement_id");

    const restored = await getProgress(profile.id);
    const exact =
      Number(restored.xp) === Number(snapshot.xp) &&
      Number(restored.coins) === Number(snapshot.coins) &&
      Number(restored.level) === Number(snapshot.level);
    console.log(
      `restore: ${exact ? "EXACT" : "MISMATCH"} (xp ${restored.xp}/${snapshot.xp}, ` +
        `coins ${restored.coins}/${snapshot.coins}, level ${restored.level}/${snapshot.level}) ` +
        `feedRowsRemoved=${feedRows?.length ?? 0} achievementRowsRemoved=${achievementRows?.length ?? 0}`,
    );
    if (!exact) failures += 1;
  }

  console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
}

main().catch((error) => {
  console.error("verification failed:", error);
  process.exit(1);
});