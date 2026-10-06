/**
 * Publishes the Pingu Throw announcement — the arcade's 14th game. Idempotent
 * by slug (createFeaturePost ignores dupes).
 *
 * Run: ALLOW_ONE_OFF_MIGRATION=1 npx tsx scripts/seed-pingu-post.ts
 *
 * The post writes its own changelog row via createFeaturePost and appears in
 * the blog index, RSS and homepage. Push is NOT sent — that is outward-facing
 * and stays a manual decision: npm run send:push -- "Pingu Throw is live" "..." "/en/blog/pingu-throw"
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

const content = `A yeti stands on a cliff with a golf club. A penguin waddles to the edge. Two taps decide everything.

**Pingu Throw** is live as the arcade's 14th game — a pure skill game where your timing launches a penguin down an icy slope, and every meter of flight is yours. It sits next to the other thirteen at [the games hub](/en/games), bets the same BadgesCoins, feeds the same leaderboards, and adds two achievements plus a 10x jackpot of its own.

## How a round works

Tap once: the penguin hops off the cliff edge and falls. Tap again: the yeti swings. Hit the penguin at eye level with a flat-ish swing and he rockets off in a long, bouncing arc; hit too high or too late and he faceplants a few meters out. Distance signs mark 25 m through 700 m, your best throw plants a flag in the snow, and each landing earns a rank — from **Snow snack** to **Bounce baron**.

The bet is placed by the swing: a throw where you never swing costs nothing. Choose your stake in the bet bar (10 to 2,000 BadgesCoins) before you send the penguin off.

## The score you see is the score that pays

This is the part we are proudest of: the game's physics is deterministic, so the client never reports its own score. The server receives only your tap timing — the milliseconds between the two taps — and replays the throw with the exact same physics to derive the distance, the payout and the jackpot roll. A hacked client that claims a 5,000-meter flight gets its forged number discarded; only the replayed throw pays.

## Chance, cap and the 10x jackpot

Like every skill game in the arcade, distance raises your **win chance** (up to 45%) rather than paying distance directly — a 2x win on a settled round, with the [economy checks](/en/faq) you already know verifying the house edge stays under 1. The exception is the jackpot: throws past **320 meters** — near the physical ceiling of what the club can achieve — unlock a 1-in-100 roll at a **10x payout**. Land it and the feed turns gold, the podium records you, and a push alert goes out to everyone.

## Achievements and standings

Two new achievements join the catalog: **First Flight** for your first completed throw, and the special **Crown of the Ice** for hitting the 10x jackpot. Every round feeds the game page's recent-wins podium and the hub ticker, the same as every other arcade game — the daily and weekly [recaps](/en/blog) now count Pingu Throw rounds too.

Grab a bet and go send something flying: [Pingu Throw](/en/games/pingu).`;

async function main(): Promise<void> {
  const words = content.trim().split(/\s+/).length;
  if (words < 300) {
    console.error(`Refusing to publish: ${words} words (house floor 300).`);
    process.exit(1);
  }

  const { createFeaturePost } = await import("../src/lib/blog");
  const published = await createFeaturePost({
    slug: "pingu-throw",
    title: "Pingu Throw: the arcade's 14th game — tap, swing, fly",
    excerpt:
      "A yeti, a club, one penguin: Pingu Throw lands as the 14th arcade game. Pure timing decides the meters, the server replays every throw from your tap timing alone, and throws past 320 m unlock a 10x jackpot roll.",
    content,
    cover: "/games/art/pingu.svg",
    tags: ["games", "arcade", "announcement"],
  });

  console.log(
    published
      ? `published pingu-throw (${words} words)`
      : "slug already exists — nothing written (idempotent)",
  );
  process.exit(published ? 0 : 1);
}

main().then(() => process.exit(0)).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});