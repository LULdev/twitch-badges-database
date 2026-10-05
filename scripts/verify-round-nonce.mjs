// E2E for the round-idempotency nonce (0063): a settled round must replay
// under the same nonce instead of settling twice.
//
//   node scripts/verify-round-nonce.mjs seed
//   node scripts/verify-round-nonce.mjs check      # against the built site
//   node scripts/verify-round-nonce.mjs cleanup
//
// `check` POSTs /api/games/play twice with the SAME nonce (the retry shape:
// first request's response was lost) and asserts the second response replays
// the first bet/payout/won AND the coin balance moved exactly once. Uses
// coinflip — a pure server roll, no local-state timing.
import fs from "node:fs";
import crypto from "node:crypto";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });
const STATE = ".round-nonce-state.json";
const BASE = process.env.VERIFY_BASE_URL ?? "https://twitch-badges-database.vercel.app";
const mode = process.argv[2];

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

if (mode === "seed") {
  const email = `round-nonce-${Date.now()}@users.noreply.local`;
  const password = "Rn-" + crypto.randomUUID().slice(0, 12) + "!7Aa";
  const { data, error } = await admin().auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { preferred_username: "round-nonce" },
  });
  if (error) throw error;
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`password grant failed: ${res.status} ${(await res.text()).slice(0, 160)}`);
  const session = await res.json();
  fs.writeFileSync(STATE, JSON.stringify({ userId: data.user.id, email, password, session, nonce: crypto.randomUUID() }));
  // Fresh accounts start coinless — a 100-coin bet would be rejected before
  // the round exists. Fund straight into the row the same way the site does.
  const a = admin();
  const { error: prog } = await a.from("user_progress").upsert({ user_id: data.user.id, coins: 5000 }, { onConflict: "user_id" });
  if (prog) throw prog;
  console.log("SEEDED", data.user.id);
} else if (mode === "cleanup") {
  const { userId } = JSON.parse(fs.readFileSync(STATE, "utf8"));
  const { error } = await admin().auth.admin.deleteUser(userId);
  if (error) throw error;
  fs.rmSync(STATE);
  console.log("CLEANED", userId);
} else if (mode === "check") {
  const { session, nonce } = JSON.parse(fs.readFileSync(STATE, "utf8"));
  const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  const cookie = `sb-${ref}-auth-token=${encodeURIComponent(JSON.stringify(session))}`;
  const config = {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ game: "coinflip", bet: 100, input: { choice: "heads", target: 1 }, nonce }),
  };
  const first = await (await fetch(`${BASE}/api/games/play`, config)).json();
  if (!first.ok) throw new Error(`first play rejected: ${JSON.stringify(first)}`);
  await new Promise((r) => setTimeout(r, 1100)); // clear the 1/s flood gate
  const second = await (await fetch(`${BASE}/api/games/play`, config)).json();
  if (!second.ok) throw new Error(`retry rejected: ${JSON.stringify(second)}`);
  const a = admin();
  const { data: rounds } = await a.from("game_rounds").select("bet,payout,won,client_nonce").eq("user_id", JSON.parse(fs.readFileSync(STATE, "utf8")).userId).order("created_at", { ascending: false }).limit(2);
  const oneSettlement =
    rounds.length === 1 &&
    String(rounds[0].client_nonce) === nonce &&
    Number(rounds[0].bet) === first.bet &&
    Number(rounds[0].payout) === first.payout;
  const replayIsCopy =
    second.bet === first.bet &&
    second.payout === first.payout &&
    second.won === first.won;
  // The balance may RISE between the two responses: the round settled once
  // (-bet), and the site's afterResponse achievement pass rewards first-round
  // achievements (c_games_first, c_coins_100) a moment later — so the retry's
  // fresh getProgress read includes those legitimate wins. What must NOT
  // happen is a second bet deduction: the retry's balance may never be BELOW
  // the first response's (a second settlement would subtract 100 again).
  const noSecondCharge = Number(second.balance) >= Number(first.balance) - 1;
  console.log("first: bet", first.bet, "payout", first.payout, "won", first.won, "balance", first.balance);
  console.log("retry (same nonce): bet", second.bet, "payout", second.payout, "won", second.won, "balance", second.balance);
  console.log("rounds stored:", JSON.stringify(rounds));
  if (!oneSettlement) throw new Error("FAIL: expected exactly one settled round under the nonce");
  if (!replayIsCopy) throw new Error("FAIL: retry did not replay the committed round");
  if (!noSecondCharge) throw new Error("FAIL: balance dropped again on replay — a second settlement deducted the bet twice");
  console.log("NONCE E2E PASSED — one settlement, replay identical, no second charge");
}