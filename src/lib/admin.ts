import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { authUserId } from "@/lib/gamification/session";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Admin authentication for the ACP.
 *
 * Two doors exist:
 *
 * 1. **Bootstrap** — a passcode, valid ONLY while no owner is registered in
 *    `site_settings.admin`. The passcode itself exists nowhere in this
 *    repository or the database: only this salted digest does. A correct entry
 *    sets a short-lived HMAC-signed cookie (httpOnly) that carries the
 *    bootstrap session. The moment an owner is registered the whole passcode
 *    path disappears (the routes answer 410) — that is the design, not a
 *    fallback: the digest of a five-digit code is brute-forceable, so the
 *    window in which it works must be as short as possible.
 * 2. **Role** — a logged-in member whose `profiles.role` is admin or owner.
 *    No second password: the Twitch login is the authentication, the role is
 *    the authorization.
 */

export type AdminRole = "moderator" | "admin" | "owner";

export function isAdminRole(value: string): value is AdminRole {
  return value === "moderator" || value === "admin" || value === "owner";
}

/**
 * Seniority, so an authorization decision can compare two roles instead of
 * listing special cases. The panel's original guards protected the owner only as
 * a *target* and blocked self-demotion, which left the door open for a moderator
 * to assign themselves the owner role: what was missing is the check "may this
 * actor hand out that role at all".
 */
export const ROLE_RANK: Record<AdminRole, number> = {
  moderator: 1,
  admin: 2,
  owner: 3,
};

export function roleRank(role: string | null | undefined): number {
  return isAdminRole(String(role)) ? ROLE_RANK[role as AdminRole] : 0;
}

/** True when `actor` may act on a member holding `targetRole` at all. */
export function outranks(actor: AdminRole | "bootstrap", targetRole: string): boolean {
  if (actor === "bootstrap") return false;
  return roleRank(actor) > roleRank(targetRole);
}

/**
 * True when `actor` may assign `nextRole`. Only an owner may create another
 * owner, and nobody may promote someone past their own rank — so a moderator can
 * promote nobody, and an admin can promote at most an admin.
 */
export function mayAssignRole(actor: AdminRole | "bootstrap", nextRole: string): boolean {
  if (actor === "bootstrap") return false;
  if (nextRole === "owner") return actor === "owner";
  if (nextRole === "user") return true;
  return roleRank(actor) >= roleRank(nextRole);
}

export interface AdminContext {
  /** The acting profile id, or null when this is a bootstrap session. */
  profileId: string | null;
  /** Display name for the audit trail ("bootstrap" until an owner exists). */
  actor: string;
  role: AdminRole | "bootstrap";
}

const BOOTSTRAP_SALT = "tbd-acp-bootstrap-v1";
const BOOTSTRAP_DIGEST =
  "8f3d79b17d2b17e6d68a045d377ab5fd16f2a8b1d18aad24da2357f9d8a2c57b";
const COOKIE_NAME = "acp_bootstrap";
/** Two hours: long enough to finish the setup, short enough to limit exposure. */
const COOKIE_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * The cookie's signing key.
 *
 * It must include a server-only secret: the digest lives in this repository, so
 * falling back to the digest alone (`CRON_SECRET ?? ""`) meant that anyone with a
 * copy of the repo could forge a bootstrap cookie. There is now no silent
 * fallback — if no server secret is configured the door refuses to hand out a
 * session, which is a visible misconfiguration instead of a quiet forged door.
 */
function cookieSecret(): string {
  const secret = process.env.CRON_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error(
      "no server secret available to sign the bootstrap cookie — set CRON_SECRET",
    );
  }
  return `${BOOTSTRAP_DIGEST}:${secret}`;
}

function sign(value: string): string {
  return createHmac("sha256", cookieSecret()).update(value).digest("hex");
}

