# Newsletter, idea board and audit log

Audited: `src/lib/admin-newsletter.ts`, `src/lib/admin-brainstorm.ts`,
`src/app/api/admin/newsletter/route.ts`, `src/app/api/admin/ideas/route.ts`,
`src/components/admin/NewsletterPanel.tsx`, `src/components/admin/BrainstormPanel.tsx`,
`src/components/admin/AuditPanel.tsx`, `src/lib/push.ts`; supporting reads of
`src/lib/admin-route.ts`, `src/lib/admin.ts`, `supabase/migrations/0025_acp_foundation.sql`,
`supabase/migrations/0028_extend_idea_categories.sql`, all 11 `messages/*.json`.

Method:
- Read every file above end to end.
- Ran a read-only `SELECT` against the live DB (via `SUPABASE_DB_URL`) for the
  `brainstorm_ideas` check constraints and auth-user counts. Results:
  live `brainstorm_ideas_category_check` accepts 13 categories
  (`profile, game, addon, badge, design, content, stats, performance, usability, xp, coin, admin, other`);
  `auth.users` has 1 row; `admin_audit` has 0 rows.
- Programmatically verified every `admin.newsletter.*`, `admin.ideas.*`,
  `admin.audit.*` key exists in all 11 locale files and that the `{channel}`/
  `{sent}`/`{failed}`/`{count}` placeholders are consistent. No i18n defect found.
- Did not run `tsc`/`eslint` (logic defects below are not type-checkable) and did
  not exercise the panels in a browser.

Checked and found clean (so "nothing" is meaningful): no recipient address ever
reaches the browser (both `countRecipients` and `sendEmail` read addresses
server-side; only counts and `SendResult` are returned); the audit filter's
`.replace(/[,()%*]/g,"")` defuses the PostgREST separators and supabase-js
URL-encodes the value, so no filter-expression injection; the recipient
pagination loops terminate correctly (they do not loop forever); the newsletter
and idea i18n keys/placeholders are complete.

---

## B1 — Server category allowlist is out of sync with the schema and the UI; six categories cannot be saved

- **Severity**: high
- **Confidence**: high (verified against the live DB constraint and the panel)
- **Where**: `src/lib/admin-brainstorm.ts:10` (allowlist) and `:56` (validation);
  UI list at `src/components/admin/BrainstormPanel.tsx:20`; schema at
  `supabase/migrations/0028_extend_idea_categories.sql:19`
- **Code**:
  ```ts
  // admin-brainstorm.ts
  export const IDEA_CATEGORIES = [
    "profile","game","badge","design","content","stats","other",
  ] as const;                                    // 7 entries
  ...
  if (!IDEA_CATEGORIES.includes(input.category as IdeaCategory)) {
    throw new Error("unknown category");
  }
  ```
  ```ts
  // BrainstormPanel.tsx
  const CATEGORIES = [
    "profile","game","addon","badge","design","content",
    "stats","performance","usability","xp","coin","admin","other",
  ] as const;                                    // 13 entries
  ```
- **Why it is wrong**: Migration 0028 extended the DB check constraint to 13
  categories (confirmed live), and the panel offers all 13 in both its filter
  and its inline editor. But `saveIdea` validates against a hard-coded list of
  7, so `saveIdea` throws `"unknown category"` (mapped to HTTP 400) for
  `addon`, `performance`, `usability`, `xp`, `coin` and `admin`. Creating an
  idea in any of those buckets fails, and — because the validation runs on the
  update branch too — an existing idea in one of those categories cannot be
  edited at all: opening it, changing the title and pressing Save reports
  "unknown category". The panel is told to display, store and edit values the
  API refuses.
- **How to reproduce**: by inspection (confirmed against live constraint).
  1. Open the idea board, New, set category `xp`, title "x", Save → request
     `POST /api/admin/ideas {action:"save", input:{category:"xp",...}}` →
     400 `{"error":"unknown category"}`.
  2. Pick an existing idea whose category is `xp` and press Save → same 400.
- **Suspected cause**: the DB constraint and the panel were both extended in
  round 0028; the TypeScript allowlist in `admin-brainstorm.ts` was not.

---

## B2 — Vote counter is a non-atomic read-modify-write; concurrent votes are lost

