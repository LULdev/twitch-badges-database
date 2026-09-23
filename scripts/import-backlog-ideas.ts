/**
 * Imports the research backlog into the ACP's Ideas board.
 *
 * Sources:
 *   - `bugreports/agent-idea-01..10.md` — the ten idea sub-agent reports, one
 *     `## Title` section each with Category / What / Why it fits / Effort /
 *     Risk if built badly.
 *   - `IMPROVEMENTS.md` Part 1 — the ten optimization areas, one idea per bullet.
 *   - `IMPROVEMENTS.md` Part 2 — the fifty first-party feature ideas.
 *
 * Part 3 of IMPROVEMENTS.md summarises the same sub-agent ideas in short form;
 * it is skipped on purpose, because those ideas come from the agent reports in
 * full. Duplicates are additionally filtered by normalised title, so re-running
 * the import is safe.
 *
 *   npx tsx scripts/import-backlog-ideas.ts            # dry run: report only
 *   npx tsx scripts/import-backlog-ideas.ts --write    # insert into the board
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";

config({ path: ".env.local" });

type IdeaCategory = "profile" | "game" | "badge" | "design" | "content" | "stats" | "other";

interface ParsedIdea {
  category: IdeaCategory;
  title: string;
  body: string;
  status: "idea" | "planned";
  source: string;
}

// ---------------------------------------------------------------- agent files

/** Scope of each report, used as the default category. */
const FILE_SCOPE: Record<string, { category: IdeaCategory; label: string }> = {
  "01": { category: "badge", label: "unique / impressive (catalog-driven)" },
  "02": { category: "badge", label: "unique / impressive (catalog-driven)" },
  "03": { category: "badge", label: "product & catalog" },
  "04": { category: "content", label: "community" },
  "05": { category: "game", label: "gamification & economy" },
  "06": { category: "stats", label: "data & insights" },
  "07": { category: "design", label: "accessibility & performance" },
  "08": { category: "content", label: "growth, retention, content, community" },
  "09": { category: "other", label: "observability, resilience, data quality, DX" },
  "10": { category: "design", label: "visual design, interaction, IA" },
};

/**
 * Narrow overrides for the four broad-scope reports (product/catalog/community),
 * which cover mixed ground. Deliberately tight: a first attempt listed broad
 * words like "game" and "design", and a design idea that merely mentioned "game
 * modals" was filed as a game — 67 of 209 ideas landed in that one bucket. The
 * report's own scope is the authority; these patterns only catch ideas that are
 * unmistakably about something else.
 */
const NARROW_OVERRIDES: Array<[RegExp, IdeaCategory]> = [
  [/(quiz|duel|tournament|jackpot|bingo|slots|roulette|wagers?|payout|leaderboard)/i, "game"],
  [/(accessibility|screen reader|ARIA|RTL|reduced motion|contrast|typography|token scale|command palette|focus trap)/i, "design"],
  [/(forecast|index|SLO|observability|anomaly|metrics?|analytics)/i, "stats"],
  [/(blog|SEO|sitemap|RSS|Open Graph|digest|moderation|comments?|webhook)/i, "content"],
  [/(wishlist|collection page|profile frame|account settings|export|GDPR)/i, "profile"],
];

/** Files whose scope is precise enough to stand on its own. */
const SCOPE_IS_AUTHORITATIVE = new Set(["05", "06", "07", "08", "09", "10"]);

function classify(base: IdeaCategory, text: string): IdeaCategory {
  for (const [pattern, category] of NARROW_OVERRIDES) {
    if (pattern.test(text)) return category;
  }
  return base;
}

