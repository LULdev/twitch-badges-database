import { createHash, timingSafeEqual } from "node:crypto";
import { envOrNull } from "./env";

/**
 * Authorize a cron request.
 *
 * The previous `auth !== \`Bearer ${secret}\`` compared strings directly, which
 * short-circuits on the first differing byte and leaks a tiny timing signal. The
 * digest comparison below is constant-time and of fixed length, so the header's
 * length does not matter either.
 */
export function isAuthorizedCron(request: Request): boolean {
  const secret = envOrNull("CRON_SECRET");
  const header = request.headers.get("authorization");
  if (!secret || !header) return false;

  const expected = createHash("sha256").update(`Bearer ${secret}`).digest();
  const received = createHash("sha256").update(header).digest();
  return timingSafeEqual(expected, received);
}
