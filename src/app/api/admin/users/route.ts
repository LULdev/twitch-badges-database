import { isAdminRole, mayAssignRole, outranks, roleRank, type AdminRole } from "@/lib/admin";
import { gateResponse, requireAdmin } from "@/lib/admin";
import {
  banUser,
  deleteUser,
  getUserDetail,
  grantAchievement,
  listUsers,
  revokeAchievement,
  setUserProgress,
  setUserRole,
  unbanUser,
  updateUserProfile,
} from "@/lib/admin-users";

export const dynamic = "force-dynamic";

/** GET /api/admin/users?q=&limit=&offset=&role=&banned=1 — search + list. */
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (id) {
      const detail = await getUserDetail(id);
      if (!detail) return Response.json({ error: "not found" }, { status: 404 });
      return Response.json(detail);
    }
    const num = (key: string, fallback: number) => {
      const parsed = Number(url.searchParams.get(key));
      return Number.isFinite(parsed) ? parsed : fallback;
    };
    const data = await listUsers({
      query: url.searchParams.get("q") ?? undefined,
      limit: num("limit", 25),
      offset: num("offset", 0),
      role: url.searchParams.get("role") ?? undefined,
      bannedOnly: url.searchParams.get("banned") === "1",
    });
    return Response.json(data);
  } catch (error) {
    return gateResponse(error);
  }
}

type Action =
  | "update"
  | "progress"
  | "role"
  | "ban"
  | "unban"
  | "delete"
  | "grantAchievement"
  | "revokeAchievement";

interface Body {
  action?: Action;
  userId?: string;
  patch?: Record<string, unknown>;
  xp?: number;
  coins?: number;
  level?: number;
  loginStreak?: number;
  bestLoginStreak?: number;
  role?: string;
  reason?: string;
  days?: number | null;
  achievementId?: string;
}

/** POST /api/admin/users — one action per call, all audited. */
export async function POST(request: Request) {
  try {
    const ctx = await requireAdmin();
    const body = (await request.json().catch(() => null)) as Body | null;
    const userId = String(body?.userId ?? "");
    if (!userId || !body?.action) {
      return Response.json({ error: "userId and action required" }, { status: 400 });
    }

    // An admin must not be able to lock themselves out, and the owner is the
    // only account that can never be demoted or removed by a peer.
    const self = ctx.profileId === userId;
    const detail = await getUserDetail(userId);
    const targetRole = (detail?.profile.role as string | null) ?? "user";
    const ownerProtected = targetRole === "owner" && ctx.role !== "owner";

    // The rank ladder applies to EVERY mutating action here, including `unban`:
    // without it a banned moderator could lift their own ban (banning writes the
    // bans row but never the role, so banned staff still authenticate to every
    // admin route), and a moderator could unban an admin. A member whose banner
    // was later demoted is an owner call, which outranks always satisfies.
    if (!self && !outranks(ctx.role, targetRole)) {
      return Response.json(
        { error: "forbidden: that member is not below you" },
        { status: 403 },
      );
    }
    // And an actor may not mint itself an economy row: `setUserProgress` clamps
    // coins at 1e12, so a moderator could otherwise award themselves the maximum.
    if (self && body.action === "progress" && ctx.role !== "owner") {
      return Response.json(
        { error: "forbidden: only an owner may edit their own economy row" },
        { status: 403 },
      );
    }

    switch (body.action) {
      case "update":
        await updateUserProfile(ctx, userId, body.patch ?? {});
        break;
      case "progress": {
        const progress = {
          xp: body.xp,
          coins: body.coins,
          level: body.level,
          loginStreak: body.loginStreak,
          bestLoginStreak: body.bestLoginStreak,
        };
        // `setUserProgress` clamps with `Number(n) || 0`, so null, "" and "abc"
        // all became 0 — a blank or malformed field silently ZEROED the value and
        // the audit row then claimed the operator set it. Same treatment `days`
        // got below: a supplied field must be a real finite number; an absent one
        // is left alone.
        for (const [key, value] of Object.entries(progress as Record<string, unknown>)) {
          if (value === undefined) continue;
          if (typeof value !== "number" || !Number.isFinite(value)) {
            return Response.json({ error: `${key} must be a number` }, { status: 400 });
          }
        }
        await setUserProgress(ctx, userId, progress);
        break;
      }
      case "role": {
        const role = String(body.role ?? "");
        if (role !== "user" && !isAdminRole(role)) {
          return Response.json({ error: "invalid role" }, { status: 400 });
        }
        // The check that was missing, and that let a moderator make themselves an
        // owner in two requests: an actor may only hand out roles it outranks, and
        // only an owner may mint another owner. A self-promotion is now refused
        // like any other instead of passing the self-demotion guard.
        if (!mayAssignRole(ctx.role, role)) {
          return Response.json({ error: "forbidden: you cannot assign that role" }, { status: 403 });
        }
        if (!self && !outranks(ctx.role, targetRole)) {
          return Response.json({ error: "forbidden: that member is not below you" }, { status: 403 });
        }
        if (self && roleRank(role) < roleRank(targetRole)) {
          return Response.json({ error: "cannot demote yourself" }, { status: 409 });
        }
        if (ownerProtected) {
          return Response.json({ error: "owner role is protected" }, { status: 409 });
        }
        await setUserRole(ctx, userId, role as AdminRole | "user");
        break;
      }
      case "ban": {
        if (self) return Response.json({ error: "cannot ban yourself" }, { status: 409 });
        if (ownerProtected) {
          return Response.json({ error: "owner is protected" }, { status: 409 });
        }
        // `Number("abc")` is NaN and `NaN <= 0` is false, so this used to reach
        // `new Date(NaN).toISOString()` and throw a RangeError: the ban was never
        // applied and the operator got a 500.
        const rawDays = body.days === null || body.days === undefined ? 0 : Number(body.days);
        if (!Number.isFinite(rawDays) || rawDays < 0) {
          return Response.json({ error: "days must be a number of days, or 0 for permanent" }, { status: 400 });
        }
        const until = rawDays === 0 ? null : new Date(Date.now() + rawDays * 86_400_000);
        await banUser(ctx, userId, String(body.reason ?? ""), until);
        break;
      }
      case "unban":
        // No self-service, ever: a banned staff member keeps their role while
        // banned, so without this the `!self` ladder exemption above would let
        // them delete their own ban row — exactly what the ladder comment
        // promises cannot happen.
        if (self) return Response.json({ error: "cannot unban yourself" }, { status: 409 });
        await unbanUser(ctx, userId);
        break;
      case "delete":
        if (self) return Response.json({ error: "cannot delete yourself" }, { status: 409 });
        if (ownerProtected) {
          return Response.json({ error: "owner is protected" }, { status: 409 });
        }
        await deleteUser(ctx, userId);
        break;
      case "grantAchievement":
        await grantAchievement(ctx, userId, String(body.achievementId ?? ""));
        break;
      case "revokeAchievement":
        await revokeAchievement(ctx, userId, String(body.achievementId ?? ""));
        break;
      default:
        return Response.json({ error: "unknown action" }, { status: 400 });
    }

    return Response.json({ ok: true });
  } catch (error) {
    return gateResponse(error);
  }
}