function parseAgentFile(number: string, path: string): ParsedIdea[] {
  const scope = FILE_SCOPE[number];
  const source = `bugreports/agent-idea-${number}.md`;
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const ideas: ParsedIdea[] = [];
  let title: string | null = null;
  let fields: Record<string, string[]> = {};
  let current: string | null = null;

  const flush = () => {
    if (!title) return;
    const get = (key: string) => (fields[key] ?? []).join(" ").replace(/\s+/g, " ").trim();
    const what = get("What");
    const why = get("Why it fits");
    const effort = get("Effort");
    const risk = get("Risk if built badly");
    const parts = [
      what,
      why ? `Why it fits: ${why}` : "",
      effort ? `Effort: ${effort}.` : "",
      risk ? `Risk if built badly: ${risk}` : "",
    ].filter(Boolean);
    ideas.push({
      category: SCOPE_IS_AUTHORITATIVE.has(number)
        ? scope.category
        : classify(scope.category, `${title} ${what} ${why}`),
      title,
      body: parts.join("\n\n") || "(no description in the report)",
      status: "idea",
      source,
    });
  };

  for (const line of lines) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      // `## ` at depth 2 is an idea; deeper headings are sub-points of the
      // current idea, so they are treated as body text.
      flush();
      title = heading[1];
      fields = {};
      const keyed = /^-\s+\*\*(.+?)\*\*:\s*(.*)$/.exec(" ".repeat(0));
      void keyed;
      current = null;
      continue;
    }
    if (!title) continue;
    const field = /^-\s+\*\*(.+?)\*\*:\s*(.*)$/.exec(line);
    if (field) {
      current = field[1];
      fields[current] = [field[2]];
      continue;
    }
    if (current && line.trim()) fields[current].push(line.trim());
  }
  flush();
  return ideas.filter((idea) => idea.title && idea.title.length > 2);
}

// ------------------------------------------------------------ IMPROVEMENTS.md

