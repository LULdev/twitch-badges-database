import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import { cookies } from "next/headers";
import { envOr } from "@/lib/env";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    envOr("NEXT_PUBLIC_SUPABASE_URL"),
    envOr("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    {
      cookies: {
        getAll() {
          return parseCookieHeader(cookieStore.toString() ?? "");
        },
        // Server Components may not set cookies — refresh happens in proxy.ts.
        setAll() {},
      },
    },
  );
}
