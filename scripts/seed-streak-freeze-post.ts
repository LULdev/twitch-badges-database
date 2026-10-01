/**
 * Publishes the Streak Freeze feature announcement — the first inventory item
 * in the Badge Arcade. Idempotent by slug (createFeaturePost ignores dupes).
 *
 * Run: ALLOW_ONE_OFF_MIGRATION=1 npx tsx scripts/seed-streak-freeze-post.ts
 *
 * The post writes its own changelog row via createFeaturePost and appears in
 * the blog index, RSS and homepage. Push is NOT sent — that is outward-facing
 * and stays a manual decision: npm run send:push -- "Title" "Body" "/en/blog/streak-freeze-explained"
 */
import { config } from "dotenv";

config({ path: ".env.local" });

// One-off seed: refuse accidental re-runs (the house guard, cf. seed-xp-research).
if (process.env.ALLOW_ONE_OFF_MIGRATION !== "1") {
  console.error(
    "Refusing to run: one-off seed. Set ALLOW_ONE_OFF_MIGRATION=1 to override.",
  );
  process.exit(1);
}

const content = `The Badge Arcade has its first inventory item. Streak Freezes are live — a way to protect a game streak through a single missed day instead of watching weeks of progress vanish because real life happened.

## What a Streak Freeze does

Your game streak counts consecutive days with at least one settled arcade round. Miss a day and the streak normally resets to zero. With a freeze in stock, it does not: the streak **pauses** — it neither grows nor shrinks, and exactly one freeze burns per bridged day. The next day you play, the streak simply continues from where it paused.

## You start with two

Every member begins with **two freezes**. They are granted exactly once per account and delivered automatically on your first arcade visit or settled round — there is nothing to claim and no button to press. You can check your stock any time on your profile.

## How to earn more

You earn an additional freeze every time your **best** game streak crosses a multiple of seven — 7, 14, 21, 28 days, and so on. The best streak is a high-water mark: it survives lost days and only ever moves up, so a freeze earned this way is permanent progress, not a one-off trick. The reward lands automatically in the same moment the streak advances.

## The bonus you are already earning

Streaks also pay XP. From the second consecutive day you get **+5 XP per streak day, capped at +50**, awarded once per day on your first settled round — and it sits outside the 100 XP daily game cap, so a capped-out player still collects it in full. The round verdict tells you when the bonus and any freeze were applied.

## Where to see your stock

Your profile shows an item shelf with your remaining freezes and a short explanation. In-game, five tables surface the save directly in the round verdict — Drops Catcher, Shoot the Badges, Badge Memory, Badge Quiz and Crack the Vault — with the message "A Streak Freeze protected your streak!" The [FAQ](/en/faq) answers the details, and the [leaderboard](/en/leaderboards) ranks the ten longest best streaks on the site.

## Two streaks, one account

The daily-claim login streak and the game-activity streak are deliberately separate: logging in without playing keeps your claim streak alive, while only settled rounds extend the game streak. Both feed their own achievements — [Warm-Up Streak at 7 days, Grindstone at 30, and Centurion of Days at 100](/en/achievements) reward the game streak specifically.

Freezes never stack per day — however many you hold, a single bridged day consumes exactly one. That keeps the item a safety net, not a pause button. Play smart, and the streak takes care of itself.

Ready to build a streak worth protecting? [Pick a game on the arcade](/en/games).`;

async function main(): Promise<void> {
  const words = content.trim().split(/\s+/).length;
  if (words < 300) {
    console.error(`Refusing to publish: ${words} words (house floor 300).`);
    process.exit(1);
  }

  const { createFeaturePost } = await import("../src/lib/blog");
  const published = await createFeaturePost({
    slug: "streak-freeze-explained",
    title: "Streak Freezes Arrive: Protect Your Arcade Streak",
    excerpt:
      "The Badge Arcade's first inventory item: start with two Streak Freezes, earn more every 7 best-streak days, and never lose weeks of progress to a single missed day again.",
    content,
    cover: "/items/streak_freeze.svg",
    tags: ["inventory", "streak", "announcement"],
  });

  console.log(
    published
      ? `published streak-freeze-explained (${words} words)`
      : "slug already exists — nothing written (idempotent)",
  );
  process.exit(words >= 300 && published ? 0 : 1);
}

main().catch((error) => {
  console.error("failed:", error);
  process.exit(1);
});
