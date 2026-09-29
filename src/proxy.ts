import createIntlMiddleware from "next-intl/middleware";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { envOr } from "@/lib/env";
import { routing } from "@/i18n/routing";

const handleI18nRouting = createIntlMiddleware(routing);

/**
 * The refresh below costs a blocking round trip to Supabase Auth on EVERY
 * request that carries a session cookie — two of those per navigation is what
 * made link clicks feel slow. The access token's `exp` travels inside the
 * cookie, so it can be read locally: `getUser()` (which refreshes the session)
 * only needs to run when the token is expired or about to be. Fails OPEN —
 * any parse problem falls back to the full round trip, which is always safe.
 */
function sessionNeedsRefresh(request: NextRequest): boolean {
  try {
    const jar = request.cookies.getAll();
    const base = jar.find((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name));
    if (!base) return true;
    // @supabase/ssr may chunk large sessions across `.0`, `.1`, … parts.
    const stem = base.name.replace(/\.\d+$/, "");
    let raw = "";
    for (const cookie of jar) {
      if (cookie.name === stem || cookie.name.startsWith(`${stem}.`)) {
        raw += cookie.value;
      }
    }
    if (!raw) return true;
    // The cookie value is the JSON session, URI-encoded and/or base64-encoded
    // depending on the ssr version — try the common decodings in order.
    let decoded = "";
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      decoded = raw;
    }
    let session: { access_token?: string } | null = null;
    try {
      session = JSON.parse(decoded);
    } catch {
      try {
        const b64 = decoded.replace(/-/g, "+").replace(/_/g, "/");
        session = JSON.parse(atob(b64));
      } catch {
        return true; // unknown encoding — do the network call
      }
    }
    const token = session?.access_token;
    if (typeof token !== "string" || token.split(".").length !== 3) return true;
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    const expMs = typeof payload.exp === "number" ? payload.exp * 1000 : NaN;
    if (!Number.isFinite(expMs)) return true;
    // Refresh only in the last minute of validity (or after expiry).
    return expMs - Date.now() < 60_000;
  } catch {
    return true;
  }
}

export async function proxy(request: NextRequest) {
  const isApi = request.nextUrl.pathname.startsWith("/api");

  // Skip the round trip entirely for callers with no session at all
  // (cron routes, health checks, anonymous reads).
  const hasSessionCookie = request.cookies
    .getAll()
    .some((cookie) => cookie.name.startsWith("sb-"));

  // Refreshed cookies are collected here and written to the response only after
  // it has been built. Both next-intl and `NextResponse.next` snapshot the
  // forwarded request headers at construction (`new Headers(request.headers)`),
  // so a `request.cookies.set` issued after that point reaches the browser but
  // not the Server Component render of the same request — which then found the
  // old cookie and refreshed the identical session a second time.
  const refreshed = new Map<string, { value: string; options?: CookieOptions }>();

  if (hasSessionCookie) {
    const supabase = createServerClient(
      envOr("NEXT_PUBLIC_SUPABASE_URL"),
      envOr("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              request.cookies.set(name, value);
              refreshed.set(name, { value, options });
            });
          },
        },
      },
    );

    // A single refresh per request: closing over the response here would rotate
    // the token twice, which is what logged users out. Now gated on the token's
    // local `exp` (see sessionNeedsRefresh): valid tokens skip the network call.
    if (sessionNeedsRefresh(request)) {
      await supabase.auth.getUser();
    }
  }

  // API routes must not run the i18n redirect/rewrite, but they DO need the
  // session refresh: the server-side Supabase client cannot set cookies, and
  // Supabase rotates the refresh token on every use. While `/api` was excluded
  // from this middleware the rotated token was dropped, so the next call
  // arrived with a superseded token and the session died silently.
  // Built after the refresh so the forwarded request headers carry the new
  // cookie set.
  const response = isApi
    ? NextResponse.next({ request })
    : handleI18nRouting(request);

  for (const [name, { value, options }] of refreshed) {
    response.cookies.set(name, value, options);
  }

  return response;
}

export const config = {
  matcher: [
    // Next internals and any file with an extension (static assets incl.
    // sw.js, icons, images) stay out — but /api is included on purpose so its
    // sessions refresh as well.
    "/((?!_next/static|_next/image|sw\\.js|.*\\..*).*)",
  ],
};