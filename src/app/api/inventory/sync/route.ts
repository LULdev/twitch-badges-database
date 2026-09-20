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
    return Response.json({ ok: true, result });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "failed" },
      { status: 502 },
    );
  }
}
