import { createAdminClient } from "@/lib/supabase/admin";
import { audit, type AdminContext } from "@/lib/admin";
import { AdminNotFoundError, AdminValidationError } from "@/lib/admin-route";

/**
 * Content administration: blog posts, changelog entries and hand-made catalog
 * badges. The blog table is shared with the automatic drop posts, so the
 * `source`-like flag that keeps them apart is `is_auto` — an admin editing an
 * auto-generated post must not have it silently rewritten by the next sync, and
 * a sync must not overwrite an admin's post either (auto posts are inserted
 * with is_auto = true and only ever looked up by their own slug).
 */

/** Slugs are part of a public URL, so they are normalised, not trusted. */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80)
    .replace(/^-|-$/g, "");
}

// ---------------------------------------------------------------- blog posts

export interface BlogInput {
  slug?: string;
  title: string;
  excerpt?: string;
  content: string;
  coverUrl?: string;
  author?: string;
  status?: "draft" | "published";
  locale?: string;
  tags?: string[];
  publishedAt?: string;
}

export async function listBlogPosts(options: { limit?: number; offset?: number; query?: string } = {}) {
  const supabase = createAdminClient();
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  let builder = supabase
    .from("blog_posts")
    .select(
      "id, slug, title, excerpt, status, is_auto, locale, tags, author, cover_url, published_at, updated_at",
      { count: "exact" },
    )
    .order("published_at", { ascending: false })
    .range(Math.max(options.offset ?? 0, 0), Math.max(options.offset ?? 0, 0) + limit - 1);
  const q = options.query?.trim();
  if (q) {
    const safe = q.replace(/[,()%*]/g, "");
    builder = builder.or(`title.ilike.%${safe}%,slug.ilike.%${safe}%`);
  }
  const { data, count, error } = await builder;
  if (error) throw error;
  return { posts: data ?? [], total: count ?? 0 };
}

