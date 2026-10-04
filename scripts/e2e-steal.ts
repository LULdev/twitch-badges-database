import { config } from "dotenv";
import { randomUUID } from "node:crypto";

config({ path: ".env.local" });

/**
 * Theft-ledger E2E — manual, DB-writing, self-cleaning. Run with
 * `npm run e2e:steal` (NOT part of `verify`: it creates real auth users and
 * needs the service role, which CI must not hold).
 *
 * Why an E2E for a transaction list: `steal_attempts` was empty in production
 * when the victim-side ledger leg shipped, so nothing had ever exercised the
 * query the inventory page depends on. This script runs the REAL path —
 * `attemptSteal` through the production function, then the EXACT page query —
 * and asserts the whole contract in one throwaway pair of users:
 *
 *  1. attemptSteal writes exactly one steal_attempts row for the victim with
 *     cost = the returned cost and coins = the returned stolen amount.
 *  2. The page's net formula `cost − coins` matches the coins that ACTUALLY
 *     moved: the victim's balance is read back from user_progress and must
 *     equal 10,000 + (cost − coins) plus the coin rewards of the achievement
 *     rows the same call evaluates — a ledger-consistency equation, not an
 *     identity derived from the same numbers (an earlier version compared
 *     row.cost/row.coins to the return values only, which could never fail
 *     independently). The thief's balance is checked the same way: it must
 *     equal the RPC-returned balance AND 10,000 − cost + stolen, both plus
 *     its own achievement rewards.
 *  3. The page's FK-hinted embed query resolves (constraint name correct) and
 *     the `thief` field arrives as an OBJECT (to-one); the page normalizes
 *     both shapes either way.
 *  4. The thief's feed row carries the ledger value (+stolen / −cost).
 *  5. Cleanup is asserted, not assumed: every created user is deleted even
 *     when setup fails half-way (ids are registered at creation), deletion
 *     failures are reported, and steal_attempts, activity_events, profiles
 *     AND user_progress must all be empty for the fixture ids afterwards —
 *     so a future FK change that breaks the cascade fails loudly here
 *     instead of leaking fixture rows into production.
 *
 * Known substitution, deliberately: build the throwaway users' usernames via
 * `full_name` — the handle_new_user trigger derives profiles.username from
 * full_name/preferred_username, NOT from a `username` key (the first version
 * of this script fell into that and the victim lookup 404'd). Passwords are
 * random UUIDs so a leaked fixture account (should cleanup ever fail) is not
 * loginable from the printed output.
 *
 * No top-level await (tsx runs CJS): everything sits in main().
 */
