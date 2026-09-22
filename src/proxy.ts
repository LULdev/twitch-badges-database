import createIntlMiddleware from "next-intl/middleware";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { envOr } from "@/lib/env";
import { routing } from "@/i18n/routing";

const handleI18nRouting = createIntlMiddleware(routing);

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
    // the token twice, which is what logged users out.
    await supabase.auth.getUser();
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