import { adminAction } from "@/lib/admin-route";
import { deleteIdea, listIdeas, listAudit, saveIdea, voteIdea } from "@/lib/admin-brainstorm";

export const dynamic = "force-dynamic";

/**
 * /api/admin/ideas — the brainstorm board and the audit log.
 *
 * They share a route because they are the two read-mostly tabs and both are
 * plain filtered lists; `resource` selects which.
 */
export async function GET(request: Request) {
  return adminAction(async (_ctx, url) => {
    // PostgREST rejects a NaN range with an error, which surfaced as a 500; a
    // missing or non-numeric value falls back to the default instead.
    const num = (raw: string | null, fallback: number) => {
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : fallback;
    };
    const resource = url.searchParams.get("resource") ?? "ideas";
    if (resource === "audit") {
      return await listAudit({
        action: url.searchParams.get("action") ?? undefined,
        actor: url.searchParams.get("actor") ?? undefined,
        limit: num(url.searchParams.get("limit"), 50),
        offset: num(url.searchParams.get("offset"), 0),
      });
    }
    return await listIdeas({
      category: url.searchParams.get("category") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      limit: num(url.searchParams.get("limit"), 100),
    });
  }, request);
}

export async function POST(request: Request) {
  return adminAction(async (ctx, _url, body) => {
    const action = String(body?.action ?? "");
    const rawId = body?.id === undefined || body?.id === null ? undefined : Number(body.id);
    if (rawId !== undefined && !Number.isFinite(rawId)) {
      return { error: "id must be a number" };
    }
    const id = rawId;

    if (action === "save") {
      const input = body?.input as
        | { category: string; title: string; body?: string; status?: string }
        | undefined;
      if (!input) return { error: "missing idea fields" };
      return { ok: true, id: await saveIdea(ctx, input, id) };
    }
    if (action === "vote" && id !== undefined) {
      const up = body?.up !== false;
      return { ok: true, votes: await voteIdea(ctx, id, up ? 1 : -1) };
    }
    if (action === "delete" && id !== undefined) {
      await deleteIdea(ctx, id);
      return { ok: true };
    }
    return { error: "unknown idea action" };
  }, request);
}