- **Severity**: high
- **Confidence**: high (by reading; the code contradicts its own comment)
- **Where**: `src/lib/admin-brainstorm.ts:88` (function) and `:97–101` (the write)
- **Code**:
  ```ts
  /** Votes are stored as a counter, so the update is a relative one — an absolute
   *  write would discard votes cast between the read and the write. */
  export async function voteIdea(ctx, id, delta) {
    ...
    const { data: current } = await supabase.from("brainstorm_ideas")
      .select("votes").eq("id", id).maybeSingle();
    const next = Math.max(0, Number(current.votes ?? 0) + (delta >= 0 ? 1 : -1));
    const { error: updateError } = await supabase.from("brainstorm_ideas")
      .update({ votes: next }).eq("id", id);   // ABSOLUTE write
  ```
- **Why it is wrong**: The comment promises a relative update (`votes = votes ± 1`)
  but the implementation writes an absolute value computed from a prior read.
  Two votes that overlap both read `5`, both compute `6`, both write `6` — one
  vote is silently lost. The same overlap on a downvote can un-floor: at
  `votes = 1` two simultaneous downvotes both read `1`, both write `0` (the
  intended result), but at `votes = 2` two downvotes both read `2` and both
  write `1`, losing one decrement. The floor check `Math.max(0, …)` runs on the
  stale value, so it is part of the same raced computation.
- **How to reproduce**: by inspection. Amplified by the UI: the up/down buttons
  in `BrainstormPanel.tsx:103–119` have no `disabled`/busy guard (unlike
  `NewsletterPanel`), so a double-click or two open tabs fire two simultaneous
  `POST /api/admin/ideas {action:"vote"}` calls that race.
- **Suspected cause**: read-then-write instead of an atomic
  `update({ votes: current ± 1 })`/SQL expression or an RPC.

---

## B3 — A draft is marked "sent" even when every (or some) delivery failed, and can never be retried

- **Severity**: high
- **Confidence**: high (by reading)
- **Where**: `src/lib/admin-newsletter.ts:158–169` (marking) with `:214–218`
  (per-batch `failed`) and `:138–148` (push path)
- **Code**:
  ```ts
  if (result.channel !== "none") {
    const recipients = await countRecipients().catch(() => null);
    const { error: updateError } = await supabase
      .from("newsletter_drafts")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        recipient_count: recipients?.emails ?? result.sent,
      })
      .eq("id", id);
    if (updateError) throw updateError;
  }
  ```
  ```ts
  // sendEmail: a failed batch only increments `failed`
  if (response.ok) sent += batch.length; else failed += batch.length;
  ...
  catch { failed += batch.length; }
  ```
- **Why it is wrong**: The doc comment two lines above says "The draft is never
  marked sent unless something actually went out." The code marks it sent for
  any non-`none` channel regardless of `result.sent`/`result.failed`. If every
  Resend batch fails (`sent = 0`, `failed = N`), the draft is still stamped
  `status='sent'`, `sent_at=now`. Because `sendDraft` then refuses re-sends
  (`:127 "this draft was already sent"`), the operator has no way to retry: the
  recipients of the failed batches never receive the mail and the UI shows the
  draft as sent. A partial failure is worse — it silently drops whole batches of
  50 while reporting success.
- **How to reproduce**: by inspection. Configure `RESEND_API_KEY` to a rejected
  key, save a draft with channel `email`, Send → response channel `email`,
  `sent:0`, `failed:N`; the drafts table flips to `sent` and a second Send
  returns 400 "already sent".
- **Suspected cause**: the sent-update is gated only on `channel !== "none"`,
  not on `sent > 0`/`failed === 0`.

---

## B4 — Newsletter recipients are placed in the `to:` field, disclosing every address to the other 49 in the batch

- **Severity**: medium
- **Confidence**: medium (Resend `to` semantics by API contract; not executed)
- **Where**: `src/lib/admin-newsletter.ts:198–214`
- **Code**:
  ```ts
  for (let i = 0; i < addresses.length; i += 50) {
    const batch = addresses.slice(i, i + 50);
    const response = await fetch("https://api.resend.com/emails", {
      ...
      body: JSON.stringify({ from, to: batch, subject, text: body }),
    });
  ```
- **Why it is wrong**: An array passed as Resend's `to` becomes the message's
  `To:` header, so all 50 recipients of each batch see each other's email
  addresses. For a broadcast to every registered user this is a bulk address
  disclosure (and, under GDPR-style rules, a personal-data leak to third
  parties). A newsletter must address each recipient individually or use BCC/a
  per-recipient send; the module comment's promise that addresses are handled
  carefully (`:14–16`) is about reading them, not about how they are sent.
- **How to reproduce**: by inspection. A live send with a real `RESEND_API_KEY`
  to two different addresses shows both in the delivered message's To header.
