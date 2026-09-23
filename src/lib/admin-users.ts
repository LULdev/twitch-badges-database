import { createAdminClient } from "@/lib/supabase/admin";
import type { AdminContext, AdminRole } from "@/lib/admin";
import { audit } from "@/lib/admin";
import { AdminNotFoundError, AdminValidationError } from "@/lib/admin-route";
import { ACH_BY_ID } from "@/lib/gamification/achievements";

/**
 * User administration for the ACP. Everything here writes through the service
 * role (RLS bypasses are intentional — this is the moderation surface), and
 * every mutation is audited. Reads return the full profile row because the
 * dashboard is the one screen that legitimately shows all of it.
 */

/** Columns the dashboard may edit. Deliberately excludes id, twitch_id and
 *  created_at — identity fields are not an admin playground. */
export const EDITABLE_PROFILE_FIELDS = [
  "username",
  "display_name",
  "bio",
  "color",
  "banner_url",
  "theme",
  "mood",
  "inventory_public",
  "steal_enabled",
  "steal_price",
  "steal_max",
  "customization",
  "showcase_slots",
] as const;

export type EditableProfileField = (typeof EDITABLE_PROFILE_FIELDS)[number];

export interface AdminUserRow {
  id: string;
  username: string;
  display_name: string | null;
  twitch_id: string | null;
  avatar_url: string | null;
  role: string;
  is_admin: boolean;
  created_at: string;
  xp: number;
  coins: number;
  level: number;
  login_streak: number;
  banned: boolean;
  banned_until: string | null;
  ban_reason: string | null;
}

const PROFILE_SELECT =
  "id, username, display_name, twitch_id, avatar_url, bio, color, banner_url, theme, mood, role, is_admin, created_at, inventory_public, steal_enabled, steal_price, steal_max, showcase_slots, customization, view_count";

export interface ListUsersOptions {
  query?: string;
  limit?: number;
  offset?: number;
  role?: string;
  bannedOnly?: boolean;
}

/** Searches by username, display name or Twitch id; newest first by default. */
export async function listUsers(
  options: ListUsersOptions = {},
): Promise<{ users: AdminUserRow[]; total: number }> {
  const supabase = createAdminClient();
  // `Number("abc")` is NaN, and Math.min/Math.max propagate NaN, so an unchecked
  // limit reached PostgREST as an invalid range and came back as a 500.
  const rawLimit = Number(options.limit);
  const rawOffset = Number(options.offset);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 25, 1), 100);
  const offset = Math.max(Number.isFinite(rawOffset) ? rawOffset : 0, 0);

  // The ban filter is resolved BEFORE the paged query. Filtering the returned page
  // in JavaScript made banned members past page 1 unreachable and reported an
  // unfiltered total beside a filtered list.
  if (options.bannedOnly) {
    const { data: banRows, error: banError } = await supabase
      .from("bans")
      .select("profile_id, banned_until");
    if (banError) throw banError;
    const active = (banRows ?? [])
      .filter((row) => {
        const until = row.banned_until as string | null;
        return !until || new Date(until) > new Date();
      })
      .map((row) => row.profile_id as string);
    if (active.length === 0) return { users: [], total: 0 };
    return await listUsersPage(supabase, { ...options, limit, offset }, active);
  }

  return await listUsersPage(supabase, { ...options, limit, offset }, null);
}

