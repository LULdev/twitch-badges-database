import { adminAction } from "@/lib/admin-route";
import { roleRank } from "@/lib/admin";
import {
  countRecipients,
  deleteDraft,
  emailConfigured,
  listDrafts,
  saveDraft,
  sendDraft,
} from "@/lib/admin-newsletter";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/admin/newsletter — drafts plus how many recipients each channel has. */
export async function GET(request: Request) {
  return adminAction(async () => {
    const [drafts, audience] = await Promise.all([
      listDrafts(),
      // Only the COUNTS can fail. The provider flag is a separate, pure env read
      // reported alongside them, so a count outage can no longer be displayed as
      // "no provider configured" — which silently defaulted a new draft to push
      // and persisted that channel.
      countRecipients().catch(() => null),
    ]);
    return { drafts, audience, emailConfigured: emailConfigured() };
  }, request);
}

/** POST /api/admin/newsletter — { action: save|send|delete, ... } */
export async function POST(request: Request) {
  return adminAction(async (ctx, _url, body) => {
    const action = String(body?.action ?? "");
    // A non-numeric id used to become NaN, which is falsy — so a "save" the
    // operator meant as an edit took the insert branch and created a duplicate.
    const rawId = body?.id === undefined || body?.id === null ? undefined : Number(body.id);
    if (rawId !== undefined && !Number.isFinite(rawId)) {
      return { error: "id must be a number" };
    }
    const id = rawId;

    // Sending reaches every account in the database — mail to every address and a
    // push to every subscription. `requireAdmin()` admits moderators by design
    // (they moderate content), so the boundary is stated here rather than assumed.
    if (action === "send" && roleRank(ctx.role) < roleRank("admin")) {
      return { error: "forbidden: only an admin may send a newsletter" };
    }

    if (action === "save") {
      const subject = String(body?.subject ?? "");
      const draftBody = String(body?.body ?? "");
      const channel = (body?.channel ?? "push") as "push" | "email" | "both";
      if (!["push", "email", "both"].includes(channel)) {
        return { error: "unknown channel" };
      }
      return { ok: true, id: await saveDraft(ctx, { subject, body: draftBody, channel }, id) };
    }
    if (action === "send" && id !== undefined) {
      return { ok: true, result: await sendDraft(ctx, id) };
    }
    if (action === "delete" && id !== undefined) {
      await deleteDraft(ctx, id);
      return { ok: true };
    }
    return { error: "unknown newsletter action" };
  }, request);
}
