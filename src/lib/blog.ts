import { createAdminClient } from "./supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RarityTier } from "./rarity";

export interface AutoPostBadgeInfo {
  slug: string;
  title: string;
  setId: string;
  imageUrl2x: string | null;
  category: string;
  isPaid: boolean;
  howToEarn: string | null;
  startDate: string | null;
  endDate: string | null;
  rarityTier: RarityTier;
  rarityScore: number;
}

/**
 * Auto-publish a short "new badge drop" blog post when the catalog sync
 * detects a badge for the first time. Marked is_auto so editors can tell
 * machine posts from editorial ones.
 */
export async function createDropPost(
  badge: AutoPostBadgeInfo,
  client?: SupabaseClient,
): Promise<void> {
  try {
    const supabase = client ?? createAdminClient();
    const { error } = await supabase.from("blog_posts").upsert(
      {
        slug: `drop-${badge.slug}`,
        title: `New badge drop: ${badge.title}`,
        excerpt: `${badge.title} (${badge.setId}) is now live on Twitch.`,
        content: [
          `A new global Twitch badge just went live: **${badge.title}** (\`${badge.setId}\`).`,
          "",
          badge.howToEarn ? `**How to earn it:** ${badge.howToEarn}` : "",
          badge.startDate
            ? `**Available from:** ${new Date(badge.startDate).toUTCString()}`
            : "",
          badge.endDate
            ? `**Available until:** ${new Date(badge.endDate).toUTCString()}`
            : "",
          "",
          `**Cost:** ${badge.isPaid ? "Paid" : "Free"} · **Category:** ${badge.category} · **Rarity:** ${badge.rarityTier} (${badge.rarityScore}/100)`,
          "",
          `View the full details on the [badge page](/en/badges/${badge.slug}).`,
        ]
          .filter(Boolean)
          .join("\n"),
        cover_url: badge.imageUrl2x,
        status: "published",
        is_auto: true,
        tags: ["drop", badge.category],
      },
      { onConflict: "slug", ignoreDuplicates: true },
    );
    if (error) throw error;
  } catch (error) {
    console.warn("[blog] auto drop post failed:", error);
  }
}

export interface FeaturePostInput {
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  tags?: string[];
  cover?: string | null;
}

/**
 * Auto-publish a blog post for a shipped feature, game or special event
 * (turbo jackpot, …). Idempotent by slug.
 */
export async function createFeaturePost(post: FeaturePostInput): Promise<void> {
  const supabase = createAdminClient();
  // `.select("id")` makes the upsert report whether it inserted: with
  // `ignoreDuplicates` a re-run writes nothing, but the changelog row below was
  // written unconditionally, so every call claimed a publication that had not
  // happened (the live table held 139 of these rows under 24 distinct titles).
  const { data: inserted, error } = await supabase
    .from("blog_posts")
    .upsert(
      {
        slug: post.slug,
        title: post.title,
        excerpt: post.excerpt,
        content: post.content,
        cover_url: post.cover ?? null,
        status: "published",
        is_auto: true,
        tags: ["feature", ...(post.tags ?? [])],
      },
      { onConflict: "slug", ignoreDuplicates: true },
    )
    .select("id");
  if (error) throw error;
  if (!inserted || inserted.length === 0) return;
  await supabase.from("changelog").insert({
    kind: "blog",
    title: `Blog post published: ${post.title}`,
    body: post.excerpt,
    payload: { slug: post.slug },
  }).then(() => undefined, () => undefined);
}
