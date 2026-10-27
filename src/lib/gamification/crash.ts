import { createHmac, randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { award, bumpCoins, getProgress, logActivity } from "./xp";
import { evaluateAchievements } from "./achievements";
import { createMegaJackpotPost } from "./jackpot";
import { getEconomy, getFeatures, getGames } from "@/lib/settings";
import { GAMES, afterResponse, sendJackpotAlert, type PlayResult } from "./games";
import {
  CRASH_TTL_MS,
  crashMultiplierAt,
  multToX100,
  rollCrashX100,
  x100ToMult,
} from "@/lib/games/crash-sim";

/**
 * Badge Rocket — the arcade's first interactive game (0080).
 *
 * A flight has THREE touchpoints, none of which trust the client:
 *
 *   bet      → gates + debit, crash point ROLLED SERVER-SIDE and stored in
 *              crash_rounds. It is never part of any response — the client
 *              animates the climb from `startedAt` and the shared growth
 *              formula alone.
 *   cashout  → the server grades the claim from its own clock: the
 *              multiplier at (now − started_at), capped by the round's
 *              server-stored auto target. A click that arrives after the
 *              curve crossed the crash point is a loss, latency included —
 *              the standard crash-game clock doctrine.
 *   active   → the client's flight poll. The moment the curve crosses the
 *              crash point (or the auto target), THIS call settles the
 *              round — so a watched flight resolves itself the instant it
 *              ends, and an abandoned one is caught by the next bet, the
 *              re-attach poll or the nightly sweep.
 *
 * Settlement graduates the flight into a normal `game_rounds` row and then
 * runs the same tail as `playGame`: counters, balance, the jackpot_round
 * RPC (a lost flight feeds this game's pot AND the Mega pot), XP + feed
 * row, the big-win garnish, the daily game-streak gate and the achievement
 * pass. The bet was debited at launch, so the tail credits `payout` (not
 * net) and never voids — a failed attempt is retried from the frozen
 * `cashed_x100` until `recorded_at` closes the critical section.
 */

const RATE_LIMIT_MS = 1000;

interface CrashRow {
  id: string;
  user_id: string;
  bet: number | string;
  crash_x100: number;
  auto_x100: number | null;
  cashed_x100: number | null;
  payout: number | string | null;
  won: boolean | null;
  client_nonce: string | null;
  server_seed: string | null;
  started_at: string;
  cashed_at: string | null;
  settled_at: string | null;
  recorded_at: string | null;
}

export interface CrashFlightInfo {
  id: string;
  startedAt: string;
  serverNow: string;
  /** Server-enforced auto cash-out target (display multiplier), null = off. */
  auto: number | null;
}

export interface CrashStartResult {
  ok: boolean;
  error?: string;
  flight?: CrashFlightInfo;
  /** A nonce replay whose flight already ended carries its committed
   * verdict, so the client can render the outcome and stop retrying. */
  settled?: PlayResult;
  balance?: number;
}

export type CrashPollResult =
  | { state: "none" }
  | {
      state: "flying";
      flight: CrashFlightInfo;
    }
  | { state: "crashed" | "cashed"; at: number; result: PlayResult };

function failStart(message: string): CrashStartResult {
  return { ok: false, error: message };
}

function num(value: number | string | null | undefined): number {
  return Number(value ?? 0);
}

/** The result jsonb written to game_rounds — the achievement flags ride it. */
function crashResult(row: CrashRow): Record<string, unknown> {
  const crash = x100ToMult(row.crash_x100);
  const cashed = row.cashed_x100 != null ? x100ToMult(row.cashed_x100) : null;
  const won = row.won === true;
  return {
    crash,
    ...(cashed != null && { cashed }),
    ...(row.auto_x100 != null && { auto: x100ToMult(row.auto_x100) }),
    won,
    // The provably-fair disclosure (0081): flight id + seed publish with
    // the settled row. crash x100 = clamp(round(0.96 / (1 − u))) where u =
    // int(HMAC-SHA256(seed, flight)[0..13]) / 2^52 — see the game page.
    ...(row.server_seed && { flight: row.id, seed: row.server_seed }),
    // Achievement flags (hasFlag reads recentResults.flags):
    moon: won && (row.cashed_x100 ?? 0) >= 1000,
    near: won && row.crash_x100 - (row.cashed_x100 ?? 0) <= 10,
    escape: won && (row.cashed_x100 ?? 0) >= 5000,
  };
}

/**
 * The provably-fair uniform: the first 13 hex digits of
 * HMAC-SHA256(serverSeed, flightId) as an integer over 2^52 — a uniform
 * draw in [0, 1) that anyone can recompute from the published seed.
 */
function hmacUniform(serverSeed: string, flightId: string): number {
  const digest = createHmac("sha256", serverSeed).update(flightId).digest("hex");
  return parseInt(digest.slice(0, 13), 16) / 2 ** 52;
}

// ── Launch ──────────────────────────────────────────────────────────────────

export async function startCrashRound(
  userId: string,
  bet: number,
  auto: number | null,
  nonce?: string,
): Promise<CrashStartResult> {
  const meta = GAMES.find((g) => g.id === "crash");
  if (!meta) return failStart("Unknown game.");
  const supabase = createAdminClient();

  // Nonce replay (the 0063 doctrine, deliberately before every gate): a
  // retried launch resumes the flight it already bought instead of charging
  // a second bet — whether that flight is still up or long settled.
  if (nonce) {
    const { data: replay } = await supabase
      .from("crash_rounds")
      .select("*")
      .eq("user_id", userId)
      .eq("client_nonce", nonce)
      .maybeSingle();
    if (replay) {
      const row = replay as unknown as CrashRow;
      if (row.settled_at) {
        // The whole flight already graduated into game_rounds — surface the
        // committed verdict so the client can render it and stop retrying.
        const result = await finalizeCrashRow(supabase, row);
        return { ok: true, settled: result, balance: result.balance };
      }
      return { ok: true, flight: flightInfo(row), balance: await currentBalance(userId) };
    }
  }

  const wager = Number.isFinite(bet) ? Math.floor(bet) : 0;
  const autoX100 =
    auto != null && Number.isFinite(auto) && auto >= 1.01 && auto <= 250
      ? multToX100(auto)
      : null;

  const [settings, features, progress, pendingRes, lastRoundRes] = await Promise.all([
    getGames(GAMES),
    getFeatures(),
    getProgress(userId),
    supabase
      .from("crash_rounds")
      .select("*")
      .eq("user_id", userId)
      .is("settled_at", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("game_rounds")
      .select("created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!settings.enabled || !features.games) {
    return failStart("The arcade is currently switched off.");
  }
  const rules = settings.games.crash ?? { enabled: true, minBet: meta.minBet, maxBet: meta.maxBet };
  if (!rules.enabled) return failStart("This game is currently switched off.");
  if (!Number.isFinite(wager) || wager < rules.minBet || wager > rules.maxBet) {
    return failStart(`Bet must be between ${rules.minBet} and ${rules.maxBet} coins.`);
  }
  if (progress.coins < wager) return failStart("Not enough coins.");
  if (
    lastRoundRes.data &&
    Date.now() - new Date(String(lastRoundRes.data.created_at)).getTime() < RATE_LIMIT_MS
  ) {
    return failStart("Slow down — one round per second.");
  }

  // One flight at a time. A pending row that is mathematically over (the
  // player closed the tab mid-flight) is settled right here — lazily, from
  // the frozen row — so the next launch can proceed; a live one refuses.
  const pending = (pendingRes.data as unknown as CrashRow | null) ?? null;
  if (pending) {
    const settled = await settleIfOver(supabase, pending);
    if (!settled) return failStart("A flight is already in progress.");
  }

  // Provably fair (0081): the crash point is DERIVED, not just rolled — the
  // flight id and a fresh server seed fix it BEFORE launch, and the seed
  // publishes with the settled round so anyone can replay the math. The
  // seed stays inside this service-only row while the flight is live.
  const flightId = crypto.randomUUID();
  const serverSeed = randomBytes(16).toString("hex");
  const crashX100 = rollCrashX100(() => hmacUniform(serverSeed, flightId));
  const { data: inserted, error: insertError } = await supabase
    .from("crash_rounds")
    .insert({
      id: flightId,
      user_id: userId,
      bet: wager,
      crash_x100: crashX100,
      auto_x100: autoX100,
      server_seed: serverSeed,
      client_nonce: nonce ?? null,
    })
    .select("*")
    .maybeSingle();
  if (insertError) {
    // 23505 on (user_id, client_nonce): a parallel launch raced us to the
    // same nonce — its flight is the committed one, resume it.
    if (nonce && String(insertError.code) === "23505") {
      const { data: raced } = await supabase
        .from("crash_rounds")
        .select("*")
        .eq("user_id", userId)
        .eq("client_nonce", nonce)
        .maybeSingle();
      if (raced) {
        const row = raced as unknown as CrashRow;
        return { ok: true, flight: flightInfo(row), balance: await currentBalance(userId) };
      }
    }
    throw insertError;
  }

  // The debit is the launch: insert first (the intent row), then move the
  // coins — a failed debit deletes the row again, so no state and no coins
  // can ever diverge.
  try {
    await bumpCoins(userId, -wager);
  } catch {
    await supabase.from("crash_rounds").delete().eq("id", (inserted as CrashRow).id);
    return failStart("The launch failed — no coins were charged. Try again.");
  }

  return {
    ok: true,
    flight: flightInfo(inserted as unknown as CrashRow),
    balance: await currentBalance(userId),
  };
}

function flightInfo(row: CrashRow): CrashFlightInfo {
  return {
    id: row.id,
    startedAt: row.started_at,
    serverNow: new Date().toISOString(),
    auto: row.auto_x100 != null ? x100ToMult(row.auto_x100) : null,
  };
}

async function currentBalance(userId: string): Promise<number> {
  const progress = await getProgress(userId).catch(() => null);
  return Number(progress?.coins ?? 0);
}

// ── In-flight state (the poll) ──────────────────────────────────────────────

/** The player's live flight. A dead client re-attaches here after a reload. */
export async function pollCrashRound(userId: string): Promise<CrashPollResult> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("crash_rounds")
    .select("*")
    .eq("user_id", userId)
    .is("settled_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = (data as unknown as CrashRow | null) ?? null;
  if (!row) return { state: "none" };

  const settled = await settleIfOver(supabase, row);
  if (settled) return settled;
  return { state: "flying", flight: flightInfo(row) };
}

/**
 * Settle a pending row the moment its own numbers say it is over. Returns
 * the terminal poll answer, or null while the flight is genuinely live.
 *
 *   auto target crossed first  → WIN at the target (the server-enforced
 *                                auto cash-out — deterministic, so a closed
 *                                tab loses nothing it had banked)
 *   crash point crossed        → LOSS (the rocket got there first)
 */
async function settleIfOver(
  supabase: ReturnType<typeof createAdminClient>,
  row: CrashRow,
): Promise<{ state: "crashed" | "cashed"; at: number; result: PlayResult } | null> {
  const elapsed = Date.now() - new Date(row.started_at).getTime();
  const nowX100 = multToX100(crashMultiplierAt(elapsed));
  const crashX100 = row.crash_x100;

  if (row.auto_x100 != null && nowX100 >= row.auto_x100 && row.auto_x100 < crashX100) {
    const result = await claimAndFinalize(supabase, row, row.auto_x100, true);
    return { state: "cashed", at: x100ToMult(row.auto_x100), result };
  }
  if (nowX100 >= crashX100 || elapsed > CRASH_TTL_MS) {
    const result = await claimAndFinalize(supabase, row, null, false);
    return { state: "crashed", at: x100ToMult(crashX100), result };
  }
  return null;
}

// ── Cash-out ────────────────────────────────────────────────────────────────

/**
 * Grade a cash-out click. The claim is atomic (compare-and-set on
 * settled_at), so a double-click, a retry and a racing poll all funnel into
 * exactly one settlement — the losers replay the committed verdict.
 */
export async function cashoutCrash(userId: string): Promise<PlayResult> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("crash_rounds")
    .select("*")
    .eq("user_id", userId)
    .is("settled_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = (data as unknown as CrashRow | null) ?? null;
  if (!row) {
    return {
      ok: false,
      error: "No flight in progress.",
      bet: 0,
      payout: 0,
      won: false,
      balance: 0,
      result: {},
    };
  }

  const elapsed = Date.now() - new Date(row.started_at).getTime();
  let claimedX100 = multToX100(crashMultiplierAt(elapsed));
  // The server-stored auto target caps the claim: an auto-cashout click
  // that arrives late still banks exactly the target, never the drifted
  // server-time multiplier past it.
  if (row.auto_x100 != null && claimedX100 > row.auto_x100) {
    claimedX100 = row.auto_x100;
  }
  const won = claimedX100 < row.crash_x100;
  return claimAndFinalize(supabase, row, claimedX100, won);
}

/**
 * The exactly-once settle: freeze the verdict on the row, then finalize.
 * `cashedX100 === null` means "the rocket won" (a loss; sweep-settled rows
 * and too-late clicks with the crash already crossed both land here).
 */
async function claimAndFinalize(
  supabase: ReturnType<typeof createAdminClient>,
  row: CrashRow,
  cashedX100: number | null,
  won: boolean,
): Promise<PlayResult> {
  const bet = num(row.bet);
  const payout = won ? Math.floor((bet * (cashedX100 ?? 0)) / 100) : 0;
  const { data: claimed } = await supabase
    .from("crash_rounds")
    .update({
      cashed_x100: cashedX100,
      cashed_at: new Date().toISOString(),
      settled_at: new Date().toISOString(),
      payout,
      won,
    })
    .eq("id", row.id)
    .is("settled_at", null)
    .select("*")
    .maybeSingle();
  // A lost race (double-click, poll, retry): the winner's verdict stands.
  const finalRow = (claimed as unknown as CrashRow | null) ?? (await reread(supabase, row.id))!;
  return finalizeCrashRow(supabase, finalRow);
}

async function reread(
  supabase: ReturnType<typeof createAdminClient>,
  id: string,
): Promise<CrashRow | null> {
  const { data } = await supabase.from("crash_rounds").select("*").eq("id", id).maybeSingle();
  return (data as unknown as CrashRow | null) ?? null;
}

// ── Settlement tail (the playGame doctrine, adapted) ────────────────────────

/**
 * Graduate a SETTLED flight into the ledger and run the tail. Idempotent by
 * construction: the game_rounds insert is keyed on the bet's nonce (a
 * retried insert hits 23505 and adopts the existing row) and `recorded_at`
 * closes the critical section, so a crashed attempt re-runs safely from the
 * frozen `cashed_x100` instead of double-paying.
 */
async function finalizeCrashRow(
  supabase: ReturnType<typeof createAdminClient>,
  row: CrashRow,
): Promise<PlayResult> {
  const bet = num(row.bet);
  const won = row.won === true;
  const payout = num(row.payout);
  const net = payout - bet;
  const result = crashResult(row);

  // Previous personal best for crash, read BEFORE this round's row lands
  // (the playGame wave-A doctrine; bigint arrives as a string).
  const { data: prevBestRes } = await supabase
    .from("stats_player_best_rounds")
    .select("best_net")
    .eq("user_id", row.user_id)
    .eq("game", "crash")
    .maybeSingle();
  const prevBest = Number(
    (prevBestRes as { best_net: string | number } | null)?.best_net ?? NaN,
  );

  if (!row.recorded_at) {
    try {
      const { error: roundError } = await supabase.from("game_rounds").insert({
        user_id: row.user_id,
        game: "crash",
        bet,
        payout,
        won,
        result,
        ...(row.client_nonce ? { client_nonce: row.client_nonce } : {}),
      });
      if (roundError) {
        // A 23505 means a previous finalize attempt already inserted this
        // nonce's row and died before closing the section — adopt it and
        // re-run the tail. Anything else is a real failure: throw, leaving
        // recorded_at open for the sweep / next touch to retry.
        const raced = row.client_nonce && String(roundError.code) === "23505";
        if (!raced) throw roundError;
      }

      // The bet left the wallet at launch, so the tail credits the PAYOUT
      // (not the net) and must never void: a failure here throws, leaving
      // recorded_at open for the sweep / next touch to retry.
      if (payout > 0) {
        await bumpCoins(row.user_id, payout);
      }
      const { error: counterError } = await supabase.rpc("bump_counters", {
        p_user_id: row.user_id,
        p_deltas: {
          games_played: 1,
          games_won: won ? 1 : 0,
          coins_won: Math.max(0, net),
          coins_lost: Math.max(0, -net),
          coins_wagered: bet,
        },
      });
      if (counterError) throw counterError;
      await supabase
        .from("crash_rounds")
        .update({ recorded_at: new Date().toISOString() })
        .eq("id", row.id)
        .is("recorded_at", null);
    } catch (error) {
      console.warn("[crash] settlement tail failed, will retry:", error);
    }
  }

  // ── Best-effort garnish (the playGame semantics: never fails a round) ────
  let jackpots: { game: number; mega: number } | null = null;
  let jackpotWon: { scope: string; kind: "mega" | "game"; amount: number } | null = null;
  const economy = await getEconomy();
  if (bet > 0) {
    try {
      const gameHit =
        economy.jackpotGameOdds > 0 && Math.random() < 1 / economy.jackpotGameOdds;
      const megaHit =
        economy.jackpotMegaOdds > 0 && Math.random() < 1 / economy.jackpotMegaOdds;
      const { data: jpRaw, error: jpError } = await supabase.rpc("jackpot_round", {
        p_user_id: row.user_id,
        p_game: "crash",
        // A cashed-out flight lost nothing beyond its chance; only a crashed
        // one feeds the pots (p_loss = the whole stake).
        p_loss: won ? 0 : bet,
        p_game_rate: economy.jackpotGameRate / 100,
        p_mega_rate: economy.jackpotMegaRate / 100,
        p_game_seed: economy.jackpotGameSeed,
        p_mega_seed: economy.jackpotMegaSeed,
        p_game_hit: gameHit,
        p_mega_hit: megaHit,
      });
      if (jpError) throw jpError;
      const jpRow = (
        Array.isArray(jpRaw) ? jpRaw[0] : jpRaw
      ) as {
        out_game_pot: string | number;
        out_mega_pot: string | number;
        out_game_win: string | number;
        out_mega_win: string | number;
      } | null;
      if (jpRow) {
        jackpots = { game: Number(jpRow.out_game_pot), mega: Number(jpRow.out_mega_pot) };
        const gameWin = Number(jpRow.out_game_win ?? 0);
        const megaWin = Number(jpRow.out_mega_win ?? 0);
        if (megaWin > 0) jackpotWon = { scope: "mega", kind: "mega", amount: megaWin };
        else if (gameWin > 0) jackpotWon = { scope: "crash", kind: "game", amount: gameWin };
        if (jackpotWon) {
          const wonInfo = jackpotWon;
          afterResponse(() =>
            sendJackpotAlert(
              supabase,
              row.user_id,
              "crash",
              wonInfo.kind === "mega"
                ? "MEGA JACKPOT hit in Badge Rocket!"
                : "Jackpot on Badge Rocket!",
              wonInfo.kind === "mega" ? wonInfo.amount : net > 0 ? net : wonInfo.amount,
            ),
          );
          if (wonInfo.kind === "mega") {
            afterResponse(() =>
              createMegaJackpotPost(row.user_id, wonInfo.amount, {
                game: { id: "crash", title: "Badge Rocket" },
                odds: economy.jackpotMegaOdds,
              }).then(() => undefined, () => undefined),
            );
          }
        }
      }
    } catch (error) {
      console.warn("[crash] jackpot round failed:", error);
    }
  }

  let balance = await currentBalance(row.user_id);
  try {
    const awardResult = await award(row.user_id, {
      xp: won ? economy.gameWinXp : economy.gameLoseXp,
      source: "game:crash",
      countsAsGameXp: true,
      skipAchievements: true,
      feedKind: "game",
      feedTitle: won
        ? net > 0
          ? `won ${net.toLocaleString("en")} coins in Badge Rocket`
          : `called it right in Badge Rocket (${net.toLocaleString("en")} coins)`
        : `played crash (${net >= 0 ? "+" : ""}${net.toLocaleString("en")} coins)`,
      payload: { game: "crash", bet, payout },
    });
    if (awardResult) balance = awardResult.coins;
  } catch (error) {
    console.warn("[crash] award failed (best-effort):", error);
  }

  // Big-win garnish + broadcast alert — the slots 15x/25x gates, keyed on
  // the cash-out multiplier (15x / 25x of the stake).
  if (bet > 0 && payout >= bet * 15) {
    afterResponse(() =>
      logActivity({
        userId: row.user_id,
        kind: "big_win",
        title: "rode Badge Rocket to a 15x+ cash out",
        coinsAmount: net,
        payload: { game: "crash", bet, payout, mult: x100ToMult(row.cashed_x100 ?? 0) },
      }),
    );
  }
  if (bet > 0 && payout >= bet * 25) {
    afterResponse(() =>
      sendJackpotAlert(supabase, row.user_id, "crash", "Big win on Badge Rocket!", net),
    );
  }

  // Daily game-streak gate (0047/0049) — the playGame block, verbatim in
  // spirit: best-effort, never fails the round.
  let streakBonusXp = 0;
  let freezeUsed = false;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data: gate, error } = await supabase.rpc("game_streak_gate", {
      p_user_id: row.user_id,
      p_today: today,
    });
    if (!error && gate) {
      const gateRow = Array.isArray(gate) ? gate[0] : gate;
      const streak = Number((gateRow as { streak?: number })?.streak ?? -1);
      freezeUsed = Boolean((gateRow as { freeze_used?: boolean })?.freeze_used);
      if (streak > 0) {
        const bonus = Math.min(
          economy.gameStreakXpCap,
          (streak - 1) * economy.gameStreakXpPerDay,
        );
        if (bonus > 0) {
          const applied = await supabase.rpc("apply_xp_coins", {
            p_user_id: row.user_id,
            p_xp: bonus,
            p_coins: 0,
          });
          if (applied.error) throw applied.error;
          streakBonusXp = bonus;
          logActivity({
            userId: row.user_id,
            kind: "game",
            title: `extended their game streak to day ${streak}`,
            xpAmount: bonus,
            payload: { game: "crash", streak },
          }).catch(() => undefined);
        }
      }
      if (freezeUsed) {
        logActivity({
          userId: row.user_id,
          kind: "streak_freeze",
          title: `used a Streak Freeze to protect their ${streak}-day game streak`,
          payload: { item: "streak_freeze", streak, game: "crash" },
        }).catch(() => undefined);
      }
    }
  } catch {
    // streak bookkeeping is best-effort
  }

  afterResponse(() => evaluateAchievements(row.user_id).catch(() => undefined));

  const newPersonalBest = net > 0 && (!Number.isFinite(prevBest) || net > prevBest);

  return {
    ok: true,
    bet,
    payout,
    won,
    balance,
    result: {
      ...result,
      ...(newPersonalBest && { newPersonalBest: true }),
      ...(streakBonusXp > 0 && { streakBonusXp }),
      ...(freezeUsed && { freezeUsed: true }),
      ...(jackpots && { jackpots }),
      ...(jackpotWon && { jackpotWon }),
    },
  };
}

// ── Nightly sweep (cron/global) ─────────────────────────────────────────────

/**
 * Settle every orphaned flight: rows whose settlement tail died mid-way
 * (cashed_at set, recorded_at open) re-finalize at their frozen claim, and
 * anything still "pending" past the TTL is a loss the rocket already
 * collected. The bet was debited at launch — this only makes the ledger
 * tell the truth.
 */
export async function sweepCrashRounds(): Promise<{ swept: number }> {
  const supabase = createAdminClient();
  const cutoff = new Date(Date.now() - CRASH_TTL_MS).toISOString();
  const { data, error } = await supabase
    .from("crash_rounds")
    .select("*")
    .is("settled_at", null)
    .lt("started_at", cutoff)
    .limit(200);
  if (error) throw error;
  const rows = (data ?? []) as unknown as CrashRow[];
  for (const row of rows) {
    const elapsed = Date.now() - new Date(row.started_at).getTime();
    const nowX100 = multToX100(crashMultiplierAt(elapsed));
    if (row.auto_x100 != null && nowX100 >= row.auto_x100 && row.auto_x100 < row.crash_x100) {
      await claimAndFinalize(supabase, row, row.auto_x100, true);
    } else {
      await claimAndFinalize(supabase, row, null, false);
    }
  }
  return { swept: rows.length };
}
