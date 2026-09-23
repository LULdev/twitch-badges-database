import { createAdminClient } from "@/lib/supabase/admin";
import { audit, type AdminContext } from "@/lib/admin";
import { AdminNotFoundError, AdminValidationError } from "@/lib/admin-route";
import { pushConfigured, recordNotification, sendPushToAll } from "@/lib/push";

/**
 * Newsletter: drafts, recipient counting and delivery.
 *
 * Delivery is honest about what is configured. With a RESEND_API_KEY the
 * message is emailed to every address in `auth.users`. Without one there is no
 * mail provider to send through, so the draft is delivered as a web push
 * broadcast to subscribed browsers and the result says so — it does not report
 * "sent" for mail that never left.
 *
 * The recipient list is read through the service role (it is the only way to
 * see `auth.users`), and only the addresses are read: never the passwords,
 * tokens or metadata that live in the same table.
 */

export interface NewsletterDraft {
  id: number;
  subject: string;
  body: string;
  status: "draft" | "sent";
  channel: "push" | "email" | "both";
  recipient_count: number;
  sent_at: string | null;
  created_at: string;
}

export async function listDrafts(limit = 20): Promise<NewsletterDraft[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("newsletter_drafts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));
  if (error) throw error;
  return (data ?? []) as NewsletterDraft[];
}

/**
 * Counts reachable recipients. Paginated because the auth admin API returns at
 * most 1000 users per page and a silent cap would understate the audience.
 */
export async function countRecipients(): Promise<{
  emails: number;
  pushSubscriptions: number;
  emailConfigured: boolean;
}> {
  const supabase = createAdminClient();
  let emails = 0;
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const users = data?.users ?? [];
    emails += users.filter((user) => !!user.email).length;
    if (users.length < 1000) break;
  }
  const { count } = await supabase
    .from("push_subscriptions")
    .select("id", { count: "exact", head: true });
  return {
    emails,
    pushSubscriptions: count ?? 0,
    // Reported to the operator before they press send, so the fallback is never
    // a surprise.
    emailConfigured: emailConfigured(),
  };
}

/**
 * Whether a mail provider is configured. A pure env read — it cannot fail, so the
 * panel never has to infer it from a recipient count that did, and an outage can
 * no longer be displayed as "no provider configured".
 */
export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

export async function saveDraft(
  ctx: AdminContext,
  input: { subject: string; body: string; channel?: "push" | "email" | "both" },
  id?: number,
): Promise<number> {
  const subject = input.subject.trim();
  if (!subject) throw new AdminValidationError("a newsletter needs a subject");
  const supabase = createAdminClient();
  const row = {
    subject,
    body: input.body ?? "",
    channel: input.channel ?? "push",
  };
  if (id) {
    const { data: updated, error } = await supabase
      .from("newsletter_drafts")
      .update(row)
      .eq("id", id)
      .select("id");
    if (error) throw error;
    if (!updated || updated.length === 0) throw new AdminNotFoundError("draft not found");
    await audit(ctx, "newsletter.update", String(id), { subject });
    return id;
  }
  const { data, error } = await supabase
    .from("newsletter_drafts")
    .insert(row)
    .select("id")
    .single();
  if (error) throw error;
  await audit(ctx, "newsletter.create", String(data.id), { subject });
  return Number(data.id);
}

export async function deleteDraft(ctx: AdminContext, id: number): Promise<void> {
  const supabase = createAdminClient();
  const { data: deleted, error } = await supabase
    .from("newsletter_drafts")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw error;
  if (!deleted || deleted.length === 0) throw new AdminNotFoundError("draft not found");
  await audit(ctx, "newsletter.delete", String(id));
}

export interface SendResult {
  channel: "email" | "push" | "none";
  sent: number;
  failed: number;
  note: string;
}

/**
 * Sends one draft and marks it sent. The draft is never marked sent unless
 * something actually went out.
 */