- **Suspected cause**: the batch array is used directly as `to` rather than
  iterating single recipients (or using `bcc`).

---

## B5 — Push is delivered before the draft is marked sent, so a notification-write failure leaves it re-sendable (duplicate broadcast)

- **Severity**: medium
- **Confidence**: high (by reading)
- **Where**: `src/lib/admin-newsletter.ts:138–140` and `src/lib/push.ts:79–91`
- **Code**:
  ```ts
  } else if (wantsPush && pushConfigured()) {
    const push = await sendPushToAll({ title: subject, body, url: "/" });   // sends here
    await recordNotification({ kind: "newsletter", title: subject, body, url: "/" });
    result = { channel: "push", sent: push.sent ?? 0, ... };
  }
  ```
  `recordNotification` (`push.ts:83–90`) inserts into `notifications` and
  `if (error) throw error;`.
- **Why it is wrong**: The push broadcast is performed first; if the following
  `recordNotification` insert fails (or anything throws between the send and the
  `status:'sent'` update at `:158`), `sendDraft` rejects, so the draft's status
  is never updated. The pushes are already on their way, yet the draft still
  reads `draft`; the operator presses Send again and every subscriber receives
  the broadcast a second time. This is a send that runs twice, caused by
  side-effect ordering rather than a double-click.
- **How to reproduce**: by inspection. Force `notifications` insert to error
  (e.g. RLS/grant or a transient DB failure): `sendPushToAll` reports `sent > 0`,
  then the request 500s and the draft remains `draft`.
- **Suspected cause**: irreversible delivery precedes the state transition, with
  no idempotency record written before dispatch.

Related (same window): the only "already sent" guard is a read-then-write
(`:120–127` then `:160–167`). Two concurrent `POST {action:"send"}` requests
both read `status='draft'` and both dispatch before either writes `sent` — a
plain TOCTOU double-send independent of any client bug.

---

## B6 — Save/delete on a row that no longer exists reports success and writes a phantom audit entry

- **Severity**: medium
- **Confidence**: high (by reading; no `.select()` follows the writes)
- **Where**: `src/lib/admin-newsletter.ts:84–88` and `:100–105`;
  `src/lib/admin-brainstorm.ts:70–74` and `:107–112`
- **Code**:
  ```ts
  if (id) {
    const { error } = await supabase.from("newsletter_drafts").update(row).eq("id", id);
    if (error) throw error;
    await audit(ctx, "newsletter.update", String(id), { subject });
    return id;                       // claims success even if 0 rows matched
  }
  ...
  const { error } = await supabase.from("newsletter_drafts").delete().eq("id", id);
  if (error) throw error;
  await audit(ctx, "newsletter.delete", String(id));   // audits a delete of nothing
  ```
  (identical shape for `saveIdea`/`deleteIdea`.)
- **Why it is wrong**: PostgREST returns `error: null` for an `UPDATE`/`DELETE`
  that matched zero rows, and neither call chains `.select()` to read the
  affected rows. So editing or deleting an id that another admin already removed
  returns `{ok:true}` (and, for ideas, the panel shows the "saved"/"deleted"
  notice), while the row is untouched — and the audit trail gains a
  `newsletter.update` / `idea.delete` entry describing a mutation that never
  happened. The operator's only record of admin activity is now wrong.
- **How to reproduce**: by inspection. Delete draft `7` in one tab, then Save
  the still-open editor for `7` in another tab → 200 `{ok:true, id:7}` and a new
  `newsletter.update` audit row, with no draft `7`.
- **Suspected cause**: writes are not checked for a row count (`.select()`) and
  the audit is written unconditionally after a no-op.

---

## B7 — `Number(body.id)` can be `NaN`, and `if (id)` treats `NaN`/`0` as "no id", silently inserting a duplicate

- **Severity**: medium
- **Confidence**: high (by reading)
- **Where**: `src/app/api/admin/newsletter/route.ts:28,37` and
  `src/app/api/admin/ideas/route.ts:34,41`; consumers
  `src/lib/admin-newsletter.ts:84` and `src/lib/admin-brainstorm.ts:70`
- **Code**:
  ```ts
  // route
  const id = body?.id === undefined || body?.id === null ? undefined : Number(body.id);
  ...
  return { ok: true, id: await saveDraft(ctx, { ... }, id) };
  ```
  ```ts
  // saveDraft / saveIdea
  if (id) { /* UPDATE */ }
  // else INSERT
  ```
