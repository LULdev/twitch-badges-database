import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { ipHashFromRequest } from "@/lib/gamification/session";
import { audit, gateResponse } from "@/lib/admin";
import {
  bootstrapAvailable,
  bootstrapCookieValue,
  bootstrapPasscodeValid,
  bootstrapSigningConfigured,
} from "@/lib/admin";

export const dynamic = "force-dynamic";

/**
 * There is no authenticated actor on this path. `setup` audits the owner it
 * registers; these rows record who reached the door, and only ever as the caller's
 * IP hash.
 */
const BOOTSTRAP_CTX = { profileId: null, actor: "bootstrap", role: "bootstrap" } as const;

/**
 * Brute-force throttle for the bootstrap passcode. The state lives in
 * site_settings so it survives function instances; the counting itself happens in
 * `acp_gate_attempt` (migration 0029) so it is atomic and per caller.
 */
const WINDOW_MS = 15 * 60 * 1000;
/** Attempts allowed per caller address inside the window. */
const MAX_ATTEMPTS = 5;
/** Ceiling across all callers, so a distributed guess still runs out of road. */
const MAX_TOTAL_ATTEMPTS = 100;

/**
 * One throttle decision, made in the database.
 *
 * Per caller rather than global: the old global counter let five wrong guesses
 * from anywhere lock the operator out of the only owner-registration path. And
 * atomic rather than a read-modify-write, which under-counted under concurrency
 * and failed open when its write failed — this one fails closed, because a
 * settings table that cannot be read is a database problem, not a reason to drop
 * the gate.
 */
async function gateAttempt(ipHash: string): Promise<{ allowed: boolean; unreachable: boolean }> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("acp_gate_attempt", {
      p_ip: ipHash,
      p_window_ms: WINDOW_MS,
      p_max_per_ip: MAX_ATTEMPTS,
      p_max_total: MAX_TOTAL_ATTEMPTS,
    });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as { allowed?: boolean } | null;
    return { allowed: row?.allowed === true, unreachable: false };
  } catch (error) {
    console.warn("[admin/auth] gate state unavailable:", error);
    return { allowed: false, unreachable: true };
  }
}

export async function GET() {
  // The door is only advertised when it can actually be used: without a server
  // secret the cookie could be forged, so the gate refuses rather than opens.
  return Response.json({
    bootstrapAvailable: (await bootstrapAvailable()) && bootstrapSigningConfigured(),
  });
}

export async function POST(request: Request) {
  try {
    if (!(await bootstrapAvailable())) {
      // 410 Gone: the passcode door is gone on purpose, not merely closed.
      return Response.json(
        { error: "bootstrap closed — an owner is registered" },
        { status: 410 },
      );
    }
    if (!bootstrapSigningConfigured()) {
      return Response.json(
        { error: "CRON_SECRET is not configured, so the bootstrap cookie cannot be signed" },
        { status: 503 },
      );
    }
    const ipHash = ipHashFromRequest(request);
    const gate = await gateAttempt(ipHash);
    if (gate.unreachable) {
      return Response.json(
        { error: "the attempt counter is unavailable — refusing to bypass the throttle" },
        { status: 503 },
      );
    }
    if (!gate.allowed) {
      // One row per BURNED BUDGET, not per guess: this is the signal that a source
      // is guessing, and it is bounded to one per address per window. The passcode
      // digest and its salt are both public in this repository, so an attempt that
      // exhausts the throttle is the event an operator needs to see. Only the hash
      // is recorded, never the raw address.
      await audit(BOOTSTRAP_CTX, "bootstrap.throttled", "passcode", { ipHash });
      return Response.json(
        { error: "too many attempts from this address — try again later" },
        { status: 429 },
      );
    }
    const body = (await request.json().catch(() => null)) as {
      passcode?: string;
    } | null;
    // The attempt was already counted by the gate call above, in the database.
    if (!bootstrapPasscodeValid(String(body?.passcode ?? ""))) {
      // Deliberately NOT audited: a wrong guess is already counted by
      // acp_gate_attempt, and a row per guess would let a brute-force run flood
      // admin_audit. The throttle row above records the same source, once.
      return Response.json({ error: "invalid passcode" }, { status: 401 });
    }
    const { value, maxAge } = bootstrapCookieValue();
    const store = await cookies();
    store.set("acp_bootstrap", value, {
      httpOnly: true,
      sameSite: "strict",
      secure: true,
      path: "/",
      maxAge,
    });
    // The one irreversible event on this path: the door was opened for an
    // installation that had none. Everything after it (registering the owner) is
    // audited by the setup route.
    await audit(BOOTSTRAP_CTX, "bootstrap.success", "passcode", { ipHash });
    return Response.json({ ok: true, next: "/setup" });
  } catch (error) {
    return gateResponse(error);
  }
}