export async function sendDraft(ctx: AdminContext, id: number): Promise<SendResult> {
  const supabase = createAdminClient();
  const { data: draft, error } = await supabase
    .from("newsletter_drafts")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!draft) throw new AdminNotFoundError("draft not found");
  if (draft.status === "sent") throw new AdminValidationError("this draft was already sent");

  // Claim the draft BEFORE dispatching. The check above is a read, so two
  // concurrent sends both passed it and both dispatched — a duplicated broadcast.
  // This conditional update is the claim: exactly one caller can move the row out
  // of `draft`, and the loser sends nothing.
  const { data: claimed, error: claimError } = await supabase
    .from("newsletter_drafts")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "draft")
    .select("id");
  if (claimError) throw claimError;
  if (!claimed || claimed.length === 0) {
    throw new AdminValidationError("this draft is already being sent, or was already sent");
  }

  const subject = String(draft.subject);
  const body = String(draft.body ?? "");
  const wantsPush = draft.channel === "push" || draft.channel === "both";
  const wantsEmail = draft.channel === "email" || draft.channel === "both";

  let result: SendResult;

  try {
    if (wantsEmail && process.env.RESEND_API_KEY) {
      result = await sendEmail(subject, body);
    } else if (wantsPush && pushConfigured()) {
      // The in-app row is recorded BEFORE the fan-out: with the push first, a
      // failure in this insert released the claim, so the operator's retry
      // re-sent the identical push to everyone who had already received it — the
      // notification row is not the push, and neither channel has a dedup key.
      // A per-broadcast tag, because the service worker's default tag is one
      // constant: without it a second newsletter silently replaced the first in
      // every notification tray while `/notifications` still listed both.
      const tag = `newsletter-${id}`;
      await recordNotification({ kind: "newsletter", title: subject, body, url: "/", tag });
      const push = await sendPushToAll({ title: subject, body, url: "/", tag });
      // The note is built from the OUTCOME. It used to be a fixed string, so a
      // broadcast that failed for every subscriber (an over-4 KB body, an outage)
      // still read "sent as a web push to subscribed browsers" beside `sent: 0`.
      const base = wantsEmail
        ? "sent as a web push: no RESEND_API_KEY is configured, so no mail could be sent"
        : "sent as a web push to subscribed browsers";
      const pushed = push.sent ?? 0;
      result = {
        channel: "push",
        sent: pushed,
        failed: push.failed ?? 0,
        note:
          pushed > 0
            ? base
            : `nothing reached a browser: all ${push.failed ?? 0} push deliveries failed`,
      };
    } else {
      result = {
        channel: "none",
        sent: 0,
        failed: 0,
        note: "nothing was delivered: no mail provider is configured and no browser is subscribed to push",
      };
    }
  } catch (deliveryError) {
    // Release the claim. A throw anywhere in delivery (Resend, the push fan-out,
    // the notification insert) used to leave the draft marked `sent` with nothing
    // delivered, and the operator's retry was answered "this draft was already
    // sent" — with no audit row either, since that is written after this.
    await supabase
      .from("newsletter_drafts")
      .update({ status: "draft", sent_at: null })
      .eq("id", id);
    throw deliveryError;
  }

  // The draft was claimed as sent above; if nothing actually went out, hand it
  // back so it can be retried, rather than leaving a "sent" row that never was.
  // The old code marked it sent whenever the channel was not "none" — including a
  // total Resend outage, where every batch failed.
  const delivered = result.channel !== "none" && result.sent > 0;
  if (!delivered) {
    const { error: revertError } = await supabase
      .from("newsletter_drafts")
      .update({ status: "draft", sent_at: null })
      .eq("id", id);
    if (revertError) throw revertError;
  } else {
    const recipients = await countRecipients().catch(() => null);
    // The count stored must describe the channel that was used: a push send used to
    // record the e-mail audience, a number nothing in that send touched.
    const recipientCount =
      result.channel === "push" ? (recipients?.pushSubscriptions ?? result.sent) : result.sent;
    const { error: updateError } = await supabase
      .from("newsletter_drafts")
      .update({ recipient_count: recipientCount })
      .eq("id", id);
    if (updateError) throw updateError;
  }

  // Audited either way, but with the outcome — including "nothing was delivered",
  // which the previous entry recorded as if a send had happened.
  await audit(ctx, "newsletter.send", String(id), {
    subject,
    channel: result.channel,
    sent: result.sent,
    failed: result.failed,
    delivered,
  });
  return result;
}

/** Emails every address in auth.users through Resend, in batches. */
async function sendEmail(subject: string, body: string): Promise<SendResult> {
  const supabase = createAdminClient();
  const addresses: string[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const users = data?.users ?? [];
    for (const user of users) if (user.email) addresses.push(user.email);
    if (users.length < 1000) break;
  }

  const from = process.env.NEWSLETTER_FROM ?? "Twitch Badges DB <noreply@localhost>";
  // Resend needs a `to`, but the members must not see each other's addresses: the
  // batch goes in `bcc` and only the sender appears in `to`.
  const envelopeTo = (from.match(/<([^>]+)>/)?.[1] ?? from).trim();
  let sent = 0;
  let failed = 0;

  // Resend accepts up to 50 recipients per call; a single call with hundreds of
  // to-addresses is rejected outright, so chunking is required, not a nicety.
  for (let i = 0; i < addresses.length; i += 50) {
    const batch = addresses.slice(i, i + 50);
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [envelopeTo],
          bcc: batch,
          subject,
          text: body,
        }),
      });
      if (response.ok) sent += batch.length;
      else failed += batch.length;
    } catch {
      failed += batch.length;
    }
  }

  return {
    channel: "email",
    sent,
    failed,
    note: `emailed ${sent} of ${addresses.length} addresses`,
  };
}