/** The paged read itself, optionally constrained to a set of profile ids. */
async function listUsersPage(
  supabase: ReturnType<typeof createAdminClient>,
  options: { limit: number; offset: number; query?: string; role?: string },
  onlyIds: string[] | null,
): Promise<{ users: AdminUserRow[]; total: number }> {
  const { limit, offset } = options;
  let builder = supabase
    .from("profiles")
    .select(PROFILE_SELECT, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (onlyIds) builder = builder.in("id", onlyIds);

  const q = options.query?.trim();
  if (q) {
    // PostgREST or(): a comma is a separator inside the filter, so a comma in the
    // search term would split it into extra conditions. `_` and `%` are LIKE
    // wildcards and are stripped for the same reason — they do not inject, but
    // they silently widen the match (`*` is aliased to `%` by PostgREST).
    const safe = q.replace(/[,()%_\\*]/g, "");
    builder = builder.or(
      `username.ilike.%${safe}%,display_name.ilike.%${safe}%,twitch_id.ilike.%${safe}%`,
    );
  }
  if (options.role) builder = builder.eq("role", options.role);

  const { data: profiles, count, error } = await builder;
  if (error) throw error;

  const ids = (profiles ?? []).map((p) => p.id as string);
  const [progress, bans] = await Promise.all([
    ids.length
      ? supabase
          .from("user_progress")
          .select("user_id, xp, coins, level, login_streak")
          .in("user_id", ids)
      : Promise.resolve({ data: [], error: null }),
    ids.length
      ? supabase
          .from("bans")
          .select("profile_id, reason, banned_until")
          .in("profile_id", ids)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const progressById = new Map(
    (progress.data ?? []).map((row) => [row.user_id as string, row]),
  );
  const banById = new Map(
    (bans.data ?? []).map((row) => [row.profile_id as string, row]),
  );

  const users: AdminUserRow[] = (profiles ?? []).map((p) => {
    const id = p.id as string;
    const prog = progressById.get(id);
    const ban = banById.get(id);
    const bannedUntil = (ban?.banned_until as string | null) ?? null;
    const banned = !!ban && (!bannedUntil || new Date(bannedUntil) > new Date());
    return {
      id,
      username: p.username as string,
      display_name: (p.display_name as string | null) ?? null,
      twitch_id: (p.twitch_id as string | null) ?? null,
      avatar_url: (p.avatar_url as string | null) ?? null,
      role: (p.role as string) ?? "user",
      is_admin: !!p.is_admin,
      created_at: p.created_at as string,
      xp: Number(prog?.xp ?? 0),
      coins: Number(prog?.coins ?? 0),
      level: Number(prog?.level ?? 1),
      login_streak: Number(prog?.login_streak ?? 0),
      banned,
      banned_until: bannedUntil,
      ban_reason: (ban?.reason as string | null) ?? null,
    };
  });

  return { users, total: count ?? users.length };
}

/** Every editable field plus progress, for the detail drawer. */
export async function getUserDetail(id: string) {
  const supabase = createAdminClient();
  const [{ data: profile, error }, { data: progress }, { data: achievements }, { data: ban }] =
    await Promise.all([
      supabase.from("profiles").select(PROFILE_SELECT).eq("id", id).maybeSingle(),
      supabase
        .from("user_progress")
        .select("*")
        .eq("user_id", id)
        .maybeSingle(),
      supabase
        .from("user_achievements")
        .select("achievement_id, unlocked_at")
        .eq("user_id", id),
      supabase.from("bans").select("reason, banned_by, banned_until, created_at").eq("profile_id", id).maybeSingle(),
    ]);
  if (error) throw error;
  if (!profile) return null;
  // The list view already reports an expired ban as inactive; the drawer showed
     // "banned: <reason>" for it, so the two halves of the panel disagreed.
    const banUntil = (ban?.banned_until as string | null) ?? null;
    return {
      profile,
      progress: progress ?? null,
      achievements: achievements ?? [],
      ban: ban
        ? { ...ban, active: !banUntil || new Date(banUntil) > new Date() }
        : null,
    };
}

/**
 * Validates one editable field's VALUE. `EDITABLE_PROFILE_FIELDS` chose the keys;
 * without this the keys alone let `{"username": ""}` persist an empty public
 * identity (every username-addressed page then misses) and
 * `{"steal_price": -1000}` a negative price. The rules mirror what `/api/account`
 * already applies to the same columns, so a member and an admin cannot write
 * different-quality data into a public-read table.
 */
function validateProfileValue(field: EditableProfileField, value: unknown): unknown {
  switch (field) {
    case "username": {
      const username = typeof value === "string" ? value.trim().toLowerCase() : "";
      if (!/^[a-z0-9_]{3,25}$/.test(username)) {
        throw new AdminValidationError("username must be 3-25 characters of a-z, 0-9 or _");
      }
      return username;
    }
    case "display_name":
    case "bio":
    case "mood": {
      if (value === null) return null;
      if (typeof value !== "string") throw new AdminValidationError(`${field} must be text`);
      const max = field === "bio" ? 280 : field === "mood" ? 60 : 64;
      return value.trim().slice(0, max) || null;
    }
    case "color":
      if (value === null || value === "") return null;
      if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) {
        throw new AdminValidationError("color must be a #rrggbb hex value");
      }
      return value;
    case "banner_url":
      if (value === null || value === "") return null;
      if (typeof value !== "string" || !/^https?:\/\//.test(value)) {
        throw new AdminValidationError("banner_url must be an http(s) URL");
      }
      return value.slice(0, 500);
    case "theme":
      if (
        typeof value !== "string" ||
        !["auto", "violet", "emerald", "sapphire", "gold"].includes(value)
      ) {
        throw new AdminValidationError("unknown theme");
      }
      return value;
    case "inventory_public":
    case "steal_enabled":
      if (typeof value !== "boolean") {
        throw new AdminValidationError(`${field} must be true or false`);
      }
      return value;
    case "steal_price":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new AdminValidationError("steal_price must be a number");
      }
      return Math.max(0, Math.min(10_000, Math.trunc(value)));
    case "steal_max":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new AdminValidationError("steal_max must be a number");
      }
      return Math.max(10, Math.min(10_000, Math.trunc(value)));
    case "customization": {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new AdminValidationError("customization must be an object");
      }
      const serialized = JSON.stringify(value);
      if (serialized === undefined || Object.keys(value).length > 64 || serialized.length > 4096) {
        throw new AdminValidationError("customization is too large");
      }
      return value;
    }
    case "showcase_slots": {
      if (!Array.isArray(value)) {
        throw new AdminValidationError("showcase_slots must be an array");
      }
      return [
        ...new Set(
          value
            .filter((slot): slot is string => typeof slot === "string")
            .map((slot) => slot.slice(0, 120))
            .filter((slot) => /^[A-Za-z0-9._-]+$/.test(slot)),
        ),
      ].slice(0, 6);
    }
    default:
      throw new AdminValidationError("unsupported profile field");
  }
}

