import createIntlMiddleware from "next-intl/middleware";
import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { envOr } from "@/lib/env";
import { routing } from "@/i18n/routing";

const handleI18nRouting = createIntlMiddleware(routing);

export async function proxy(request: NextRequest) {
  const response = handleI18nRouting(request);

  // Refresh the Supabase session on every localized request, propagating
  // refreshed auth cookies onto the i18n response (redirect or next()).
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

  return response;
}

export const config = {
  matcher: [
    // Skip API routes, Next internals, and any file with an extension
    // (static assets incl. sw.js, icons, images).
    "/((?!api|_next/static|_next/image|sw\\.js|.*\\..*).*)",
  ],
};
