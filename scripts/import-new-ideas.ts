/**
 * Imports the brainstormed ideas into the board.
 *
 *   npx tsx scripts/import-new-ideas.ts            # dry run
 *   npx tsx scripts/import-new-ideas.ts --write
 *
 * Reads every `bugreports/new-ideas-*.json`, applies the same schema filter the
 * verifier uses, and skips anything already on the board (by normalised title,
 * so re-running is safe).
 *
 * Titles listed in `bugreports/new-ideas-rejects.json` are additionally skipped.
 * That file is the adjudication of the verifier's rewording flags: the screen
 * is a net, and a human (or an adjudicating agent) decides which flagged pairs
 * are genuinely the same idea. Keeping the decision in a file rather than in
 * this script means the exclusion is reviewable and repeatable.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";

config({ path: ".env.local" });

const ALLOWED = [
  "profile", "game", "addon", "badge", "design", "content", "stats",
  "performance", "usability", "xp", "coin", "admin", "other",
];

function normalise(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

interface Idea {
  category: string;
  title: string;
  body: string;
  why?: string;
  origin: string;
}

function loadIdeas(): { ideas: Idea[]; problems: string[] } {
  const files = readdirSync("bugreports")
    .filter((name) => /^new-ideas-.*\.json$/.test(name) && name !== "new-ideas-rejects.json")
    .sort();
  const ideas: Idea[] = [];
  const problems: string[] = [];

  for (const file of files) {
    const parsed = JSON.parse(readFileSync(resolve("bugreports", file), "utf8")) as {
      ideas?: unknown;
    };
    const list = Array.isArray(parsed.ideas) ? parsed.ideas : [];
    list.forEach((raw, index) => {
      const idea = raw as Partial<Idea>;
      const where = `${file}[${index}]`;
      if (!idea.title || !idea.body || !idea.category) {
        problems.push(`${where}: incomplete`);
        return;
      }
      if (!ALLOWED.includes(idea.category)) {
        problems.push(`${where}: category "${idea.category}" not allowed`);
        return;
      }
      if (!/Effort:\s*[SML]/.test(idea.body) || !/Risk if built badly/i.test(idea.body)) {
        problems.push(`${where}: missing effort or risk line`);
        return;
      }
      ideas.push({
        category: idea.category,
        title: idea.title.trim(),
        body: idea.body.trim(),
        why: idea.why,
        origin: file,
      });
    });
  }
  return { ideas, problems };
}

async function main() {
  const write = process.argv.includes("--write");
  const { ideas, problems } = loadIdeas();

  const rejectsPath = resolve("bugreports", "new-ideas-rejects.json");
  const rejects: string[] = existsSync(rejectsPath)
    ? (JSON.parse(readFileSync(rejectsPath, "utf8")) as { titles?: string[] }).titles ?? []
    : [];
  const rejectSet = new Set(rejects.map(normalise));

  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.error("SUPABASE_DB_URL is not set");
    process.exit(1);
  }
  const postgres = (await import("postgres")).default;
  const sql = postgres(url, { ssl: "prefer", max: 1 });

  try {
    const onBoard = new Set(
      (await sql`select title from brainstorm_ideas`).map((row) => normalise(String(row.title))),
    );

    const toInsert: Idea[] = [];
    let skippedOnBoard = 0;
    let skippedRejected = 0;
    let skippedInternal = 0;
    const seen = new Set<string>();

    for (const idea of ideas) {
      const key = normalise(idea.title);
      if (rejectSet.has(key)) {
        skippedRejected += 1;
        continue;
      }
      if (onBoard.has(key)) {
        skippedOnBoard += 1;
        continue;
      }
      if (seen.has(key)) {
        skippedInternal += 1;
        continue;
      }
      seen.add(key);
      toInsert.push(idea);
    }

    const byCategory = toInsert.reduce<Record<string, number>>((acc, idea) => {
      acc[idea.category] = (acc[idea.category] ?? 0) + 1;
      return acc;
    }, {});

    console.log(`parsed ${ideas.length} ideas from the agent files`);
    console.log(`schema problems: ${problems.length}`);
    for (const problem of problems.slice(0, 10)) console.log(`  - ${problem}`);
    console.log(`already on the board: ${skippedOnBoard}`);
    console.log(`listed as duplicates (rejects file): ${skippedRejected}`);
    console.log(`duplicated inside the new set: ${skippedInternal}`);
    console.log(`to insert: ${toInsert.length}`);
    console.log("by category:", JSON.stringify(byCategory));

    if (!write) {
      console.log("\nDry run. Re-run with --write to insert.");
      return;
    }

    let inserted = 0;
    for (const idea of toInsert) {
      const body = idea.why ? `${idea.body}\n\nWhy: ${idea.why}\n\nSource: ${idea.origin}` : `${idea.body}\n\nSource: ${idea.origin}`;
      await sql`
        insert into brainstorm_ideas (category, title, body, status)
        values (${idea.category}, ${idea.title}, ${body}, 'idea')`;
      inserted += 1;
    }
    const [count] = await sql`select count(*)::int n from brainstorm_ideas`;
    console.log(`\ninserted ${inserted}; board now holds ${count.n} ideas`);
  } finally {
    await sql.end();
  }
}

void main();
