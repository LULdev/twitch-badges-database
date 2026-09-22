import createIntlMiddleware from "next-intl/middleware";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { envOr } from "@/lib/env";
import { routing } from "@/i18n/routing";

const handleI18nRouting = createIntlMiddleware(routing);

export async function proxy(request: NextRequest) {
  const isApi = request.nextUrl.pathname.startsWith("/api");

  // API routes must not run the i18n redirect/rewrite, but they DO need the
  // session refresh: the server-side Supabase client cannot set cookies, and
  // Supabase rotates the refresh token on every use. While `/api` was excluded
  // from this middleware the rotated token was dropped, so the next call
  // arrived with a superseded token and the session died silently.
  const response = isApi
    ? NextResponse.next({ request })
    : handleI18nRouting(request);

  // Skip the round trip entirely for callers with no session at all
  // (cron routes, health checks, anonymous reads).
  const hasSessionCookie = request.cookies
    .getAll()
    .some((cookie) => cookie.name.startsWith("sb-"));

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
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value),
            );
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options),
            );
          },
        },
      },
    );

    await supabase.auth.getUser();
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