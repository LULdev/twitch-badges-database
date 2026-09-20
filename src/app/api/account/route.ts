import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface AccountPayload {
  displayName?: string;
  bio?: string;
  bannerUrl?: string;
  color?: string;
  inventoryPublic?: boolean;
  showcaseSlots?: string[];
  mood?: string;
  customization?: Record<string, unknown>;
  stealEnabled?: boolean;
  stealPrice?: number;
  stealMax?: number;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "not authenticated" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as AccountPayload | null;
  if (!body) {
    return Response.json({ error: "invalid payload" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.displayName === "string")
    patch.display_name = body.displayName.slice(0, 64) || null;
  if (typeof body.bio === "string") patch.bio = body.bio.slice(0, 280) || null;
  if (typeof body.bannerUrl === "string")
    patch.banner_url = /^https?:\/\//.test(body.bannerUrl)
      ? body.bannerUrl.slice(0, 500)
      : null;
  if (typeof body.color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.color))
    patch.color = body.color;
  if (typeof body.inventoryPublic === "boolean")
    patch.inventory_public = body.inventoryPublic;
  if (Array.isArray(body.showcaseSlots)) {
    patch.showcase_slots = body.showcaseSlots
      .filter((slug): slug is string => typeof slug === "string")
      .slice(0, 6);
  }
  if (typeof body.mood === "string") patch.mood = body.mood.slice(0, 60) || null;
  if (body.customization && typeof body.customization === "object") {
    patch.customization = body.customization;
  }
  if (typeof body.stealEnabled === "boolean") patch.steal_enabled = body.stealEnabled;
  if (typeof body.stealPrice === "number") {
    patch.steal_price = Math.max(0, Math.min(10000, Math.floor(body.stealPrice)));
  }
  if (typeof body.stealMax === "number") {
    patch.steal_max = Math.max(10, Math.min(10000, Math.floor(body.stealMax)));
  }

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: "nothing to update" }, { status: 400 });
  }

  const { error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", user.id);
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ ok: true });
}
