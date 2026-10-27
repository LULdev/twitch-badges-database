/**
 * Publishes the Badge Rocket announcement — the arcade's 15th game and its
 * first live-interactive one. Idempotent by slug (createFeaturePost ignores
 * dupes).
 *
 * Run: ALLOW_ONE_OFF_MIGRATION=1 npx tsx scripts/seed-crash-post.ts
 *
 * The post writes its own changelog row via createFeaturePost and appears in
 * the blog index, RSS and homepage. Push is NOT sent — that is outward-facing
 * and stays a manual decision: npm run send:push -- "Badge Rocket is live" "..." "/en/games/crash"
 */
import { config } from "dotenv";

config({ path: ".env.local" });

// One-off seed: refuse accidental re-runs (the house guard, cf. seed-pingu-post).
if (process.env.ALLOW_ONE_OFF_MIGRATION !== "1") {
  console.error(
    "Refusing to run: one-off seed. Set ALLOW_ONE_OFF_MIGRATION=1 to override.",
  );
  process.exit(1);
}

const content = `A rocket sits on the pad with your badges in the hold. The countdown ends, the multiplier starts climbing from 1.00x — and the only question is how long you dare to stay aboard.

**Badge Rocket** is live as the arcade's 15th game — a crash game, and the first one in the catalogue where the round is not an instant reveal but a live flight you interact with. It sits next to the other fourteen at [the games hub](/en/games), bets the same BadgesCoins (10 to 1,000), feeds the same leaderboards, and brings four achievements plus a progressive pot of its own.

## How a flight works

Set your stake, optionally pick an auto cash-out target (1.5x up to 10x), and hit Launch. The rocket lifts off and the multiplier climbs — slowly at first, then faster and faster. At any moment you can hit Cash out and bank your stake times the current multiplier. Hesitate too long and the rocket explodes: the flight crashes, the stake is gone, and the crash point flashes red on your flight history.

The board itself is the game: a glowing climb curve on a starfield that streams past faster the higher you fly, the Earth's curvature sinking away below, and from 6x onward the moon slides into frame until it fills the sky at 10x. Ride that far and the game calls it what it is — reaching the moon. Every flight also lands in your history strip as a chip, green when you banked it, red when it blew.

## The crash point never leaves the server

Every other game in this arcade resolves in one server call; a crash game cannot, because the interesting moment happens mid-round. So Badge Rocket runs on new machinery built for it: the crash point is rolled the instant you launch and stored server-side — it is never part of any response while the rocket is airborne. Your client only animates the climb from the shared growth formula and the flight's start time. When you hit Cash out, the server grades the claim from its own clock; the poll that watches your flight settles the crash the exact moment the curve crosses the rolled point. Close the tab mid-flight and nothing is lost — an abandoned flight settles itself, and a banked auto target is enforced server-side, not in your browser.

The payout math is the classic crash curve: every cash-out strategy, from the timid 1.5x to the 250x cap, returns the same designed house edge, and the [economy checks](/en/faq) you already know now assert exactly that across the whole strategy ladder. A crashed flight feeds this game's own progressive pot and the cross-game [Mega Jackpot](/en/games) like every other loss in the arcade — and every settled flight rolls the hit chances on both pots.

## Achievements

Four new entries join the wall: **Liftoff** for your first launch, **To the Moon** for banking a flight at 10x or higher, **Nerve of Steel** for cashing out within 0.10x of the crash point, and the special **Escape Velocity** for a 50x+ cash-out — about one flight in fifty even reaches that altitude, never mind leaving it with the coins.

Pick a stake, watch the curve, and trust your nerve: [Badge Rocket](/en/games/crash).`;

async function main(): Promise<void> {
  const words = content.trim().split(/\s+/).length;
  if (words < 300) {
    console.error(`Refusing to publish: ${words} words (house floor 300).`);
    process.exit(1);
  }

  const { createFeaturePost } = await import("../src/lib/blog");
  const published = await createFeaturePost({
    slug: "badge-rocket",
    title: "Badge Rocket: the arcade's 15th game — ride the multiplier, cash out before the blast",
    excerpt:
      "The first live-interactive game in the catalogue: launch the rocket, watch the multiplier climb from 1.00x and cash out before it blows. The crash point is rolled and hidden server-side, cash-outs are graded by the server clock, and every strategy from 1.5x to the 250x cap sits at the designed house edge.",
    content,
    cover: "/games/art/crash.svg",
    tags: ["games", "arcade", "announcement"],
  });

  console.log(
    published
      ? `published badge-rocket (${words} words)`
      : "slug already exists — nothing written (idempotent)",
  );
  process.exit(published ? 0 : 1);
}

main().then(() => process.exit(0)).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