/** Whitelisted profile update. Unknown keys are dropped, never forwarded. */
export async function updateUserProfile(
  ctx: AdminContext,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const allowed: Record<string, unknown> = {};
  for (const field of EDITABLE_PROFILE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      allowed[field] = validateProfileValue(field, patch[field]);
    }
  }
  if (Object.keys(allowed).length === 0) {
    throw new AdminValidationError("no editable fields supplied");
  }
  const supabase = createAdminClient();
  const { data: updated, error } = await supabase
    .from("profiles")
    .update({ ...allowed, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id");
  if (error) throw error;
  if (!updated || updated.length === 0) throw new AdminNotFoundError("member not found");
  await audit(ctx, "user.update", id, { fields: Object.keys(allowed) });
}

/**
 * Sets XP/coins/level/streak directly. The gamification RPCs are built for
 * player actions (they clamp and cap); an admin correction must be able to set
 * an exact value, so this writes the row directly.
 */
export async function setUserProgress(
  ctx: AdminContext,
  id: string,
  patch: {
    xp?: number;
    coins?: number;
    level?: number;
    loginStreak?: number;
    bestLoginStreak?: number;
  },
): Promise<void> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const clamp = (n: unknown, min = 0, max = 1e12) =>
    Math.min(Math.max(Math.trunc(Number(n) || 0), min), max);
  if (patch.xp !== undefined) update.xp = clamp(patch.xp);
  if (patch.coins !== undefined) update.coins = clamp(patch.coins);
  if (patch.level !== undefined) update.level = clamp(patch.level, 1, 100);
  if (patch.loginStreak !== undefined) update.login_streak = clamp(patch.loginStreak);
  if (patch.bestLoginStreak !== undefined)
    update.best_login_streak = clamp(patch.bestLoginStreak);
  if (Object.keys(update).length === 1) {
    throw new AdminValidationError("no progress fields supplied");
  }

  const supabase = createAdminClient();
  // The progress row is created on first login; an admin editing a profile
  // that never logged in must still get a row rather than a silent no-op.
  const { data: existing } = await supabase
    .from("user_progress")
    .select("user_id")
    .eq("user_id", id)
    .maybeSingle();
  if (existing) {
    const { error } = await supabase
      .from("user_progress")
      .update(update)
      .eq("user_id", id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("user_progress")
      .insert({ user_id: id, ...update });
    if (error) throw error;
  }
  await audit(ctx, "user.progress", id, patch as Record<string, unknown>);
}

export async function setUserRole(
  ctx: AdminContext,
  id: string,
  role: AdminRole | "user",
): Promise<void> {
  const supabase = createAdminClient();
  // The before-update trigger keeps is_admin in sync with the role.
  const { data: updated, error } = await supabase
    .from("profiles")
    .update({ role })
    .eq("id", id)
    .select("id");
  if (error) throw error;
  if (!updated || updated.length === 0) throw new AdminNotFoundError("member not found");
  await audit(ctx, "user.role", id, { role });
}

export async function banUser(
  ctx: AdminContext,
  id: string,
  reason: string,
  until: Date | null,
): Promise<void> {
  const supabase = createAdminClient();
  const { data: target, error: targetError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (targetError) throw targetError;
  if (!target) throw new AdminNotFoundError("member not found");
  const { error } = await supabase.from("bans").upsert(
    {
      profile_id: id,
      reason: reason.slice(0, 500),
      banned_by: ctx.profileId,
      banned_until: until ? until.toISOString() : null,
    },
    { onConflict: "profile_id" },
  );
  if (error) throw error;
  await audit(ctx, "user.ban", id, { reason, until: until?.toISOString() ?? null });
}

export async function unbanUser(ctx: AdminContext, id: string): Promise<void> {
  const supabase = createAdminClient();
  const { data: removed, error } = await supabase
    .from("bans")
    .delete()
    .eq("profile_id", id)
    .select("profile_id");
  if (error) throw error;
  if (!removed || removed.length === 0) throw new AdminNotFoundError("that member is not banned");
  await audit(ctx, "user.unban", id);
}

/**
 * Deletes a profile. Rows without a `cascade` foreign key (progress,
 * achievements, inventory, bans, push subscriptions) are cleaned up first so
 * no orphan rows survive the delete in a schema that lacks the constraints.
 */
export async function deleteUser(ctx: AdminContext, id: string): Promise<void> {
  const supabase = createAdminClient();
  const { data: existing, error: existsError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (existsError) throw existsError;
  if (!existing) throw new AdminNotFoundError("member not found");

  // The auth account goes first. Deleting only the profile left the login intact:
  // the member could still sign in with no profile behind it, and every write they
  // made afterwards updated zero rows while reporting success.
  const { error: authError } = await supabase.auth.admin.deleteUser(id);
  if (authError) throw authError;

  const tables = [
    "user_progress",
    "user_achievements",
    "user_inventory",
    "bans",
    "push_subscriptions",
  ];
  for (const table of tables) {
    await supabase.from(table).delete().eq(table === "bans" ? "profile_id" : "user_id", id);
  }
  const { error } = await supabase.from("profiles").delete().eq("id", id);
  if (error) throw error;
  await audit(ctx, "user.delete", id);
}

export async function grantAchievement(
  ctx: AdminContext,
  id: string,
  achievementId: string,
): Promise<void> {
  // The catalog lives in code and `user_achievements` has no FK to it, so any
  // string was storable — including "" — and then rendered as a raw id wherever
  // the lookup missed. Refuse anything not in the catalog.
  if (!ACH_BY_ID.has(achievementId)) {
    throw new AdminValidationError(`unknown achievement: ${achievementId || "(empty)"}`);
  }
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("user_achievements")
    .upsert(
      { user_id: id, achievement_id: achievementId },
      { onConflict: "user_id,achievement_id" },
    );
  if (error) throw error;
  await audit(ctx, "user.achievement.grant", id, { achievementId });
}

export async function revokeAchievement(
  ctx: AdminContext,
  id: string,
  achievementId: string,
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("user_achievements")
    .delete()
    .eq("user_id", id)
    .eq("achievement_id", achievementId);
  if (error) throw error;
  await audit(ctx, "user.achievement.revoke", id, { achievementId });
}