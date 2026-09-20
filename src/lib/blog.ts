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
