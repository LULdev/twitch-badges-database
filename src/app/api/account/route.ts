import { createClient } from "@/lib/supabase/server";
import { isUserBanned } from "@/lib/admin";

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
  if (await isUserBanned(user.id)) {
    return Response.json({ error: "banned" }, { status: 403 });
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
    // Cap the count, bound each slug and restrict it to the catalogue charset: the
    // column is public-read jsonb, so an unbounded string would be stored and then
    // re-sent to PostgREST's `in()` on every profile view, and postgrest-js does not
    // escape embedded quotes.
    const wanted = [
      ...new Set(
        body.showcaseSlots
          .filter((slug): slug is string => typeof slug === "string")
          .map((slug) => slug.slice(0, 120))
          .filter((slug) => /^[A-Za-z0-9._-]+$/.test(slug)),
      ),
    ].slice(0, 6);

    // The picker only offers badges the member owns, but this route is the boundary
    // and the profile renders whatever slugs match the catalogue — so an unowned slug
    // would display someone else's badge on this profile.
    if (wanted.length > 0) {
      const { data: badgeRows, error: badgeError } = await supabase
        .from("badges")
        .select("id,slug")
        .in("slug", wanted);
      if (badgeError) {
        return Response.json({ error: "showcase lookup failed" }, { status: 500 });
      }
      const idBySlug = new Map(
        ((badgeRows ?? []) as Array<{ id: string; slug: string }>).map((row) => [
          row.slug,
          row.id,
        ]),
      );
      const ids = wanted
        .map((slug) => idBySlug.get(slug))
        .filter((id): id is string => typeof id === "string");
      const { data: ownedRows, error: ownedError } = ids.length
        ? await supabase
            .from("user_inventory")
            .select("badge_id")
            .eq("user_id", user.id)
            .in("badge_id", ids)
        : { data: [] as Array<{ badge_id: string }>, error: null };
      if (ownedError) {
        return Response.json({ error: "showcase ownership check failed" }, { status: 500 });
      }
      const ownedIds = new Set((ownedRows ?? []).map((row) => row.badge_id as string));
      patch.showcase_slots = wanted.filter((slug) => {
        const id = idBySlug.get(slug);
        return id ? ownedIds.has(id) : false;
      });
    } else {
      patch.showcase_slots = [];
    }
  }
  if (typeof body.mood === "string") patch.mood = body.mood.slice(0, 60) || null;
  if (body.customization !== undefined) {
    // sec-4: `customization` used to be stored verbatim, so any authenticated
    // user could persist an arbitrarily large or malformed JSON blob that every
    // profile read then re-parsed. Bound it at the boundary: it must be a plain
    // object (arrays are rejected), at most 64 keys, and its serialized form at
    // most 4096 characters. All keys the app reads (the ProfileCustomizer
    // document) fit well inside those bounds. The DB carries the same limit in
    // migration 0012 as a backstop.
    const customization = body.customization;
    if (
      customization === null ||
      typeof customization !== "object" ||
      Array.isArray(customization)
    ) {
      return Response.json(
        { error: "customization must be an object" },
        { status: 400 },
      );
    }
    const serialized = JSON.stringify(customization);
    if (
      Object.keys(customization).length > 64 ||
      serialized === undefined ||
      serialized.length > 4096
    ) {
      return Response.json(
        { error: "customization is too large" },
        { status: 400 },
      );
    }
    patch.customization = customization;
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
