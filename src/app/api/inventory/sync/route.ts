import { createClient } from "@/lib/supabase/server";
import { syncUserInventory } from "@/lib/inventory";

export const dynamic = "force-dynamic";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "not authenticated" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .maybeSingle();
  const username = profile?.username;
  if (!username) {
    return Response.json({ error: "profile missing" }, { status: 404 });
  }

  try {
    const result = await syncUserInventory(user.id, username);
    // pdat-5: `ok: true` used to be unconditional even when the potat
    // enrichment had failed (potatEnriched: false) — a partial sync looked
    // identical to a complete one. Surface the real outcome: a degraded sync is
    // still HTTP 200 (the badge list did sync), but the body says so.
    const degraded = !result.potatEnriched;
    return Response.json({ ok: !degraded, degraded, result });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "failed" },
      { status: 502 },
    );
  }
}
