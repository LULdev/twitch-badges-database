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
 * Stable pseudonymous visitor hash from the client IP (x-forwarded-for on
 * Vercel). Used for the 5-minute reload block on ALL view counters.
 */
export async function visitorIpHash(): Promise<string> {
  const headerList = await headers();
  const forwarded = headerList.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || headerList.get("x-real-ip") || "unknown";
  return createHash("sha256")
    .update(`${ip}:${process.env.NEXT_PUBLIC_SUPABASE_URL ?? "tbd"}`)
    .digest("hex")
    .slice(0, 40);
}

export function ipHashFromRequest(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  return createHash("sha256")
    .update(`${ip}:${process.env.NEXT_PUBLIC_SUPABASE_URL ?? "tbd"}`)
    .digest("hex")
    .slice(0, 40);
}
