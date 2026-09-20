import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface AccountPayload {
  displayName?: string;
  bio?: string;
  bannerUrl?: string;
  color?: string;
  inventoryPublic?: boolean;
  showcaseSlots?: string[];
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
