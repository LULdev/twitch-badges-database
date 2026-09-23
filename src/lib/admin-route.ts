import { gateResponse, requireAdmin, type AdminContext } from "@/lib/admin";

/**
 * Shared plumbing for the admin API routes.
 *
 * The panel's routes all have the same shape — authenticate, read the URL and
 * an optional JSON body, do one thing, return JSON, and turn any thrown error
 * into a status code — so that shape lives here instead of being copied into
 * every handler. `AdminGateError` keeps its status; a plain Error becomes 400
 * with its message, because these errors are written for the operator ("slug is
 * already taken"), not for a log file.
 */
export type AdminActionResult = unknown;

/**
 * A deliberate, operator-facing failure ("a post needs a slug", "unknown
 * category"), thrown by the admin libraries and mapped to `400` with its
 * message. The previous approach guessed by matching the error text against an
 * allow-list of words, which missed phrasings like "draft not found" and turned
 * them into a `500` that tells the operator nothing.
 */
export class AdminValidationError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = "AdminValidationError";
  }
}

/** A mutation that matched no rows — another admin removed the row first. */
export class AdminNotFoundError extends AdminValidationError {
  constructor(message = "not found") {
    super(message, 404);
    this.name = "AdminNotFoundError";
  }
}

export async function adminAction(
  handler: (
    ctx: AdminContext,
    url: URL,
    body: Record<string, unknown> | null,
  ) => Promise<AdminActionResult>,
  request: Request,
): Promise<Response> {
  try {
    const ctx = await requireAdmin();
    const url = new URL(request.url);
    let body: Record<string, unknown> | null = null;
    if (request.method !== "GET" && request.method !== "HEAD") {
      body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    }
    const result = await handler(ctx, url, body);
    // A handler that returns `{ error }` is refusing the action, so it must not
    // travel as `200`: the panels decide what to show from `res.ok`, and a
    // rejected action used to display the success notice.
    if (result && typeof result === "object" && "error" in result) {
      return Response.json(result, { status: 400 });
    }
    return Response.json(result ?? { ok: true });
  } catch (error) {
    if (error instanceof AdminValidationError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Error && !("status" in error)) {
      console.error("[admin-route]", error);
      return Response.json({ error: "internal" }, { status: 500 });
    }
    return gateResponse(error);
  }
}

/** Narrow an unknown request body field to the shape the library expects. */
export function checkBody<T>(value: unknown): T | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as T;
}