/** Part 1: the ten optimization areas, one idea per bullet. */
const PART1: Array<{ category: IdeaCategory; title: string; body: string }> = [
  // 1. Performance & delivery
  { category: "stats", title: "ISR with per-route tags, invalidated by the syncs", body: "Ship the catalog pages as incremental static regeneration with a tag per route and call revalidateTag from the sync engines, so a badge update appears immediately instead of waiting out the revalidate window.\n\nSource: IMPROVEMENTS.md Part 1.1." },
  { category: "stats", title: "Batch the catalog reads into one round trip", body: "/badges runs several sequential PostgREST round trips (count, page, stats). One select with an embedded count, or a single SQL view, removes the largest TTFB contributor.\n\nSource: IMPROVEMENTS.md Part 1.1." },
  { category: "stats", title: "Read the badge page from a cached view instead of the base table", body: "Keep the 15-minute potat cadence off the critical path: write into badge_stats in bulk as it already does, and let the badge page read a cached view.\n\nSource: IMPROVEMENTS.md Part 1.1." },
  { category: "design", title: "Serve badge images at the size they are displayed", body: "Badge art is 14-28 px but ships at 1x/2x/4x. width/height are present; add decoding=\"async\" and a sizes attribute so a 56 px mobile tile does not fetch the 4x asset.\n\nSource: IMPROVEMENTS.md Part 1.1." },
  // 2. Accessibility
  { category: "design", title: "Announce live regions for the feed and countdowns", body: "The activity feed and the countdown timers change without user action and are silent to screen readers. Wrap them in aria-live=\"polite\" with a throttle so updates are announced without flooding.\n\nSource: IMPROVEMENTS.md Part 1.2." },
  { category: "design", title: "Move focus to the round result in the game modals", body: "After a round resolves, keyboard users have to hunt for the result. Moving focus to it makes the games playable without a mouse.\n\nSource: IMPROVEMENTS.md Part 1.2." },
  { category: "design", title: "Make rarity readable without colour", body: "Rarity is colour plus text today, but the distribution bars and heatmap cells rely on colour alone. Add patterns or labels, and a labelled heatmap legend.\n\nSource: IMPROVEMENTS.md Part 1.2." },
  { category: "design", title: "Audit the header tab order", body: "The language switcher, theme toggle and account menu are visually grouped but interleave with the nav links in tab order.\n\nSource: IMPROVEMENTS.md Part 1.2." },
  // 3. Types & contracts
  { category: "other", title: "Generate Supabase types and drop the hand-written row interfaces", body: "Every `as` cast in queries.ts and stats.ts is an unverified assumption. supabase gen types typescript would make the database the source of truth.\n\nSource: IMPROVEMENTS.md Part 1.3." },
  { category: "other", title: "Validate API payloads against a schema", body: "Replace the typeof chains with a real schema. /api/account stores `customization` verbatim today, with no size or shape limit.\n\nSource: IMPROVEMENTS.md Part 1.3." },
  { category: "content", title: "Derive message keys from the enums that define them", body: "Make FeedKind and AchievementCategory the single source for their message keys, so adding a variant without a translation fails the build instead of rendering a raw key.\n\nSource: IMPROVEMENTS.md Part 1.3." },
  // 4. Observability
  { category: "stats", title: "Chart a per-sync metric payload on /stats", body: "Extend system_heartbeats with rows written, API latency and error class per run, and chart it. The payload plumbing already exists.\n\nSource: IMPROVEMENTS.md Part 1.4." },
  { category: "stats", title: "Alert when a heartbeat goes quiet", body: "A daily check that flags \"no heartbeat for 2 h\" or \"catalog older than 26 h\" and sends a push or mail. The Status tab shows this already; nothing raises it.\n\nSource: IMPROVEMENTS.md Part 1.4." },
  { category: "other", title: "Capture browser exceptions", body: "There is no client-side error capture. A single window.onerror breadcrumb to a collector would surface the silent unhandled-rejection class of bug.\n\nSource: IMPROVEMENTS.md Part 1.4." },
  // 5. Security
  { category: "other", title: "Rate-limit the public write endpoints per IP hash", body: "/api/blog/react, /api/coinrain and /api/steal are limited per user but not per address, so a logged-out caller can rotate identities cheaply.\n\nSource: IMPROVEMENTS.md Part 1.5." },
  { category: "other", title: "Add Content-Security-Policy and HSTS headers", body: "Set both in next.config.ts. The app renders user-influenced strings in several places, which is exactly what CSP is for.\n\nSource: IMPROVEMENTS.md Part 1.5." },
  { category: "design", title: "Rename message keys that carry a vendor name", body: "The profile.potat* keys bake a third-party name into the rendered payload. Renaming them keeps the identifiers neutral if the data source ever changes.\n\nSource: IMPROVEMENTS.md Part 1.5." },
  { category: "profile", title: "Cap and allow-list the stored customization document", body: "Limit `customization` to about 4 KB and allow-list its keys server-side, so a stored blob cannot grow unbounded or carry a CSS value into the render.\n\nSource: IMPROVEMENTS.md Part 1.5." },
  // 6. Database
  { category: "other", title: "Enforce the economy invariants in the database", body: "CHECK constraints for coins >= 0, xp >= 0 and level between 1 and 100. The application logic already assumes all three.\n\nSource: IMPROVEMENTS.md Part 1.6." },
  { category: "stats", title: "Index the hot read paths", body: "A partial index on user_progress.updated_at and an index on activity_events (kind, created_at) to serve the feed filters.\n\nSource: IMPROVEMENTS.md Part 1.6." },
  { category: "stats", title: "Roll badge_stats up into daily rows", body: "The per-badge time series grows without bound. A nightly rollup into daily rows keeps the owner-trend chart fast.\n\nSource: IMPROVEMENTS.md Part 1.6." },
  { category: "other", title: "Document the backup and restore policy", body: "The project has no documented recovery path. A README checklist covering the Supabase PITR settings and a restore test would close that.\n\nSource: IMPROVEMENTS.md Part 1.6." },
  // 7. Code structure
  { category: "other", title: "Split queries.ts into catalog, profile and content modules", body: "The file is over 500 lines, mixes four concerns, and is imported by every page — the single highest-traffic module in the codebase.\n\nSource: IMPROVEMENTS.md Part 1.7." },
  { category: "other", title: "One source of truth for the rarity input", body: "computeRarity is called from two syncs with slightly different argument shapes, and that drift has already caused one incident. A single loader removes the risk.\n\nSource: IMPROVEMENTS.md Part 1.7." },
  { category: "other", title: "Extract the shared sync boilerplate", body: "Three engines repeat the same snapshot, diff, upsert, changelog, heartbeat sequence. One helper makes a change land in all three.\n\nSource: IMPROVEMENTS.md Part 1.7." },
  { category: "content", title: "Delete the unreferenced message keys", body: "The audit found 227 keys that nothing references. They can go once the dynamic-key sites are migrated to explicit maps.\n\nSource: IMPROVEMENTS.md Part 1.7." },
  // 8. SEO
  { category: "content", title: "Programmatic landing pages per rarity, category and status", body: "/badges/legendary, /badges/twitchcon and similar, with real copy. The catalog already holds the data and the i18n scaffolding exists.\n\nSource: IMPROVEMENTS.md Part 1.8." },
  { category: "content", title: "Sitemap freshness from the newest badge event", body: "Use lastModified from the newest badge_events row per badge instead of a build timestamp, so crawlers see real change dates.\n\nSource: IMPROVEMENTS.md Part 1.8." },
  { category: "content", title: "Per-locale RSS with alternates", body: "One feed per locale plus link rel=\"alternate\" between them, so a reader can subscribe in their own language.\n\nSource: IMPROVEMENTS.md Part 1.8." },
  { category: "badge", title: "Open Graph cards for badges", body: "The profile OG route exists; a badge card with image, rarity and owner count would make shares legible.\n\nSource: IMPROVEMENTS.md Part 1.8." },
  // 9. Balance
  { category: "game", title: "Publish the game odds from the same constants the games use", body: "One page fed by the live constants, so the published numbers cannot drift from what the engine actually does.\n\nSource: IMPROVEMENTS.md Part 1.9." },
  { category: "game", title: "Add a global daily cap to stealing", body: "The flood check is per victim, so a coordinated group can still drain the top collectors. A global daily cap closes that without touching the per-victim rule.\n\nSource: IMPROVEMENTS.md Part 1.9." },
  { category: "game", title: "Progressive jackpot on the wheel", body: "A small share of every spin builds a pot that grows visibly, which is a strong reason to return daily.\n\nSource: IMPROVEMENTS.md Part 1.9." },
  { category: "game", title: "Optional seasonal reset for the game ladder", body: "Reset the ladder per season while keeping the lifetime level intact, so a new season is a fresh contest without erasing progress.\n\nSource: IMPROVEMENTS.md Part 1.9." },
  // 10. DX
  { category: "other", title: "Wire the audits into CI as a required check", body: "Run bugreports/*.mjs, tsc, eslint and a MISSING_MESSAGE grep on every pull request. The FAQ and placeholder bugs both shipped behind a green build.\n\nSource: IMPROVEMENTS.md Part 1.10." },
  { category: "other", title: "A single verify script", body: "lint + typecheck + build + the i18n audit + the atomic-economy test in sequence, so the full ritual is one command.\n\nSource: IMPROVEMENTS.md Part 1.10." },
  { category: "other", title: "Seed fixtures for a local Supabase", body: "So a new contributor can see a populated UI without access to the production database.\n\nSource: IMPROVEMENTS.md Part 1.10." },
  { category: "other", title: "Document the invariants the audits had to rediscover", body: "LIKE escaping, atomic counters and IP header trust keep being relearned. AGENTS.md covers part of it; the rest belongs there too.\n\nSource: IMPROVEMENTS.md Part 1.10." },
];

