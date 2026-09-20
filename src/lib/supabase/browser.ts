import { createBrowserClient } from "@supabase/ssr";
import { envOr } from "@/lib/env";

export function createClient() {
  return createBrowserClient(
    envOr("NEXT_PUBLIC_SUPABASE_URL"),
    envOr("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  );
}