- **Why it is wrong**: `Number(body.id)` is unchecked, so `{"id":"abc"}` (or
  `{}`, `[1]`-ish coercion) yields `NaN`. `NaN !== undefined`, so the action
  proceeds; then `if (id)` is falsy for `NaN` (and for `0`), so the update branch
  is skipped and a brand-new row is inserted instead. A "save" that the caller
  intended as an edit silently creates a duplicate draft/idea. `send`/`vote`/
  `delete` pass the same `NaN` into `.eq("id", NaN)`, producing a PostgREST
  range error surfaced as a generic 500. No `Number.isFinite` guard exists on any
  of these boundaries.
- **How to reproduce**: by inspection. `POST /api/admin/ideas {"action":"save","id":"abc","input":{"category":"game","title":"x"}}`
  → new idea created, editor closes as if the edit saved. Compare with
  `{"action":"send","id":"abc"}` → 500.
- **Suspected cause**: id parsing without a finite check, plus a truthiness test
  rather than `id !== undefined`.

---

## B8 — Unvalidated `Number()` on `limit`/`offset` lets a non-numeric query param produce an invalid range

- **Severity**: low
- **Confidence**: medium (by reading; not executed against PostgREST)
- **Where**: `src/app/api/admin/ideas/route.ts:19–20` and `:26`
- **Code**:
  ```ts
  limit: Number(url.searchParams.get("limit") ?? 50),
  offset: Number(url.searchParams.get("offset") ?? 0),
  ...
  limit: Number(url.searchParams.get("limit") ?? 100),
  ```
