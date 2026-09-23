import { adminAction } from "@/lib/admin-route";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ECONOMY_DEFAULTS,
  FEATURE_DEFAULTS,
  clearSettingsCache,
  getAdminIdentity,
  getAdminIdentityOrNull,
  getEconomy,
  getFeatures,
  getGames,
  type AdminGrant,
} from "@/lib/settings";
import { audit, mayAssignRole, outranks, roleRank, setSetting, type AdminRole } from "@/lib/admin";
import { GAMES } from "@/lib/gamification/games";

export const dynamic = "force-dynamic";

/** GET /api/admin/settings — the whole settings document plus the game catalog. */
export async function GET(request: Request) {
  return adminAction(async () => {
    const [economy, games, features, admin] = await Promise.all([
      getEconomy(),
      getGames(GAMES),
      getFeatures(),
      getAdminIdentity(),
    ]);
    return {
      economy,
      defaults: {
        economy: ECONOMY_DEFAULTS,
        features: FEATURE_DEFAULTS,
      },
      games,
      features,
      admin,
      catalog: GAMES.map((game) => ({
        id: game.id,
        title: game.title,
        type: game.type,
        minBet: game.minBet,
        maxBet: game.maxBet,
      })),
    };
  }, request);
}

/**
 * POST /api/admin/settings — writes one section, plus the three admin-grant
 * actions which live in the same document.
 */
export async function POST(request: Request) {
  return adminAction(async (ctx, _url, body) => {
    const section = String(body?.section ?? "");

    if (section === "economy" || section === "games" || section === "features") {
      // Changing the economy or a feature switch is an admin decision. A moderator
      // reaches this route (requireAdmin accepts moderator) but must not be able
      // to reshape the economy.
      if (roleRank(ctx.role) < roleRank("admin")) {
        return { error: "forbidden: changing settings requires an administrator" };
      }
      await setSetting(section, body?.value ?? {});
      clearSettingsCache();
      await audit(ctx, `settings.${section}`, section, body?.value as Record<string, unknown>);
      return { ok: true };
    }

    // Admin and moderator grants: the owner's identity is not editable here —
    // it is set once by the bootstrap flow and is what keeps the panel open.
    if (section === "admins") {
      const action = String(body?.action ?? "");
      // The identity read is the substrate of the write. A FAILED read is not an
      // empty document: spreading `{}` here persisted a document without
      // `profileId`, which reopens the bootstrap passcode door and defeats the
      // owner-protection check below. Refuse instead of erasing it.
      const identity = await getAdminIdentityOrNull();
      if (!identity) {
        return {
          error: "the admin settings document could not be read — refusing to overwrite it",
        };
      }
      const grants = Array.isArray(identity.grants) ? [...identity.grants] : [];

      if (action === "add") {
        const username = String(body?.username ?? "").trim();
        const role = String(body?.role ?? "moderator") as AdminRole;
        if (role !== "moderator" && role !== "admin") {
          return { error: "holders can only be moderators or admins" };
        }
        // Same ladder as the users route: an actor may only hand out a role it
        // outranks, and only the owner may create another owner. Without this a
        // moderator could grant themselves `admin` from this route while the
        // header hides the panel from moderators entirely.
        if (!mayAssignRole(ctx.role, role)) {
          return { error: "forbidden: you cannot grant that role" };
        }
        const supabase = createAdminClient();
        // Twitch id first when one was given: a username is renameable.
        const twitchId = String(body?.twitchId ?? "").trim();
        const query = supabase.from("profiles").select("id, username, role");
        // The username is a client-supplied LIKE pattern that SELECTS ONE profile,
        // so its wildcards must be escaped — unescaped, `%`/`_`/`*` matched an
        // arbitrary member and granted THEM the role the operator named.
        const usernamePattern = username
          .replace(/\\/g, "\\\\")
          .replace(/%/g, "\\%")
          .replace(/_/g, "\\_")
          .replace(/\*/g, "\\*");
        const { data: profile } = /^\d{5,20}$/.test(twitchId)
          ? await query.eq("twitch_id", twitchId).maybeSingle()
          : await query.ilike("username", usernamePattern).maybeSingle();
        if (!profile) {
          return { error: "no profile with that name — the member has to log in once first" };
        }
        if (profile.role === "owner") {
          return { error: "that profile is the owner" };
        }
        if (!outranks(ctx.role, String(profile.role ?? "user"))) {
          return { error: "forbidden: that member is not below you" };
        }
        const grant: AdminGrant = {
          profileId: profile.id,
          username: profile.username,
          role: role as "moderator" | "admin",
          addedAt: new Date().toISOString(),
        };
        const rest = grants.filter((entry) => entry.profileId !== grant.profileId);
        await setSetting("admin", { ...identity, grants: [...rest, grant] });
        // The role column is the enforcement; the grants list is the record the
        // panel renders. Both are written so a removal restores 'user'.
        const { error } = await supabase
          .from("profiles")
          .update({ role: grant.role })
          .eq("id", grant.profileId);
        if (error) throw error;
        clearSettingsCache();
        await audit(ctx, "admin.grant", grant.username, { role: grant.role });
        return { ok: true, grant };
      }

      if (action === "remove") {
        const profileId = String(body?.profileId ?? "");
        const entry = grants.find((grant) => grant.profileId === profileId);
        if (!entry) return { error: "that profile is not in the list" };
        // Nobody may revoke their own access (that is how a panel locks itself
        // out), and the same ladder applies to removal as to granting.
        if (entry.profileId === ctx.profileId) {
          return { error: "you cannot remove your own access" };
        }
        // Strict `outranks` (>), not `>=`. Equality is deliberate on the GRANT
        // path — an admin may create a peer admin — but not on removal:
        // revocation is destructive and irreversible from the other side and one
        // click can strip every peer at once, and the users route already uses the
        // strict ladder, so a plain admin must not strip a peer here either. An
        // admin still removes moderators; removing a peer admin is the owner's call.
        if (!outranks(ctx.role, entry.role)) {
          return { error: "forbidden: that member is not below you" };
        }
        // The owner can never be removed or demoted from here.
        if (identity.profileId === profileId) {
          return { error: "the owner cannot be removed" };
        }
        await setSetting("admin", {
          ...identity,
          grants: grants.filter((grant) => grant.profileId !== profileId),
        });
        const supabase = createAdminClient();
        const { error } = await supabase
          .from("profiles")
          .update({ role: "user" })
          .eq("id", profileId);
        if (error) throw error;
        clearSettingsCache();
        await audit(ctx, "admin.revoke", entry.username);
        return { ok: true };
      }

      return { error: "unknown admin action" };
    }

    return { error: "unknown settings section" };
  }, request);
}