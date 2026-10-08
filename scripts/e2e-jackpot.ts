/**
 * Progressive-jackpot E2E — manual, DB-writing, self-cleaning. Run with
 * `npm run e2e:jackpot` (NOT part of `verify`: it creates a real auth user
 * and needs the service role, which CI must not hold).
 *
 * The jackpot_round RPC (0069) owns real money movement — contributions,
 * the row-locked pot claim, the payout, the activity_events ledger row and
 * the jackpot_wins history row all commit in ONE transaction. This script
 * exercises the whole contract against the production function with ONE
 * throwaway user, forcing the hit booleans directly (no economy settings are
 * touched on the live site — the odds never need to align):
 *
 *  1. The owner's worked example: a round that loses 10 coins at 30%/30%
 *     feeds +3 to the game pot AND +3 to the Mega pot, moves no player
 *     coins, and counts exactly one contributing round.
 *  2. A forced game-pot hit pays the current pot (never below the seed),
 *     resets the pot to the seed, credits the balance, and writes the
 *     history row plus the jackpot_win ledger row with coins_amount = win.
 *  3. A forced MEGA hit through the wheel's call shape (p_game null)
 *     pays, resets and records the same way.
 *  4. Full baseline restore: both jackpot rows verbatim, test history and
 *     feed rows deleted, throwaway user deleted (cascade).
 */
import { randomUUID } from "node:crypto";
import { config } from "dotenv";