/** Constant-time digest comparison, same contract as cron-auth.ts. */
function digestMatches(input: string): boolean {
  const candidate = createHmac("sha256", BOOTSTRAP_SALT)
    .update(input)
    .digest("hex");
  const expected = Buffer.from(BOOTSTRAP_DIGEST, "hex");
  const provided = Buffer.from(candidate, "hex");
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

/**
 * True while the bootstrap passcode door is still open.
 *
 * Keyed on whether an OWNER PROFILE is recorded, not on whether the settings
 * row exists: migration 0026 seeds `admin` with `{"grants": []}` so the stored
 * document reflects reality, and an existence check read that empty document as
 * "someone already claimed this installation" — which closed the passcode door
 * for good and left the installation with no way to register an owner.
 */
export async function bootstrapAvailable(): Promise<boolean> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("site_settings")
      .select("value")
      .eq("key", "admin")
      .maybeSingle();
    // A read that FAILED is not an empty document. Treating it as "no owner yet"
    // opened the passcode door on an installation that already has one, and the
    // passcode digest plus its salt are both public in this repository — so the
    // window must fail closed, not open.
    if (error) return false;
    const value = data?.value as { profileId?: string } | null | undefined;
    return !value?.profileId;
  } catch {
    return false;
  }
}

/** Validates the passcode. Rate limiting is handled by the route. */
export function bootstrapPasscodeValid(input: string): boolean {
  if (typeof input !== "string" || input.length === 0 || input.length > 64) {
    return false;
  }
  return digestMatches(input);
}

/** Issues the bootstrap cookie value (route sets it as httpOnly). */
export function bootstrapCookieValue(): { value: string; maxAge: number } {
  const expires = Date.now() + COOKIE_TTL_MS;
  const payload = String(expires);
  return { value: `${payload}.${sign(payload)}`, maxAge: Math.floor(COOKIE_TTL_MS / 1000) };
}

