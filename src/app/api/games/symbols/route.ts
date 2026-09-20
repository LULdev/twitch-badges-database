import { createAdminClient } from "@/lib/supabase/admin";
import { slotSymbols } from "@/lib/gamification/games";

export const dynamic = "force-dynamic";

/** Badge symbol pool (Badges of Ra, memory, quiz) with real badge images. */
export async function GET() {
  const supabase = createAdminClient();
  const symbols = await slotSymbols(supabase);
  return Response.json({ symbols });
}
