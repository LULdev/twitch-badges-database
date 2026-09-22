import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

/** Authenticated user id from the session cookie (null when logged out). */
export async function authUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/**
 * True client IP behind the proxy.
 *
 * `x-forwarded-for` is APPENDED to by proxies, so its leftmost entry is
 * whatever the client sent — trusting it let anyone defeat the 5-minute view
 * dedup, the daily coin-rain gate and the per-IP blog reaction rule with a
 * spoofed header. Prefer Vercel's `x-real-ip`; otherwise take the RIGHTMOST
 * x-forwarded-for entry, which is the one the trusted edge appended.
 */
function clientIp(headersLike: { get(name: string): string | null }): string {
  const real = headersLike.get("x-real-ip")?.trim();
  if (real) return real;

  const forwarded = headersLike.get("x-forwarded-for") ?? "";
  const parts = forwarded
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : "unknown";
}

/**
 * Stable pseudonymous visitor hash from the client IP.
 *
 * The salt must be secret: with a public value the hash is reversible by brute
 * force, because the whole IPv4 space is small enough to enumerate. Every caller
 * of this runs server-side, so a server-only secret is used — a dedicated
 * IP_HASH_SALT when configured, otherwise the service-role key, which is never
 * exposed to the browser. Rotating it only resets the dedup windows.
 */
function hashIp(ip: string): string {
  const salt =
    process.env.IP_HASH_SALT ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.CRON_SECRET;
  if (!salt) {
    // No silent literal fallback: a guessable salt makes the "pseudonymous" hash
    // reversible, which is the whole thing this is meant to prevent.
    throw new Error(
      "No IP hash salt available — set IP_HASH_SALT (or provide a service-role key).",
    );
  }
  return createHash("sha256")
    .update(`${ip}:${salt}`)
    .digest("hex")
    .slice(0, 40);
}

/** Used for the 5-minute reload block on ALL view counters. */
export async function visitorIpHash(): Promise<string> {
  return hashIp(clientIp(await headers()));
}

export function ipHashFromRequest(request: Request): string {
  return hashIp(clientIp(request.headers));
}