async function main() {
  config({ path: ".env.local" });
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const checks: Array<{ name: string; ok: boolean }> = [];
  const check = (name: string, ok: boolean, detail = "") => {
    checks.push({ name, ok });
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " — " + detail}`);
  };

  const stamp = Date.now().toString(36);
  const username = `tmpjp${stamp}`;
  const START_BALANCE = 10_000;

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: `${username}@example.com`,
    password: randomUUID(),
    email_confirm: true,
    user_metadata: { full_name: username },
  });
  if (createErr) throw new Error(`createUser: ${createErr.message}`);
  const userId = created.user.id;

  try {
    const { data: profile } = await admin
      .from("profiles")
      .select("username")
      .eq("id", userId)
      .maybeSingle();
    check("profile trigger created username", profile?.username === username);
    const { error: progErr } = await admin
      .from("user_progress")
      .insert({ user_id: userId, coins: START_BALANCE });
    if (progErr) throw new Error(`progress seed: ${progErr.message}`);

    // ── baseline capture (full rows, restored verbatim at the end) ──────────
    const JP_COLS = "scope,kind,pot,contributions,contributions_rounds,hits,total_paid,last_won_at,last_winner,last_win_amount";
    const { data: baseRows } = await admin.from("jackpots").select(JP_COLS).in("scope", ["rps", "mega"]);
    const base = Object.fromEntries((baseRows ?? []).map((r: Record<string, unknown>) => [r.scope as string, r]));
    const gameBefore = Number(base.rps.pot);
    const megaBefore = Number(base.mega.pot);

    const coins = async () => {
      const { data } = await admin.from("user_progress").select("coins").eq("user_id", userId).single();
      return Number((data as { coins: string | number }).coins);
    };
    const jpRow = async (scope: string) => {
      const { data } = await admin.from("jackpots").select(JP_COLS).eq("scope", scope).single();
      return data as Record<string, unknown>;
    };

    // ── 1. contribution path: the owner's worked example (lose 10 → 3 + 3) ──
    const c0 = await coins();
    const { data: r1raw, error: r1err } = await admin.rpc("jackpot_round", {
      p_user_id: userId,
      p_game: "rps",
      p_loss: 10,
      p_game_rate: 0.3,
      p_mega_rate: 0.3,
      p_game_seed: 250,
      p_mega_seed: 2500,
      p_game_hit: false,
      p_mega_hit: false,
    });
    if (r1err) throw new Error(`contribution call: ${r1err.message}`);
    const r1 = (Array.isArray(r1raw) ? r1raw[0] : r1raw) as Record<string, string | number>;
    check("example: game pot +3", Number(r1.out_game_pot) === gameBefore + 3, `${r1.out_game_pot}`);
    check("example: mega pot +3", Number(r1.out_mega_pot) === megaBefore + 3, `${r1.out_mega_pot}`);
    check("no wins", Number(r1.out_game_win) === 0 && Number(r1.out_mega_win) === 0);
    const rpsAfter = await jpRow("rps");
    check("rps contributions +3", Number(rpsAfter.contributions) === Number(base.rps.contributions) + 3);
    check("rps contributions_rounds +1", Number(rpsAfter.contributions_rounds) === Number(base.rps.contributions_rounds) + 1);
    check("contribution moves no player coins", (await coins()) === c0);

    // loss 0 → no contribution, no round count
    await admin.rpc("jackpot_round", {
      p_user_id: userId, p_game: "rps", p_loss: 0,
      p_game_rate: 0.3, p_mega_rate: 0.3, p_game_seed: 250, p_mega_seed: 2500,
      p_game_hit: false, p_mega_hit: false,
    });
    const rpsZero = await jpRow("rps");
    check("zero loss adds nothing",
      Number(rpsZero.contributions) === Number(rpsAfter.contributions) &&
      Number(rpsZero.contributions_rounds) === Number(rpsAfter.contributions_rounds));

    // ── 2. forced GAME hit ───────────────────────────────────────────────────
    const c1 = await coins();
    const potNow = Number(rpsZero.pot);
    const expectedWin = Math.max(potNow, 250);
    const { data: r2raw, error: r2err } = await admin.rpc("jackpot_round", {
      p_user_id: userId, p_game: "rps", p_loss: 0,
      p_game_rate: 0, p_mega_rate: 0, p_game_seed: 250, p_mega_seed: 2500,
      p_game_hit: true, p_mega_hit: false,
    });
    if (r2err) throw new Error(`game hit: ${r2err.message}`);
    const r2 = (Array.isArray(r2raw) ? r2raw[0] : r2raw) as Record<string, string | number>;
    check("game hit pays the pot", Number(r2.out_game_win) === expectedWin, `${r2.out_game_win} vs ${expectedWin}`);
    check("game pot resets to seed", Number(r2.out_game_pot) === 250, `${r2.out_game_pot}`);
    const rpsHit = await jpRow("rps");
    check("hits +1 / total_paid +win",
      Number(rpsHit.hits) === Number(base.rps.hits) + 1 &&
      Number(rpsHit.total_paid) === Number(base.rps.total_paid) + expectedWin);
    check("last_winner recorded", rpsHit.last_winner === username);
    check("player credited", (await coins()) === c1 + expectedWin);
    const { data: jw1 } = await admin.from("jackpot_wins").select("scope,kind,amount,game").eq("user_id", userId).eq("scope", "rps");
    check("history row", jw1?.length === 1 && Number(jw1[0].amount) === expectedWin, JSON.stringify(jw1));
    const { data: fe1 } = await admin.from("activity_events").select("kind,coins_amount,payload").eq("user_id", userId).eq("kind", "jackpot_win");
    check("ledger feed row (coins_amount = win)",
      fe1?.length === 1 && Number(fe1[0].coins_amount) === expectedWin, JSON.stringify(fe1));

    // ── 3. forced MEGA hit via the wheel shape (p_game null) ─────────────────
    const c2 = await coins();
    const megaPotNow = Number((await jpRow("mega")).pot);
    const expectedMega = Math.max(megaPotNow, 2500);
    const { data: r3raw, error: r3err } = await admin.rpc("jackpot_round", {
      p_user_id: userId, p_game: null, p_loss: 0,
      p_game_rate: 0, p_mega_rate: 0, p_game_seed: 250, p_mega_seed: 2500,
      p_game_hit: false, p_mega_hit: true,
    });
    if (r3err) throw new Error(`mega hit: ${r3err.message}`);
    const r3 = (Array.isArray(r3raw) ? r3raw[0] : r3raw) as Record<string, string | number>;
    check("mega hit pays the pot", Number(r3.out_mega_win) === expectedMega, `${r3.out_mega_win} vs ${expectedMega}`);
    check("mega pot resets to seed", Number(r3.out_mega_pot) === 2500, `${r3.out_mega_pot}`);
    check("mega player credited", (await coins()) === c2 + expectedMega);
    const { data: fe2 } = await admin.from("activity_events").select("kind,coins_amount").eq("user_id", userId).eq("kind", "jackpot_win");
    check("two ledger rows now", fe2?.length === 2, `${fe2?.length}`);
    const { count: jwCount } = await admin.from("jackpot_wins").select("id", { count: "exact", head: true }).eq("user_id", userId);
    check("two history rows", jwCount === 2, `${jwCount}`);

    // ── restore ──────────────────────────────────────────────────────────────
    for (const scope of ["rps", "mega"]) {
      const b = base[scope] as Record<string, unknown>;
      const { error } = await admin.from("jackpots").update({
        pot: b.pot, contributions: b.contributions, contributions_rounds: b.contributions_rounds,
        hits: b.hits, total_paid: b.total_paid, last_won_at: b.last_won_at,
        last_winner: b.last_winner, last_win_amount: b.last_win_amount,
      }).eq("scope", scope);
      if (error) throw new Error(`restore ${scope}: ${error.message}`);
    }
    await admin.from("jackpot_wins").delete().eq("user_id", userId);
    await admin.from("activity_events").delete().eq("user_id", userId);
    const { data: afterFeed } = await admin.from("activity_events").select("id", { count: "exact", head: true }).eq("user_id", userId);
    check("no residue", (afterFeed as unknown as number | null) == null || Number(afterFeed) === 0);
    const rpsRestored = await jpRow("rps");
    check("jackpots baseline restored", Number(rpsRestored.pot) === gameBefore && Number(rpsRestored.hits) === Number(base.rps.hits));
  } finally {
    const del = await admin.auth.admin.deleteUser(userId);
    if (del.error) console.error("deleteUser failed:", del.error.message);
    else console.log("throwaway user deleted (cascade)");
  }

  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
