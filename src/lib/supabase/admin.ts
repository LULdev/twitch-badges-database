import { createClient } from "@supabase/supabase-js";
import { envOr } from "@/lib/env";

/**
 * Service-role client. Bypasses RLS — ONLY for trusted server contexts:
 * sync scripts, cron routes and push delivery. Never import in client code.
 */
export function createAdminClient() {
  return createClient(
    envOr("NEXT_PUBLIC_SUPABASE_URL"),
    envOr("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}
