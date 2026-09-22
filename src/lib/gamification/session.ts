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

/** Stable pseudonymous visitor hash from the client IP. */
function hashIp(ip: string): string {
  return createHash("sha256")
    .update(`${ip}:${process.env.NEXT_PUBLIC_SUPABASE_URL ?? "tbd"}`)
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
