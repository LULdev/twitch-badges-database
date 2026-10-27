import { config } from "dotenv";
config({ path: ".env.local" });
const { createClient } = await import("@/lib/supabase/server");