/** Part 2: the fifty first-party feature ideas. */
const PART2: Array<{ category: IdeaCategory; title: string; body: string }> = [
  { category: "badge", title: "Badge archaeology: a provenance page per badge", body: "For every badge: first global sighting, when the claim window opened, how the owner count moved week by week. Nobody publishes a badge's life story.\n\nSource: IMPROVEMENTS.md Part 2 #1." },
  { category: "profile", title: "Collection diffing against any past date", body: "\"What did I own on 1 January?\" answered from the inventory snapshot history — a personal time machine for collectors.\n\nSource: IMPROVEMENTS.md Part 2 #2." },
  { category: "badge", title: "Badge genealogy by artwork family", body: "Cluster badges by artwork family (same set or artist) and show the family tree, so collectors can chase a whole lineage.\n\nSource: IMPROVEMENTS.md Part 2 #3." },
  { category: "badge", title: "Predictive drop calendar", body: "A model over past windows estimating the next drop date per category, with an explicit confidence band rather than a single confident date.\n\nSource: IMPROVEMENTS.md Part 2 #4." },
  { category: "badge", title: "Rarity replay", body: "Animate how a badge's rarity tier changed over its lifetime, including the moment it crossed into legendary.\n\nSource: IMPROVEMENTS.md Part 2 #5." },
  { category: "other", title: "Public API with keys", body: "Let other tools query the catalog, rarity and leaderboards, with keys displayed on the owner's profile as a developer badge.\n\nSource: IMPROVEMENTS.md Part 2 #6." },
  { category: "content", title: "Collective goal events", body: "A community-wide target (\"unlock 1M badge claims this month\") with a shared progress bar in the header.\n\nSource: IMPROVEMENTS.md Part 2 #7." },
  { category: "game", title: "Badge bounties", body: "Users stake BadgesCoins on finding who owns the rarest collection; the finder takes the pot.\n\nSource: IMPROVEMENTS.md Part 2 #8." },
  { category: "profile", title: "Time-capsule profiles", body: "A private message attached to a profile that unlocks automatically in a year, with a badge as the key.\n\nSource: IMPROVEMENTS.md Part 2 #9." },
  { category: "profile", title: "Cross-catalog identity with a unified collector score", body: "One profile that links Twitch and optionally other platforms, showing a single collector score across them.\n\nSource: IMPROVEMENTS.md Part 2 #10." },
  { category: "content", title: "Live drop room", body: "A page that opens automatically when a new global badge appears, with a shared countdown and light live reactions.\n\nSource: IMPROVEMENTS.md Part 2 #11." },
  { category: "game", title: "Streak calendar with a monthly freeze", body: "A contribution-style grid for XP plus one purchasable freeze per month, so a holiday does not end a long streak.\n\nSource: IMPROVEMENTS.md Part 2 #12." },
  { category: "game", title: "Wheel pity timer", body: "A visible counter that guarantees an epic-or-better slot after N spins without one.\n\nSource: IMPROVEMENTS.md Part 2 #13." },
  { category: "design", title: "Animated level-up takeover", body: "A full-screen 1.5 s animation when a member crosses a bracket, with the new badge unfurling. Must be skippable and reduced-motion aware.\n\nSource: IMPROVEMENTS.md Part 2 #14." },
  { category: "badge", title: "Badge shards", body: "Collect fragments of a legendary badge across days; assembling the set unlocks a profile-only variant.\n\nSource: IMPROVEMENTS.md Part 2 #15." },
  { category: "profile", title: "Profile theme marketplace", body: "Members publish colour and effect presets that others apply in one click, with the author earning BadgesCoins per install.\n\nSource: IMPROVEMENTS.md Part 2 #16." },
  { category: "profile", title: "Session recap card", body: "After each visit: XP earned, badges found, rank change — as a shareable card.\n\nSource: IMPROVEMENTS.md Part 2 #17." },
  { category: "game", title: "Duels", body: "Challenge another collector to a best-of-three across three random games, with both stakes visible before accepting.\n\nSource: IMPROVEMENTS.md Part 2 #18." },
  { category: "game", title: "Live tournament bracket", body: "A weekly knockout where the winner takes a share of every entry fee and wears a temporary crown on the leaderboard.\n\nSource: IMPROVEMENTS.md Part 2 #19." },
  { category: "profile", title: "Collection showcase video", body: "One click renders a short MP4 of the profile's rarest badges, with the level badge as the intro card.\n\nSource: IMPROVEMENTS.md Part 2 #20." },
  { category: "badge", title: "Badge weather map", body: "A map view showing which regions are unlocking which badges right now, from anonymised owner deltas.\n\nSource: IMPROVEMENTS.md Part 2 #21." },
  { category: "game", title: "Silent auction for one showcase slot a month", body: "Auction a single showcase slot; the winner's badge sits in a visible podium for everyone.\n\nSource: IMPROVEMENTS.md Part 2 #22." },
  { category: "content", title: "Collector obituary for expiring badges", body: "When a badge finally expires, publish a short eulogy post with its stats — a melancholy archive of the catalog.\n\nSource: IMPROVEMENTS.md Part 2 #23." },
  { category: "game", title: "Anti-hoard tax feeding the jackpot", body: "Past a threshold of idle BadgesCoins, a small decay flows into the jackpot, making hoarding visible and mildly costly.\n\nSource: IMPROVEMENTS.md Part 2 #24." },
  { category: "badge", title: "Badge horoscope", body: "A playful daily \"what your collection says about you\", derived from the categories a member owns most.\n\nSource: IMPROVEMENTS.md Part 2 #25." },
  { category: "profile", title: "Mystery profiles", body: "Every Monday one random profile is highlighted with their rarest badge and a riddle about who they are.\n\nSource: IMPROVEMENTS.md Part 2 #26." },
  { category: "badge", title: "Rarity insurance", body: "Pay BadgesCoins to freeze a badge's rarity tier for a week, so a sudden claim wave cannot demote a showcase entry.\n\nSource: IMPROVEMENTS.md Part 2 #27." },
  { category: "badge", title: "Community museum of extinct badges", body: "A curated rotating exhibit of extinct badges with editorial text, the rotation decided by votes.\n\nSource: IMPROVEMENTS.md Part 2 #28." },
  { category: "game", title: "Ghost races", body: "Replay a past tournament run as a ghost opponent to beat.\n\nSource: IMPROVEMENTS.md Part 2 #29." },
  { category: "profile", title: "Signed collection certificates as shareable PNGs", body: "A signed, shareable PNG certificate for rare collections, generated server-side. No blockchain involved.\n\nSource: IMPROVEMENTS.md Part 2 #30." },
  { category: "badge", title: "Wishlist with push alerts", body: "Watch a badge and get notified the moment it becomes claimable. The smallest high-value item on this list.\n\nSource: IMPROVEMENTS.md Part 2 #31." },
  { category: "profile", title: "Public collection pages with filters", body: "Sort a profile's badges by rarity, date or category, with shareable filtered URLs.\n\nSource: IMPROVEMENTS.md Part 2 #32." },
  { category: "profile", title: "Compare more than two members", body: "A table view across up to five usernames instead of the current pairwise compare.\n\nSource: IMPROVEMENTS.md Part 2 #33." },
  { category: "content", title: "Export the catalog and a personal inventory", body: "CSV and JSON exports for both, useful for analysis and for members who want their own data.\n\nSource: IMPROVEMENTS.md Part 2 #34." },
  { category: "badge", title: "Search by badge image", body: "Upload a badge screenshot and find the matching catalog entry by image similarity.\n\nSource: IMPROVEMENTS.md Part 2 #35." },
  { category: "content", title: "Discord and Telegram webhooks", body: "Post new drops and tournament results into a channel, so the community hears about them where they already are.\n\nSource: IMPROVEMENTS.md Part 2 #36." },
  { category: "profile", title: "A real account settings page with deletion and export", body: "Account deletion (GDPR) and a data export, as a proper settings page rather than the current customizer alone.\n\nSource: IMPROVEMENTS.md Part 2 #37." },
  { category: "content", title: "Moderated comment threads on badges", body: "Comment threads with reactions, seeded by the community's knowledge of how each badge is earned.\n\nSource: IMPROVEMENTS.md Part 2 #38." },
  { category: "content", title: "Multi-language blog posts", body: "The posts table already carries a locale column; surface it so a post can be published per language.\n\nSource: IMPROVEMENTS.md Part 2 #39." },
  { category: "game", title: "Achievement progress bars", body: "Show \"3 / 10 games played\" style progress toward the next achievable achievement, instead of only locked and unlocked.\n\nSource: IMPROVEMENTS.md Part 2 #40." },
  { category: "stats", title: "Server-rendered rarity simulations with a slider", body: "\"If this badge gains 5,000 owners, its score becomes X\", computed on the server and shown as a slider.\n\nSource: IMPROVEMENTS.md Part 2 #41." },
  { category: "game", title: "Real-time multiplayer rounds over SSE", body: "A shared slots or roulette table where each player sees the others' bets land live.\n\nSource: IMPROVEMENTS.md Part 2 #42." },
  { category: "game", title: "Deterministic replay of every game round", body: "Store the seed and the inputs so any round can be re-run and verified by anyone — provable fairness rather than a promise.\n\nSource: IMPROVEMENTS.md Part 2 #43." },
  { category: "stats", title: "Anomaly detection on the economy", body: "Nightly statistics flag impossible coin flows and freeze the accounts involved automatically.\n\nSource: IMPROVEMENTS.md Part 2 #44." },
  { category: "badge", title: "Bulk badge imports via QR codes", body: "Scanning a TwitchCon booth poster adds the badge to a \"seen in the wild\" collection.\n\nSource: IMPROVEMENTS.md Part 2 #45." },
  { category: "stats", title: "A public status page from the heartbeat data", body: "The data is already collected; a standalone /status route with incident notes would make it public.\n\nSource: IMPROVEMENTS.md Part 2 #46." },
  { category: "stats", title: "Vector rarity map", body: "A 2-D scatter of owner count against age with every badge plotted and zoomable — finding the lonely corner is the game.\n\nSource: IMPROVEMENTS.md Part 2 #47." },
  { category: "game", title: "Time-shifted leaderboards", body: "\"Top collectors of badges released in the last 30 days\", computed from the snapshot history that already exists.\n\nSource: IMPROVEMENTS.md Part 2 #48." },
  { category: "stats", title: "Edge-cached personal dashboards", body: "Render per-member progress at the edge with stale-while-revalidate, so the header HUD never blocks a page.\n\nSource: IMPROVEMENTS.md Part 2 #49." },
  { category: "badge", title: "An assistant that recommends the next badge to claim", body: "Answers \"which currently claimable badge fits my collection best?\" from the catalog, citing the rows it used.\n\nSource: IMPROVEMENTS.md Part 2 #50." },
];