async function main() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { attemptSteal } = await import("@/lib/gamification/daily");
  const admin = createAdminClient();

  const stamp = Date.now();
  const thiefName = `tmpthief${stamp}`;
  const victimName = `tmpvictim${stamp}`;
  const START_BALANCE = 10_000;

  const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
  const check = (name: string, ok: boolean, detail = "") => {
    checks.push({ name, ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " — " + detail}`);
  };

  // Registered the moment a user exists, so the finally-block cleans up even
  // when the SECOND mk() or the profile assertion throws.
  const created: string[] = [];
  const mk = async (username: string) => {
    const res = await admin.auth.admin.createUser({
      email: `${username}@example.com`,
      password: randomUUID(),
      email_confirm: true,
      user_metadata: { full_name: username },
    });
    if (res.error) throw new Error(`createUser ${username}: ${res.error.message}`);
    const id = res.data.user.id;
    created.push(id);
    const { data: profile } = await admin
      .from("profiles")
      .select("username")
      .eq("id", id)
      .maybeSingle();
    if (profile?.username !== username) {
      throw new Error(`profile username is "${profile?.username}", expected "${username}"`);
    }
    const prog = await admin
      .from("user_progress")
      .insert({ user_id: id, coins: START_BALANCE });
    if (prog.error) throw new Error(`progress seed ${username}: ${prog.error.message}`);
    return id;
  };

  try {
    const thiefId = await mk(thiefName);
    const victimId = await mk(victimName);
    console.log("throwaway users:", { thiefId, victimId });

    // 1: the real production path.
    const result = await attemptSteal(thiefId, victimName);
    console.log("attemptSteal ->", JSON.stringify(result));
    if (!result.ok) throw new Error(`attemptSteal refused: ${result.error}`);
    check("attemptSteal settled", true, `success=${result.success} stolen=${result.stolen}`);

    const { data: rows, error: rowErr } = await admin
      .from("steal_attempts")
      .select("id, thief_id, victim_id, cost, coins, success, created_at")
      .eq("victim_id", victimId);
    if (rowErr) throw new Error("steal_attempts read: " + rowErr.message);
    check("exactly one attempt row", rows?.length === 1, `got ${rows?.length ?? 0}`);
    if (rows?.length !== 1) throw new Error("aborting: row count wrong");
    const row = rows[0];
    check("row.cost === returned cost", Number(row.cost) === result.cost,
      `${row.cost} vs ${result.cost}`);
    check("row.coins === returned stolen", Number(row.coins) === result.stolen,
      `${row.coins} vs ${result.stolen}`);
    check("row.success === returned success", row.success === result.success);
    check("row.thief_id matches", row.thief_id === thiefId);

    // 2: the balance effect, read back from the database — the assertion the
    // row-vs-return comparison above cannot make. The RPC applies
    // p_b_delta = -stolen + cost to the victim and (stolen - cost) to the thief.
    //
    // attemptSteal ALSO evaluates achievements for both users at the end, and
    // achievement rewards are coin movements with their own `achievement`
    // ledger rows — so the arithmetic below subtracts them explicitly
    // (achCoins) instead of pretending the transfer was the only movement.
    // That turns this into a true ledger-consistency check: final balance ==
    // seeded balance + the transfer + every achievement row. If both sides
    // were wrong in the same way, this still fails.
    const victimNet = result.cost - result.stolen;
    const achCoins = async (userId: string) => {
      const { data, error } = await admin
        .from("activity_events")
        .select("coins_amount")
        .eq("user_id", userId)
        .eq("kind", "achievement");
      if (error) throw new Error("achievement read: " + error.message);
      return (data ?? []).reduce((sum, r) => sum + Number(r.coins_amount ?? 0), 0);
    };
    const [{ data: victimProg }, { data: thiefProg }, victimAch, thiefAch] =
      await Promise.all([
        admin.from("user_progress").select("coins").eq("user_id", victimId).maybeSingle(),
        admin.from("user_progress").select("coins").eq("user_id", thiefId).maybeSingle(),
        achCoins(victimId),
        achCoins(thiefId),
      ]);
    check(
      "victim balance == seed + cost − coins + achievement rewards",
      Number(victimProg?.coins) === START_BALANCE + victimNet + victimAch,
      `${victimProg?.coins} vs ${START_BALANCE + victimNet + victimAch} (ach ${victimAch})`,
    );
    check(
      "thief balance == RPC-returned balance + achievement rewards",
      Number(thiefProg?.coins) === Number(result.balance) + thiefAch,
      `${thiefProg?.coins} vs ${Number(result.balance) + thiefAch} (balance ${result.balance}, ach ${thiefAch})`,
    );
    check(
      "thief balance == seed + stolen − cost + achievement rewards",
      Number(thiefProg?.coins) === START_BALANCE - result.cost + result.stolen + thiefAch,
      `${thiefProg?.coins} vs ${START_BALANCE - result.cost + result.stolen + thiefAch}`,
    );
    console.log(
      `balances: victim ${victimProg?.coins} (net ${victimNet > 0 ? "+" : ""}${victimNet}, ach ${victimAch}), thief ${thiefProg?.coins} (balance ${result.balance}, ach ${thiefAch}, success=${result.success})`,
    );

    // 3: the EXACT page query — constraint hint + embed shape.
    const { data: embedded, error: embErr } = await admin
      .from("steal_attempts")
      .select(
        "id, cost, coins, success, created_at, thief:profiles!steal_attempts_thief_id_fkey(username)",
      )
      .eq("victim_id", victimId)
      .order("created_at", { ascending: false })
      .limit(120);
    if (embErr) throw new Error("embed query: " + embErr.message);
    check("page embed query returns the row", embedded?.length === 1);
    const rawThief = (embedded?.[0] as { thief: unknown } | undefined)?.thief;
    const shape = Array.isArray(rawThief) ? "array" : rawThief === null ? "null" : "object";
    const thiefUsername = (Array.isArray(rawThief) ? rawThief[0] : rawThief) as
      | { username?: string | null }
      | null;
    console.log(`embed shape observed: ${shape}; username=${thiefUsername?.username}`);
    check("thief username resolves via the FK embed",
      thiefUsername?.username === thiefName, String(thiefUsername?.username));

    // 4: the thief's feed ledger row.
    const { data: feed, error: feedErr } = await admin
      .from("activity_events")
      .select("kind, title, coins_amount")
      .eq("user_id", thiefId)
      .in("kind", ["steal", "steal_defended"]);
    if (feedErr) throw new Error("feed read: " + feedErr.message);
    check("exactly one thief feed row", feed?.length === 1, `got ${feed?.length ?? 0}`);
    const expectedFeed = result.success ? result.stolen : -result.cost;
    check("feed coins_amount matches the ledger value",
      Number(feed?.[0]?.coins_amount) === expectedFeed,
      `${feed?.[0]?.coins_amount} vs ${expectedFeed}`);
  } finally {
    // 5: cleanup, asserted. Each delete is individually guarded so one
    // transport failure cannot skip the remaining user.
    const cleanupErrors: string[] = [];
    for (const id of created) {
      try {
        const del = await admin.auth.admin.deleteUser(id);
        if (del.error) cleanupErrors.push(`${id}: ${del.error.message}`);
      } catch (error) {
        cleanupErrors.push(`${id}: ${String(error)}`);
      }
    }
    const ids = created.length > 0 ? created : ["00000000-0000-0000-0000-000000000000"];
    const countRows = async (table: string, column: string) => {
      const { count, error } = await admin
        .from(table)
        // The filter column doubles as the select list: user_progress has no
        // `id` column, so selecting "id" there fails the whole count and
        // would report a phantom leak (-1).
        .select(column, { count: "exact", head: true })
        .in(column, ids);
      return error ? -1 : (count ?? 0);
    };
    const [a, f, p, up] = await Promise.all([
      countRows("steal_attempts", "thief_id"),
      countRows("activity_events", "user_id"),
      countRows("profiles", "id"),
      countRows("user_progress", "user_id"),
    ]);
    check("cleanup: no delete errors", cleanupErrors.length === 0, cleanupErrors.join("; "));
    check(
      "cascade cleanup left no rows",
      a === 0 && f === 0 && p === 0 && up === 0,
      `attempts=${a} feed=${f} profiles=${p} progress=${up}`,
    );
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(
    failed.length === 0
      ? `e2e:steal — all ${checks.length} checks passed`
      : `e2e:steal — ${failed.length} of ${checks.length} checks FAILED`,
  );
  if (failed.length > 0) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[e2e:steal] FAILED:", error);
    process.exit(1);
  });