- **Why it is wrong**: `Number("abc")` is `NaN`, and `NaN` is not caught by the
  `?? default` (only `null`/`undefined` are). It flows into
  `listAudit`'s `Math.min(Math.max(NaN,1),200)` → `NaN`, then `.range(offset, NaN)`
  (and `listIdeas`' `.limit(NaN)`), producing a malformed PostgREST range that
  fails the request. The client never sends this, but the endpoint is reachable
  by any authenticated admin and returns a 500 where a clamp or a 400 is
  expected.
- **How to reproduce**: by inspection. `GET /api/admin/ideas?resource=audit&limit=abc`.
- **Suspected cause**: `Number()` without a finite check before clamping.

---

## B9 — Rejected actions return HTTP 200 with an `error` body, so the panels report them as success

- **Severity**: low
- **Confidence**: high (by reading)
- **Where**: `src/app/api/admin/newsletter/route.ts:35,46`;
  `src/app/api/admin/ideas/route.ts:40,51`
- **Code**:
  ```ts
  if (!["push", "email", "both"].includes(channel)) {
    return { error: "unknown channel" };          // 200 OK
  }
  ...
  return { error: "unknown newsletter action" };  // 200 OK
  ```
  and in the panel (`NewsletterPanel.tsx:71–76`, `BrainstormPanel.tsx:61–68`):
  ```ts
  const data = await res.json();
  if (!res.ok) { setError(data.error ?? t("failed")); return false; }
  setNotice(t(successKey));        // reached: res.ok is true
  ```
- **Why it is wrong**: `adminAction` wraps whatever the handler returns in
  `Response.json(result)` with the default 200 status. These early-return
  "failure" objects therefore arrive as a successful response; the panels key on
  `res.ok`, so a rejected action displays the success notice and refreshes the
  list. The body's `error` field is never read. The same objects are returned for
  an unknown action, so a no-op request looks like it succeeded.
- **How to reproduce**: by inspection. `POST /api/admin/newsletter {"action":"bogus"}`
  → 200 `{"error":"unknown newsletter action"}`.
- **Suspected cause**: the routes return error objects instead of throwing (or
  setting a status) so `adminAction` cannot map them to 4xx.

---

## B10 — A push newsletter records the email audience as its recipient count

- **Severity**: low
- **Confidence**: high (by reading)
- **Where**: `src/lib/admin-newsletter.ts:159,165`
- **Code**:
  ```ts
  const recipients = await countRecipients().catch(() => null);
  ...
  recipient_count: recipients?.emails ?? result.sent,
  ```
- **Why it is wrong**: `countRecipients().emails` is the number of `auth.users`
  with an address, not the number of push subscribers. A `push`-channel draft
  therefore displays the email audience size in the "Recipients" column of the
  drafts table (`NewsletterPanel.tsx:149`) — a number unrelated to the channel it
  was sent on and to what actually went out (`result.sent` for push). The column
  is misleading precisely where the operator reads it to judge reach.
- **How to reproduce**: by inspection. Send a push draft; the stored
  `recipient_count` equals the auth-user email count while the returned
  `SendResult.sent` is the push-subscription count.
- **Suspected cause**: the post-send count uses the email audience regardless of
  the delivery channel.

---

## B11 — Recipient enumeration is hard-capped at 20,000 users, silently

- **Severity**: low
- **Confidence**: high on the code; the cap is not reached today (live DB has 1
  auth user)
- **Where**: `src/lib/admin-newsletter.ts:52` and `:184` (identical loops)
- **Code**:
  ```ts
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    ...
    if (users.length < 1000) break;
  }
  ```
- **Why it is wrong**: The comment at `:42–44` says pagination exists so "a
  silent cap would understate the audience", yet the `page <= 20` bound is
  exactly such a cap: once there are more than 20,000 users the loop stops early
  and both `countRecipients` and `sendEmail` silently ignore every user past
  20,000. `sendEmail`'s note ("emailed X of Y addresses") then reports the capped
  list length as `Y`, so the operator believes the full audience was addressed.
  The loops do terminate correctly (no infinite loop).
- **How to reproduce**: by inspection. With >20,000 users, the audience card
  understates emails and one segment is never mailed.
- **Suspected cause**: a fixed 20-page bound instead of paginating until a short
  page.

---

## B12 — "not found" errors become 500 `internal` instead of a clear 4xx

- **Severity**: low
- **Confidence**: high (by reading)
- **Where**: `src/lib/admin-route.ts:33–40`, from throws at
  `src/lib/admin-newsletter.ts:126` and `src/lib/admin-brainstorm.ts:96`
- **Code**:
  ```ts
  if (error.message && /required|already|cannot|only |reserved|unknown|missing|invalid|needs/i.test(error.message)) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  console.error("[admin-route]", error);
  return Response.json({ error: "internal" }, { status: 500 });
  ```
- **Why it is wrong**: The allow-list regex covers "already sent", "unknown
  category" etc., but not "not found". `sendDraft`/`voteIdea` on a missing row
  therefore produce a 500 `{"error":"internal"}`; the panel shows the generic
  "failed" string and the operator has no idea the row was removed. (The intended
  status for a missing target is 404/400.)
- **How to reproduce**: by inspection. `POST /api/admin/ideas {"action":"vote","id":999999}`
  → 500 `{"error":"internal"}`.
- **Suspected cause**: an incomplete message allow-list in the shared route
  helper.

---

## B13 — BrainstormPanel's POST has no error trap and no busy guard

- **Severity**: low
- **Confidence**: high (by reading)
- **Where**: `src/components/admin/BrainstormPanel.tsx:53–69` and `:103–150`
- **Code**:
  ```ts
  async function post(payload, successKey?) {
    setError(null); setNotice(null);
    const res = await fetch("/api/admin/ideas", { method: "POST", ... }); // no try/catch
    ...
  }
  ...
  onClick={() => void post({ action: "vote", id: idea.id, up: true })}  // no disabled={busy}
  ```
- **Why it is wrong**: Unlike `NewsletterPanel.post` (which wraps the fetch in
  `try/catch`), this one has no catch: a network failure (offline, aborted
  request) makes the handler reject, surfacing nothing to the operator and
  leaving an unhandled rejection — the panel looks like the click did nothing.
  Separately, none of the mutation buttons disable while a request is in flight,
  so repeated clicks fire overlapping requests (which is what makes B2 bite).
- **How to reproduce**: by inspection (offline devtools, click Save).
- **Suspected cause**: the newsletter panel's error/busy pattern was not carried
  over to the brainstorm panel.

---

## B14 — A send that delivered nothing is still written to the audit log as a send

- **Severity**: low
- **Confidence**: high (by reading)
- **Where**: `src/lib/admin-newsletter.ts:171–176`
- **Code**:
  ```ts
  await audit(ctx, "newsletter.send", String(id), {
    subject, channel: result.channel, sent: result.sent, failed: result.failed,
  });
  ```
- **Why it is wrong**: The audit call is outside the `result.channel !== "none"`
  block, so a draft that delivered nothing (`channel:"none"`, `sent:0`) still
  records `newsletter.send`. The audit trail — the operator's record of what was
  actually done — says a newsletter was sent when none left the building.
- **How to reproduce**: by inspection. With no `RESEND_API_KEY` and no push
  subscribers, Send → `admin_audit` gains a `newsletter.send` row with
  `channel:"none"`.
- **Suspected cause**: the audit is emitted unconditionally rather than only on
  a delivery.
