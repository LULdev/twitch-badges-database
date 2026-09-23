import { createAdminClient } from "@/lib/supabase/admin";
import { audit, type AdminContext } from "@/lib/admin";
import { AdminNotFoundError, AdminValidationError } from "@/lib/admin-route";

/**
 * The brainstorm board: the running list of ideas for the site, grouped by
 * category, with a status and a vote count. Publicly readable by policy; only
 * the panel writes.
 */

/**
 * Must stay in step with the check constraint in migration 0028 and with the
 * category list in BrainstormPanel. It was left at the original seven when the
 * categories were extended, so `saveIdea` rejected every idea in `addon`,
 * `performance`, `usability`, `xp`, `coin` and `admin` — the panel offered those
 * categories and the database accepted them, but the server refused to save them.
 */
export const IDEA_CATEGORIES = [
  "profile",
  "game",
  "addon",
  "badge",
  "design",
  "content",
  "stats",
  "performance",
  "usability",
  "xp",
  "coin",
  "admin",
  "other",
] as const;

export const IDEA_STATUSES = ["idea", "planned", "done", "rejected"] as const;

export type IdeaCategory = (typeof IDEA_CATEGORIES)[number];
export type IdeaStatus = (typeof IDEA_STATUSES)[number];

export interface Idea {
  id: number;
  category: string;
  title: string;
  body: string;
  status: string;
  votes: number;
  created_by: string | null;
  created_at: string;
}

export async function listIdeas(options: { category?: string; status?: string; limit?: number } = {}) {
  const supabase = createAdminClient();
  let builder = supabase
    .from("brainstorm_ideas")
    .select("*", { count: "exact" })
    .order("votes", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(options.limit ?? 100, 1), 200));
  if (options.category) builder = builder.eq("category", options.category);
  if (options.status) builder = builder.eq("status", options.status);
  const { data, error, count } = await builder;
  if (error) throw error;
  return { ideas: (data ?? []) as Idea[], total: count ?? 0 };
}

export async function saveIdea(
  ctx: AdminContext,
  input: { category: string; title: string; body?: string; status?: string },
  id?: number,
): Promise<number> {
  if (!IDEA_CATEGORIES.includes(input.category as IdeaCategory)) {
    throw new AdminValidationError("unknown category");
  }
  const title = input.title.trim();
  if (!title) throw new AdminValidationError("an idea needs a title");
  const supabase = createAdminClient();
  const row: Record<string, unknown> = { category: input.category, title };
  if (input.body !== undefined) row.body = input.body;
  if (input.status !== undefined) {
    if (!IDEA_STATUSES.includes(input.status as IdeaStatus)) {
      throw new AdminValidationError("unknown status");
    }
    row.status = input.status;
  }
  if (id) {
    const { data: updated, error } = await supabase
      .from("brainstorm_ideas")
      .update(row)
      .eq("id", id)
      .select("id");
    if (error) throw error;
    if (!updated || updated.length === 0) throw new AdminNotFoundError("idea not found");
    await audit(ctx, "idea.update", String(id), { title });
    return id;
  }
  const { data, error } = await supabase
    .from("brainstorm_ideas")
    .insert({ ...row, created_by: ctx.profileId })
    .select("id")
    .single();
  if (error) throw error;
  await audit(ctx, "idea.create", String(data.id), { title });
  return Number(data.id);
}

/**
 * Votes are a counter, so the increment happens in the database
 * (`greatest(0, votes + delta)` in one statement, migration 0029). The previous
 * version read the value, computed the next one in JavaScript and wrote it back —
 * a lost update on every concurrent vote, while the comment above it claimed the
 * relative behaviour the code did not have. The floor at zero is enforced by the
 * same statement instead of racing in application code.
 */
export async function voteIdea(ctx: AdminContext, id: number, delta: number): Promise<number> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("vote_idea", {
    p_id: id,
    p_delta: delta >= 0 ? 1 : -1,
  });
  if (error) throw error;
  // The function returns no row when the id does not exist, which is how a vote
  // for a deleted idea is told apart from a successful one.
  if (data === null || data === undefined) throw new AdminNotFoundError("idea not found");
  const votes = Number(data);
  await audit(ctx, "idea.vote", String(id), { votes });
  return votes;
}

export async function deleteIdea(ctx: AdminContext, id: number): Promise<void> {
  const supabase = createAdminClient();
  const { data: deleted, error } = await supabase
    .from("brainstorm_ideas")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw error;
  if (!deleted || deleted.length === 0) throw new AdminNotFoundError("idea not found");
  await audit(ctx, "idea.delete", String(id));
}

/** The admin audit trail, filterable by action prefix and actor. */
export async function listAudit(options: {
  action?: string;
  actor?: string;
  limit?: number;
  offset?: number;
} = {}) {
  const supabase = createAdminClient();
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  let builder = supabase
    .from("admin_audit")
    .select("id, actor, actor_id, action, target, payload, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (options.action) {
    const safe = options.action.replace(/[,()%*]/g, "");
    builder = builder.like("action", `${safe}%`);
  }
  if (options.actor) {
    const safe = options.actor.replace(/[,()%*]/g, "");
    builder = builder.ilike("actor", `%${safe}%`);
  }
  const { data, error, count } = await builder;
  if (error) throw error;
  return { entries: data ?? [], total: count ?? 0 };
}