export async function getBlogPost(id: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("blog_posts")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertBlogPost(
  ctx: AdminContext,
  input: BlogInput,
  id?: string,
): Promise<string> {
  const supabase = createAdminClient();
  const payload: Record<string, unknown> = {
    title: input.title,
    content: input.content,
    updated_at: new Date().toISOString(),
  };
  if (input.excerpt !== undefined) payload.excerpt = input.excerpt;
  if (input.coverUrl !== undefined) payload.cover_url = input.coverUrl;
  if (input.author !== undefined) payload.author = input.author;
  if (input.status !== undefined) payload.status = input.status;
  if (input.locale !== undefined) payload.locale = input.locale;
  if (input.tags !== undefined) payload.tags = input.tags;
  if (input.publishedAt) payload.published_at = input.publishedAt;

  const slug = slugify(input.slug || input.title);
  if (!slug) throw new AdminValidationError("a post needs a slug or a title to derive one");
  payload.slug = slug;

  /** One slug, one post: /blog/[slug] resolves by slug alone. */
  const slugTaken = async (exceptId?: string) => {
    const { data, error } = await supabase
      .from("blog_posts")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (error) throw error;
    return !!data && String(data.id) !== exceptId;
  };

  if (id) {
    // Renaming a post onto another post's slug used to reach the database and come
    // back as a 500 from the unique violation; it is a value the operator can fix,
    // so it is reported as one.
    if (await slugTaken(id)) {
      throw new AdminValidationError(`slug "${slug}" is already taken`);
    }
    const { data: updated, error } = await supabase
      .from("blog_posts")
      .update(payload)
      .eq("id", id)
      .select("id");
    if (error) throw error;
    if (!updated || updated.length === 0) throw new AdminNotFoundError("post not found");
    await audit(ctx, "blog.update", id, { slug });
    return id;
  }

  // A duplicate slug must be a clear error, not a silent second row.
  if (await slugTaken()) throw new AdminValidationError(`slug "${slug}" is already taken`);

  const { data, error } = await supabase
    .from("blog_posts")
    .insert({ ...payload, is_auto: false })
    .select("id")
    .single();
  if (error) throw error;
  await audit(ctx, "blog.create", String(data.id), { slug });
  return String(data.id);
}

export async function deleteBlogPost(ctx: AdminContext, id: string): Promise<void> {
  const supabase = createAdminClient();
  // `.select()` is what makes "the row was not there" visible: PostgREST reports no
  // error for a DELETE that matched nothing, so the panel used to write a phantom
  // audit entry for work it had not done.
  const { data: deleted, error } = await supabase
    .from("blog_posts")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw error;
  if (!deleted || deleted.length === 0) throw new AdminNotFoundError("post not found");
  await audit(ctx, "blog.delete", id);
}

// ----------------------------------------------------------------- changelog

export const CHANGELOG_KINDS = [
  "badge_added",
  "badge_updated",
  "badge_removed",
  "data_sync",
  "feature",
  "bugfix",
  "blog",
  "push",
] as const;

export async function listChangelog(options: { limit?: number; offset?: number } = {}) {
  const supabase = createAdminClient();
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);
  const { data, error, count } = await supabase
    .from("changelog")
    .select("id, kind, title, body, payload, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return { entries: data ?? [], total: count ?? 0 };
}

export async function upsertChangelog(
  ctx: AdminContext,
  input: { kind: string; title: string; body?: string; payload?: unknown },
  id?: number,
): Promise<number> {
  if (!CHANGELOG_KINDS.includes(input.kind as (typeof CHANGELOG_KINDS)[number])) {
    throw new AdminValidationError("unknown changelog kind");
  }
  const supabase = createAdminClient();
  const row: Record<string, unknown> = {
    kind: input.kind,
    title: input.title,
    body: input.body ?? null,
  };
  // Only write the payload when one was supplied. The panel does not show that
  // field for an existing entry, so sending `null` unconditionally erased the
  // stored payload on every edit — silent data loss on a page the operator
  // believes they are only renaming.
  if (input.payload !== undefined) {
    row.payload = (input.payload ?? null) as Record<string, unknown> | null;
  }
  if (id) {
    const { data: updated, error } = await supabase
      .from("changelog")
      .update(row)
      .eq("id", id)
      .select("id");
    if (error) throw error;
    if (!updated || updated.length === 0) throw new AdminNotFoundError("entry not found");
    await audit(ctx, "changelog.update", String(id), { kind: input.kind });
    return id;
  }
  const { data, error } = await supabase
    .from("changelog")
    .insert(row)
    .select("id")
    .single();
  if (error) throw error;
  await audit(ctx, "changelog.create", String(data.id), { kind: input.kind });
  return Number(data.id);
}

export async function deleteChangelog(ctx: AdminContext, id: number): Promise<void> {
  const supabase = createAdminClient();
  const { data: deleted, error } = await supabase
    .from("changelog")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw error;
  if (!deleted || deleted.length === 0) throw new AdminNotFoundError("entry not found");
  await audit(ctx, "changelog.delete", String(id));
}

// ------------------------------------------------------------- custom badges

/** Role badges are a permanent account state the global sync deletes on sight,
 *  so a hand-made entry must never be filed under it. */
export const CUSTOM_BADGE_CATEGORIES = [
  "events",
  "subscriptions",
  "bits",
  "achievements",
  "predictions",
  "other",
] as const;

export interface BadgeInput {
  setId: string;
  version: string;
  title: string;
  description?: string;
  howToEarn?: string;
  category?: string;
  imageUrl1x?: string;
  imageUrl2x?: string;
  imageUrl4x?: string;
  clickUrl?: string;
  isPaid?: boolean;
  startDate?: string | null;
  endDate?: string | null;
  status?: string;
}

export async function listBadges(options: { query?: string; source?: string; limit?: number; offset?: number } = {}) {
  const supabase = createAdminClient();
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);
  let builder = supabase
    .from("badges")
    .select(
      "id, set_id, version, slug, title, category, status, source, owner_count, start_date, end_date, created_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (options.source) builder = builder.eq("source", options.source);
  const q = options.query?.trim();
  if (q) {
    const safe = q.replace(/[,()%*]/g, "");
    builder = builder.or(`title.ilike.%${safe}%,set_id.ilike.%${safe}%,slug.ilike.%${safe}%`);
  }
  const { data, count, error } = await builder;
  if (error) throw error;
  return { badges: data ?? [], total: count ?? 0 };
}

export async function getBadge(id: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("badges").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertBadge(ctx: AdminContext, input: BadgeInput, id?: string): Promise<string> {
  const supabase = createAdminClient();
  const setId = input.setId.trim();
  const version = String(input.version).trim();
  const title = input.title.trim();
  if (!setId || !version || !title) {
    throw new AdminValidationError("set id, version and title are required");
  }
  const category = input.category ?? "events";
  if (category === "status") {
    throw new AdminValidationError(
      "category \"status\" is reserved: the global sync deletes role badges on every run",
    );
  }

  // The slug drives the public badge URL, so an input made only of punctuation
  // must not silently produce an empty one.
  const slug = slugify(`${setId}-${version}`);
  if (!slug) {
    throw new AdminValidationError("set id and version must contain letters or digits to form a slug");
  }

  const payload: Record<string, unknown> = {
    set_id: setId,
    version,
    title,
    category,
    slug,
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const optional: Array<[keyof BadgeInput, string]> = [
    ["description", "description"],
    ["howToEarn", "how_to_earn"],
    ["imageUrl1x", "image_url_1x"],
    ["imageUrl2x", "image_url_2x"],
    ["imageUrl4x", "image_url_4x"],
    ["clickUrl", "click_url"],
    ["status", "status"],
    ["startDate", "start_date"],
    ["endDate", "end_date"],
  ];
  for (const [from, to] of optional) {
    const value = input[from];
    if (value !== undefined) payload[to] = value;
  }
  if (input.isPaid !== undefined) payload.is_paid = input.isPaid;

  if (id) {
    // `source` must NOT be written here, and the earlier code only claimed that:
    // the value sat in this shared payload, so editing any badge relabelled it
    // "custom". That is not cosmetic — the catalogue sync treats source='custom'
    // as admin-owned, so it stopped refreshing the row *and* stopped sweeping it
    // when the badge disappeared, and the delete guard then allowed deleting a
    // provider badge. The insert branch below still stamps new rows.
    const { source: _ignoredSource, ...updatePayload } = payload;
    void _ignoredSource;
    const { data: updated, error } = await supabase
      .from("badges")
      .update(updatePayload)
      .eq("id", id)
      .select("id");
    if (error) throw error;
    if (!updated || updated.length === 0) throw new AdminNotFoundError("badge not found");
    await audit(ctx, "badge.update", id, { setId, version });
    return id;
  }

  const { data: clash, error: clashError } = await supabase
    .from("badges")
    .select("id, source")
    .eq("set_id", setId)
    .eq("version", version)
    .maybeSingle();
  // The lookup error used to be discarded, so a failed read looked like "no
  // clash" and the insert then hit the unique constraint as a 500.
  if (clashError) throw clashError;
  if (clash) {
    throw new AdminValidationError(
      `a ${clash.source} badge already exists for ${setId} v${version}`,
    );
  }

  payload.source = "custom";
  payload.first_seen_at = new Date().toISOString();
  const { data, error } = await supabase
    .from("badges")
    .insert(payload)
    .select("id")
    .single();
  if (error) throw error;
  await audit(ctx, "badge.create", String(data.id), { setId, version });
  return String(data.id);
}

export async function deleteBadge(ctx: AdminContext, id: string): Promise<void> {
  const supabase = createAdminClient();
  const { data: row, error: readError } = await supabase
    .from("badges")
    .select("source, set_id, version")
    .eq("id", id)
    .maybeSingle();
  // The read error used to be dropped, and because the guard below is written as
  // `if (row && …)` a failed read left `row` null — which read as "not a provider
  // badge" and let the delete through. Now a failed read stops the delete.
  if (readError) throw readError;
  if (!row) throw new AdminNotFoundError("badge not found");
  // Deleting a provider row would be undone by the next sync and would also
  // remove a badge every collector owns; only hand-made entries can be deleted.
  if (row.source !== "custom") {
    throw new AdminValidationError(
      "only custom badges can be deleted — provider badges return on the next sync",
    );
  }
  const { data: deleted, error } = await supabase
    .from("badges")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw error;
  if (!deleted || deleted.length === 0) throw new AdminNotFoundError("badge not found");
  await audit(ctx, "badge.delete", id, { setId: row.set_id, version: row.version });
}