/** True when the cookie signing key is available, so the gate can be offered at all. */
export function bootstrapSigningConfigured(): boolean {
  return !!(process.env.CRON_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** Verifies the bootstrap cookie (signature + expiry). */
export async function isBootstrapSession(): Promise<boolean> {
  try {
    const store = await cookies();
    const raw = store.get(COOKIE_NAME)?.value;
    if (!raw) return false;
    const dot = raw.lastIndexOf(".");
    if (dot === -1) return false;
    const payload = raw.slice(0, dot);
    const signature = raw.slice(dot + 1);

    let expected: string;
    try {
      expected = sign(payload);
    } catch {
      // No server secret: refuse rather than compare against a public key.
      return false;
    }

    // Compare BYTE lengths. A 64-character cookie value that is not ASCII has a
    // longer byte length, and `timingSafeEqual` throws a RangeError on
    // mismatched buffers — an unauthenticated request with such a cookie turned
    // /admin and /api/admin/setup into a 500.
    const provided = Buffer.from(signature, "utf8");
    const wanted = Buffer.from(expected, "utf8");
    if (provided.length !== wanted.length) return false;
    if (!timingSafeEqual(provided, wanted)) return false;

    const expires = Number(payload);
    if (!Number.isFinite(expires) || expires <= Date.now()) return false;
    // The expiry is part of the signed payload, so it cannot be moved by an
    // attacker without the secret — but a session that claims to last a decade
    // should not be honoured even if it was issued legitimately.
    return expires <= Date.now() + COOKIE_TTL_MS * 2;
  } catch {
    return false;
  }
}

/** Reads the caller's role, or null when not logged in. */
export async function viewerRole(): Promise<AdminRole | null> {
  const userId = await authUserId();
  if (!userId) return null;
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  const role = (data as { role?: string } | null)?.role;
  return role === "owner" || role === "admin" || role === "moderator"
    ? (role as AdminRole)
    : null;
}

/**
 * The gate for every admin route. Throws `AdminGateError` so a route can turn
 * it into a single, consistent response.
 */
export class AdminGateError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

export async function requireAdmin(options?: {
  /** Permit a bootstrap session. Only the owner-registration route may ask. */
  allowBootstrap?: boolean;
}): Promise<AdminContext> {
  // A registered owner/admin/moderator always wins.
  const role = await viewerRole();
  if (role) {
    const userId = await authUserId();
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", userId!)
      .maybeSingle();
    return {
      profileId: userId,
      actor: (data as { username?: string } | null)?.username ?? "admin",
      role,
    };
  }

  // Bootstrap is a door to ONE thing: registering the owner. It must not open
  // the rest of the panel — the passcode is short and only rate-limited, so
  // treating it as a general admin session would let a lucky guess manage every
  // account. Routes other than /api/admin/setup get a plain 403.
  if (options?.allowBootstrap && (await bootstrapAvailable())) {
    if (await isBootstrapSession()) {
      return { profileId: null, actor: "bootstrap", role: "bootstrap" };
    }
    throw new AdminGateError(401, "not authenticated");
  }
  // Same 403 whether the caller is logged out or merely unprivileged: the
  // panel's existence is not something an anonymous probe needs confirmed.
  throw new AdminGateError(403, "forbidden");
}

/** Same, for handlers that prefer a result over an exception. */
export async function adminOrNull(): Promise<AdminContext | null> {
  try {
    return await requireAdmin();
  } catch {
    return null;
  }
}

/** Turns the gate error into the standard response shape. */
export function gateResponse(error: unknown): Response {
  if (error instanceof AdminGateError) {
    return Response.json({ error: error.code }, { status: error.status });
  }
  // A deliberate validation failure carries its own status (AdminValidationError
  // 400, AdminNotFoundError 404). Checked structurally rather than by importing
  // the class, because admin-route.ts already imports this module and a cycle
  // between the two would be worse than a duck-typed check.
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
  ) {
    return Response.json(
      { error: error instanceof Error ? error.message : "invalid request" },
      { status: (error as { status: number }).status },
    );
  }
  return Response.json({ error: "internal" }, { status: 500 });
}

/** Writes one audit row; failures never break the mutation itself. */
export async function audit(
  ctx: AdminContext,
  action: string,
  target: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  try {
    const supabase = createAdminClient();
    // supabase-js RESOLVES with `{ error }` and does not throw, so the catch this
    // used to rely on was dead code and a lost audit row was invisible.
    const { error } = await supabase.from("admin_audit").insert({
      actor_id: ctx.profileId,
      actor: ctx.actor,
      action,
      target,
      payload: payload ?? null,
    });
    if (error) console.warn("[admin] audit write failed:", error.message);
  } catch (error) {
    console.warn("[admin] audit write threw:", error);
  }
}

/** Reads a settings key with a fallback when it does not exist yet. */
export async function getSetting<T>(
  key: string,
  fallback: T,
): Promise<T> {
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("site_settings")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    return (data?.value as T | undefined) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Upserts a settings key. */
export async function setSetting(
  key: string,
  value: unknown,
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("site_settings")
    .upsert(
      { key, value, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (error) throw error;
}

/**
 * True when the profile has an active ban.
 *
 * A ban is a row in `bans`; `banned_until` null means permanent. The check is
 * duplicated deliberately: a banned member is stopped at every mutating route
 * (games, steals, daily claim, wheel, coin rain, progress, account, inventory,
 * blog reactions, push) rather than only at login, because their session keeps
 * working until the refresh token expires. This list is a claim about the call
 * sites, so it has to stay true: push was missing its gate while this comment
 * said otherwise, and the gate was added.
 */
export async function isUserBanned(userId: string): Promise<boolean> {
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("bans")
      .select("banned_until")
      .eq("profile_id", userId)
      .maybeSingle();
    if (!data) return false;
    const until = data.banned_until as string | null;
    return !until || new Date(until) > new Date();
  } catch {
    // A missing table (pre-migration) must not lock everyone out.
    return false;
  }
}

export type PlayerGate =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403; code: "not authenticated" | "banned" };

/**
 * Guard for every player-facing mutation. Replaces the bare
 * `const userId = await authUserId()` in the gamification routes so a banned
 * member is stopped with 403 instead of 401 — the dashboard then shows the
 * ban reason rather than a login prompt.
 */
export async function playerGate(): Promise<PlayerGate> {
  const userId = await authUserId();
  if (!userId) {
    return { ok: false, status: 401, code: "not authenticated" };
  }
  if (await isUserBanned(userId)) {
    return { ok: false, status: 403, code: "banned" };
  }
  return { ok: true, userId };
}