// --------------------------------------------------------------------- main

function normalise(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function main() {
  const write = process.argv.includes("--write");
  const ideas: ParsedIdea[] = [];

  for (const number of Object.keys(FILE_SCOPE)) {
    const path = resolve("bugreports", `agent-idea-${number}.md`);
    ideas.push(...parseAgentFile(number, path));
  }
  for (const idea of PART1) {
    ideas.push({ ...idea, status: "idea", source: "IMPROVEMENTS.md Part 1" });
  }
  for (const idea of PART2) {
    ideas.push({ ...idea, status: "idea", source: "IMPROVEMENTS.md Part 2" });
  }

  // Deduplicate on the normalised title: IMPROVEMENTS.md Part 3 restates the
  // sub-agent ideas, and re-running the import must not double the board.
  const seen = new Map<string, ParsedIdea>();
  const duplicates: string[] = [];
  for (const idea of ideas) {
    const key = normalise(idea.title);
    if (seen.has(key)) {
      duplicates.push(idea.title);
      continue;
    }
    seen.set(key, idea);
  }
  const unique = [...seen.values()];

  const byCategory = unique.reduce<Record<string, number>>((acc, idea) => {
    acc[idea.category] = (acc[idea.category] ?? 0) + 1;
    return acc;
  }, {});
  const bySource = unique.reduce<Record<string, number>>((acc, idea) => {
    acc[idea.source] = (acc[idea.source] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`parsed ${ideas.length} candidates`);
  console.log(`duplicates dropped: ${duplicates.length}${duplicates.length ? ` (${duplicates.slice(0, 5).join("; ")}…)` : ""}`);
  console.log(`unique: ${unique.length}`);
  console.log("by category:", JSON.stringify(byCategory));
  console.log("by source:", JSON.stringify(bySource, null, 1));
  console.log("\nsample:");
  for (const idea of [unique[0], unique[40], unique[80], unique[unique.length - 1]]) {
    if (idea) console.log(`  [${idea.category}] ${idea.title}\n    ${idea.body.slice(0, 150).replace(/\n/g, " ")}…`);
  }

  if (!write) {
    console.log("\nDry run. Re-run with --write to insert.");
    return;
  }

  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.error("SUPABASE_DB_URL is not set");
    process.exit(1);
  }
  const postgres = (await import("postgres")).default;
  const sql = postgres(url, { ssl: "prefer", max: 1 });
  let inserted = 0;
  let skipped = 0;
  try {
    const existing = new Set(
      (await sql`select title from brainstorm_ideas`).map((row) => normalise(String(row.title))),
    );
    for (const idea of unique) {
      if (existing.has(normalise(idea.title))) {
        skipped += 1;
        continue;
      }
      await sql`
        insert into brainstorm_ideas (category, title, body, status)
        values (${idea.category}, ${idea.title}, ${`${idea.body}\n\nSource: ${idea.source}`}, ${idea.status})`;
      inserted += 1;
    }
    const [count] = await sql`select count(*)::int n from brainstorm_ideas`;
    console.log(`\ninserted ${inserted}, skipped ${skipped} (already on the board), board now holds ${count.n}`);
  } finally {
    await sql.end();
  }
}

void main();
