import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  audit,
  bootstrapAvailable,
  isBootstrapSession,
  setSetting,
} from "@/lib/admin";

export const dynamic = "force-dynamic";

interface SetupBody {
  twitchId?: string;
  username?: string;
}

/**
 * Registers the owner. Only reachable inside a bootstrap session, and the
 * bootstrap door closes permanently afterwards.
 */
export async function POST(request: Request) {
  try {
    if (!(await bootstrapAvailable())) {
      return Response.json(
        { error: "an owner is already registered" },
        { status: 409 },
      );
    }
    if (!(await isBootstrapSession())) {
      return Response.json({ error: "not authenticated" }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as SetupBody | null;
    const twitchId = String(body?.twitchId ?? "").trim();
    const username = String(body?.username ?? "").trim().toLowerCase();

    if (!/^[A-Za-z0-9_]{3,25}$/.test(username)) {
      return Response.json(
        { error: "username must be a Twitch username" },
        { status: 400 },
      );
    }

    const supabase = createAdminClient();

    // Find the profile by twitch id first, then by username.
    let profileId: string | null = null;
    if (/^\d{5,20}$/.test(twitchId)) {
      const { data } = await supabase
        .from("profiles")
        .select("id")
        .eq("twitch_id", twitchId)
        .maybeSingle();
      profileId = (data as { id?: string } | null)?.id ?? null;
    }
    if (!profileId) {
      const { data } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", username)
        .maybeSingle();
      profileId = (data as { id?: string } | null)?.id ?? null;
    }
    if (!profileId) {
      return Response.json(
        { error: "profile not found — log in with Twitch once so the profile exists" },
        { status: 404 },
      );
    }

    // The service role bypasses the protect-columns trigger, so is_admin and
    // role can be set here. The sync trigger keeps them consistent anyway.
    const { error } = await supabase
      .from("profiles")
      .update({ role: "owner", is_admin: true })
      .eq("id", profileId);
    if (error) throw error;

    await setSetting("admin", {
      profileId,
      username,
      registeredAt: new Date().toISOString(),
    });

    // The bootstrap door closes permanently: drop the cookie and log the setup.
    const store = await cookies();
    store.delete("acp_bootstrap");
    await audit(
      { profileId, actor: "bootstrap", role: "bootstrap" },
      "owner.registered",
      username,
      { twitchId: twitchId || null },
    );

    return Response.json({ ok: true, profileId, username });
  } catch (error) {
    console.error("[admin/setup]", error);
    return Response.json({ error: "internal" }, { status: 500 });
  }
}