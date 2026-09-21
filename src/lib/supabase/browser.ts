import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  // NEXT_PUBLIC_* values must be read as STATIC member expressions.
  // The bundler inlines `process.env.NEXT_PUBLIC_X` literals at build time;
  // a dynamic `process.env[name]` (as in src/lib/env.ts) survives into the
  // client bundle and resolves to undefined in the browser — which silently
  // killed the Twitch login. Keep this file free of env helpers.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      "Supabase environment variables are missing from the browser bundle " +
        "(NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY " +
        "were not inlined at build time).",
    );
  }

  return createBrowserClient(url, publishableKey);
}
