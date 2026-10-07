import { adminAction, checkBody } from "@/lib/admin-route";
import {
  deleteBadge,
  deleteBlogPost,
  deleteChangelog,
  getBadge,
  getBlogPost,
  listBadges,
  listBlogPosts,
  listChangelog,
  upsertBadge,
  upsertBlogPost,
  upsertChangelog,
  type BadgeInput,
  type BlogInput,
} from "@/lib/admin-content";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/admin/content — blog posts, changelog entries and custom badges in one
 * surface, because they are one dashboard tab and share one shape:
 * { resource, action, id?, input? }.
 */
export async function GET(request: Request) {
  return adminAction(async (_ctx, url) => {
    const resource = url.searchParams.get("resource") ?? "blog";
    const id = url.searchParams.get("id");

    // PostgREST rejects a NaN range with an error, which surfaced as a 500; a
    // missing or non-numeric value must fall back to the default instead.
    const num = (key: string, fallback: number) => {
      const parsed = Number(url.searchParams.get(key));
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    if (resource === "blog") {
      if (id) return (await getBlogPost(id)) ?? { error: "not found" };
      return await listBlogPosts({
        limit: num("limit", 20),
        offset: num("offset", 0),
        query: url.searchParams.get("q") ?? undefined,
      });
    }
    if (resource === "changelog") {
      return await listChangelog({ limit: num("limit", 20), offset: num("offset", 0) });
    }
    if (resource === "badges") {
      if (id) return (await getBadge(id)) ?? { error: "not found" };
      return await listBadges({
        query: url.searchParams.get("q") ?? undefined,
        source: url.searchParams.get("source") ?? undefined,
        limit: num("limit", 20),
        offset: num("offset", 0),
      });
    }
    return { error: "unknown resource" };
  }, request);
}

export async function POST(request: Request) {
  return adminAction(async (ctx, _url, body) => {
    const resource = String(body?.resource ?? "");
    const action = String(body?.action ?? "");
    const id =
      body?.id === undefined || body?.id === null ? undefined : String(body.id);

    if (resource === "blog") {
      if (action === "delete" && id) {
        await deleteBlogPost(ctx, id);
        return { ok: true };
      }
      if (action === "save") {
        const input = checkBody<BlogInput>(body?.input);
        if (!input) return { error: "missing post fields" };
        return { ok: true, id: await upsertBlogPost(ctx, input, id) };
      }
    }

    if (resource === "changelog") {
      // A non-numeric id became NaN: for a save, NaN is falsy inside
      // `upsertChangelog` so the "edit" silently inserted a duplicate entry; for a
      // delete it reached `.eq("id", NaN)` and came back a 500. Scoped to this
      // resource because the blog/badges ids are strings, not numbers.
      if (id !== undefined && !Number.isFinite(Number(id))) {
        return { error: "id must be a number" };
      }
      if (action === "delete" && id) {
        await deleteChangelog(ctx, Number(id));
        return { ok: true };
      }
      if (action === "save") {
        const input = checkBody<Parameters<typeof upsertChangelog>[1]>(body?.input);
        if (!input) return { error: "missing changelog fields" };
        return {
          ok: true,
          id: await upsertChangelog(ctx, input, id ? Number(id) : undefined),
        };
      }
    }

    if (resource === "badges") {
      if (action === "delete" && id) {
        await deleteBadge(ctx, id);
        return { ok: true };
      }
      if (action === "save") {
        const input = checkBody<BadgeInput>(body?.input);
        if (!input) return { error: "missing badge fields" };
        // Badge dates reached the database unvalidated: garbage strings made
        // PostgREST answer a 500, and a reversed range (end before start) was
        // stored as-is. Reject both at the boundary with operator-facing
        // errors; null/undefined still mean "not set" and are left alone.
        const startRaw =
          input.startDate === undefined || input.startDate === null ? null : input.startDate;
        const endRaw =
          input.endDate === undefined || input.endDate === null ? null : input.endDate;
        const parseTime = (raw: string): number | null => {
          const t = Date.parse(raw);
          return Number.isNaN(t) ? null : t;
        };
        const startTime = startRaw === null || startRaw === "" ? null : parseTime(startRaw);
        const endTime = endRaw === null || endRaw === "" ? null : parseTime(endRaw);
        if ((startRaw !== null && startTime === null) || (endRaw !== null && endTime === null)) {
          return { error: "startDate and endDate must be valid ISO dates" };
        }
        if (startTime !== null && endTime !== null && endTime < startTime) {
          return { error: "endDate must not be before startDate" };
        }
        return { ok: true, id: await upsertBadge(ctx, input, id) };
      }
    }

    return { error: "unknown resource or action" };
  }, request);
}