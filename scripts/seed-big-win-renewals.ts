import { config } from "dotenv";
config({ path: ".env.local" });

// One-off seed: refuse accidental re-runs (the house guard, cf.
// seed-streak-freeze-post.ts). Push is NOT sent — that stays a manual
// decision: npm run send:push -- "Title" "Body" "/en/blog/big-win-renewals".
if (process.env.ALLOW_ONE_OFF_MIGRATION !== "1") {
  console.error("Refusing to run without ALLOW_ONE_OFF_MIGRATION=1.");
  process.exit(1);
}

const content = `## The arcade just got louder

For most of its life, a big win on Twitch Badges Database lived exactly where it happened: inside one game's result panel, for one player, for a few seconds. That changed with this renewal wave. Rare wins are now a site-wide event — they celebrate in the live feed, rank on all-time podiums, tick across the hub, rotate on the homepage, and ring the notification bell.

## The feed celebrates

Slots rounds paying 15× the bet or more, and scratch cards hitting the 10× jackpot, now write their own big-win entry into the [live feed](/en/feed). The row carries the round's net coin value, wears the Jewel BadgesCoin with a gold glow instead of the plain kind dot, and the card itself gets a warm amber ring. If a feed row says "Big win", the game really paid.

## Every game has a podium

Each [game detail page](/en/games/slots) now keeps a "Recent big wins" card. Above the eight most recent winners sits the all-time podium: the three highest payouts in that game's history, gold, silver and bronze, each with a profile link and the amount. Logged in, the card also tells you where you stand — your best big win and your rank — or simply "You're on this podium!" when you made it.

## Ticker and homepage

The [games hub](/en/games) opens with a ticker of the three newest big wins across all games, each color-coded to its game and linking straight to the table. The [homepage](/) hero joins in with a rotating strip of the latest wins — a pure-CSS crossfade, no JavaScript, and frozen to the newest win for visitors who prefer reduced motion.

## The jackpot alert

A scratch jackpot and a slots round at the engine's 25× cap now broadcast a jackpot alert: an in-app notification plus a web push to every subscriber, with its own collapse tag and a direct link to the game. The alert fires strictly after the round has settled and can never fail the round itself.

## The economy, in public

[/stats](/en/stats) gained a community coin-flow card — thirty days of feed-logged coin movement across all players, gross earned, gross spent and net, day by day. On your own profile, a new "Your best rounds" row shows the best single-round net you ever took out of each game you have played.

## Podium Finish

All of this feeds one new achievement: **Podium Finish** (500 XP, 250 coins) unlocks the first time your name holds a top-3 spot on any game's all-time big-win podium. The catalog now counts 129 active achievements, and the hero counter has been updated to match.

## Try it

Log in with Twitch, pick a game from the hub, and bet what you can afford to lose. When the reels line up, the whole site will hear about it.`;

const words = content.trim().split(/\s+/).length;
if (words < 300) {
  console.error(`Refusing to publish: ${words} words (house floor 300).`);
  process.exit(1);
}

async function main() {
  const { createFeaturePost } = await import("../src/lib/blog");
  const published = await createFeaturePost({
    slug: "big-win-renewals",
    title: "The Big-Win Renewals: Podiums, Tickers, and Jackpot Alerts",
    excerpt:
      "Rare arcade wins now ripple across the whole site: a celebrating live feed, all-time podiums on every game page, a hub ticker, a rotating homepage strip, jackpot push alerts, and a community coin-flow card.",
    content,
    cover: "/games/art/slots.svg",
    tags: ["arcade", "announcement", "games", "BadgesCoins"],
  });
  console.log("[seed-big-win-renewals] published:", published);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[seed-big-win-renewals] failed:", error);
    process.exit(1);
  });
