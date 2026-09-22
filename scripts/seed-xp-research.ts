/**
 * Publishes the XP-system feature research post: 10 unique, 10 essential and
 * 10 unexpected XP-level features (researched + implemented). 300+ words.
 * Run: npx tsx scripts/seed-xp-research.ts
 */
import { config } from "dotenv";

config({ path: ".env.local" });

const content = `When we set out to build the level system, we researched thirty candidate features across three categories before writing a single line of code: ten genuinely unique ideas, ten non-negotiable essentials, and ten unexpected twists. This post documents that research and what shipped.

## Ten unique features (our differentiators)

1. **Hundred unique level badges** — each level renders its own sparkle-animated shield in one of nine escalating themes, permanently pinned to your profile.
2. **Badge claims as the top XP source** — unlocking a real Twitch badge pays 1,000 XP, tying progression directly to actual collecting.
3. **Streak-escalating daily bonus** — the +10 XP base grows by +5 per consecutive day up to +50, making consistency visible.
4. **Level-weighted heists** — your level shifts steal success odds by one point per level of difference.
5. **Anti-farm game cap** — games pay only 100 XP per day so the arcade stays entertainment, not a grind loop.
6. **Public level-up broadcasts** — every bracket crossing is an activity-feed event the whole community sees.
7. **Rarity-momentum economy** — wheel and game odds live beside a rarity index built from potat.app data.
8. **Coin rain** — visitors gift +1 coin to any profile once per day, a social drip that funds the feed.
9. **Achievement points as prestige** — a separate score from XP, summed from all 123 trophies.
10. **Live-feed transparency** — every single XP point is publicly observable, making the economy auditable.

## Ten essential features (table stakes, all shipped)

1. OAuth-gated progress so XP belongs to real Twitch accounts.
2. A fair, published level curve: 100 + (level-1) x 50 XP per level, 254,900 total.
3. BadgesCoins as a parallel spendable currency.
4. Daily login reward with streak memory.
5. Server-authoritative randomness — no client-controlled outcomes.
6. Rate limiting on games and heists.
7. Persisted progress with atomic updates.
8. Leaderboard-ready aggregates (games, wins, BadgesCoins).
9. Graceful empty states when systems have no data yet.
10. Multilingual UI — all features in eleven languages.

## Ten unexpected features (the surprises)

1. A Twitch Turbo jackpot at exactly 1 : 100,000,000.
2. Achievements for *failing* — Cursed Dice (10 losses), Rock Bottom (0 BadgesCoins).
3. Level 42 and 69 trophies because the numbers are funny.
4. Exact-777 coin balance trophy.
5. A 3 AM Gambler award for night-session wins.
6. Badge Birthday — logging in on your Twitch account's anniversary.
7. Ghost Town — a reward for a week-old profile with zero visitors.
8. Zen Week — a 7-day streak with fewer games than days.
9. Wheel of Misfortune — twenty spins, never above 100 XP, and still a trophy.
10. Robin Hood — steal successfully, then gamble 1,000 BadgesCoins away.

Thirty ideas, thirty shipped features. The research phase mattered: half of the unique list came from studying what badge collectors actually do — sync, hunt drops, compare collections — and wiring XP directly into those behaviors instead of inventing busywork.`;

async function main() {
  const words = content.trim().split(/\s+/).length;
  const { createFeaturePost } = await import("../src/lib/blog");
  await createFeaturePost({
    slug: "xp-feature-research-30-ideas",
    title: "XP Feature Research: 10 Unique, 10 Essential, 10 Unexpected",
    excerpt: "The thirty features we researched before building the level system — and which ones shipped.",
    content,
    tags: ["xp", "levels", "research"],
  });
  console.log(`published xp-feature-research-30-ideas (${words} words)`);
  process.exit(words >= 300 ? 0 : 1);
}

main().catch((error) => {
  console.error("failed:", error);
  process.exit(1);
});
