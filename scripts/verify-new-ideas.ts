/**
 * Verifies the brainstormed idea files and screens them for duplicates.
 *
 *   npx tsx scripts/verify-new-ideas.ts            # report
 *   npx tsx scripts/verify-new-ideas.ts --json     # machine-readable flags
 *
 * Three checks, in increasing order of subtlety:
 *
 *  1. **Schema** — category allowed by the board, 45 entries (or the assigned
 *     count), unique titles, every body carrying an Effort and a Risk line.
 *  2. **Exact collision** — a normalised title equal to one already on the
 *     board, or repeated inside the new set.
 *  3. **Rewording screen** — the check this script exists for. An idea that
 *     restates an existing one in different words passes 1 and 2 unseen, so
 *     every new idea is compared against all existing ideas (and against its
 *     peers) on word overlap: title-token Jaccard, title containment, and
 *     body-token containment. Pairs above the thresholds are printed for a
 *     human (or an adjudicating agent) to judge. The screen is deliberately
 *     loose — it is a net, not a verdict; a flagged pair may well be two
 *     genuinely different ideas that happen to share vocabulary, and a
 *     duplicate that shares no vocabulary will slip through. It is the final
 *     judgement that decides, not the threshold.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";

config({ path: ".env.local" });

const ALLOWED = [
  "profile", "game", "addon", "badge", "design", "content", "stats",
  "performance", "usability", "xp", "coin", "admin", "other",
];

const STOPWORDS = new Set([
  "a", "an", "and", "the", "of", "to", "in", "on", "for", "with", "that", "this",
  "is", "are", "be", "as", "at", "by", "it", "its", "from", "or", "so", "than",
  "then", "into", "over", "up", "out", "but", "not", "no", "each", "every",
  "their", "they", "them", "his", "her", "our", "your", "you", "we", "us",
  "can", "could", "would", "should", "will", "which", "what", "when", "where",
  "who", "how", "why", "also", "more", "most", "less", "least", "very", "just",
  "only", "own", "same", "other", "another", "than", "there", "here", "new",
  "site", "page", "pages", "user", "users", "member", "members", "idea", "ideas",
]);

/** Crude singularisation: enough to make "badges" and "badge" one token. */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !STOPWORDS.has(word))
      .map(stem),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** How much of the smaller set is contained in the larger. */
function containment(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

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

interface ExistingIdea {
  category: string;
  title: string;
  body: string;
}

/** Thresholds for the rewording screen. `--loose` widens the net a lot: it is
 *  how the final adjudication pass is run, because a pair that shares no
 *  vocabulary cannot be caught by any net and a pair that shares some deserves
 *  a look either way. */
function thresholds(loose: boolean) {
  return loose
    ? { titleJaccard: 0.34, titleContainment: 0.6, bodyContainment: 0.6 }
    : { titleJaccard: 0.5, titleContainment: 0.75, bodyContainment: 0.72 };
}

async function main() {
  const asJson = process.argv.includes("--json");
  const t = thresholds(process.argv.includes("--loose"));

  // --- load the new files
  const files = readdirSync("bugreports")
    .filter((name) => /^new-ideas-.*\.json$/.test(name) && name !== "new-ideas-rejects.json")
    .sort();
  if (files.length === 0) {
    console.error("no bugreports/new-ideas-*.json files found");
    process.exit(1);
  }

  const ideas: Idea[] = [];
  const problems: string[] = [];

  for (const file of files) {
    const path = resolve("bugreports", file);
    let parsed: { agent?: string; ideas?: unknown };
    try {
      parsed = JSON.parse(readFileSync(path, "utf8")) as typeof parsed;
    } catch (error) {
      problems.push(`${file}: not valid JSON (${error instanceof Error ? error.message : "?"})`);
      continue;
    }
    const list = Array.isArray(parsed.ideas) ? parsed.ideas : [];
    if (list.length === 0) problems.push(`${file}: no ideas`);
    list.forEach((raw, index) => {
      const idea = raw as Partial<Idea>;
      const where = `${file}[${index}]`;
      if (!idea.title || idea.title.trim().length < 6) problems.push(`${where}: missing/short title`);
      if (!idea.body || idea.body.length < 60) problems.push(`${where}: missing/short body`);
      if (!idea.category || !ALLOWED.includes(idea.category)) {
        problems.push(`${where}: category "${idea.category}" is not allowed`);
      }
      if (idea.body && !/Effort:\s*[SML]/.test(idea.body)) problems.push(`${where}: no effort estimate`);
      if (idea.body && !/Risk if built badly/i.test(idea.body)) problems.push(`${where}: no risk note`);
      ideas.push({
        category: idea.category ?? "?",
        title: (idea.title ?? "").trim(),
        body: (idea.body ?? "").trim(),
        why: idea.why,
        origin: file,
      });
    });
  }

  // --- load the board
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.error("SUPABASE_DB_URL is not set");
    process.exit(1);
  }
  const postgres = (await import("postgres")).default;
  const sql = postgres(url, { ssl: "prefer", max: 1 });
  let existing: ExistingIdea[] = [];
  try {
    existing = (await sql<
      Array<{ category: string; title: string; body: string }>
    >`select category, title, coalesce(body, '') as body from brainstorm_ideas`).map((row) => ({
      category: row.category,
      title: row.title,
      body: row.body,
    }));
  } finally {
    await sql.end();
  }

  // --- 2. exact collisions
  const existingTitles = new Map(existing.map((row) => [normalise(row.title), row]));
  const seen = new Map<string, Idea>();
  const exactRejects: Array<{ idea: Idea; against: string }> = [];
  const internalRejects: Array<{ idea: Idea; against: string }> = [];

  for (const idea of ideas) {
    const key = normalise(idea.title);
    const board = existingTitles.get(key);
    if (board) {
      exactRejects.push({ idea, against: `${board.title} (on the board, ${board.category})` });
      continue;
    }
    const twin = seen.get(key);
    if (twin) {
      internalRejects.push({ idea, against: twin.title });
      continue;
    }
    seen.set(key, idea);
  }

  const uniqueNew = [...seen.values()];

  // --- 3. rewording screen
  interface Flag {
    score: number;
    reason: string;
    a: string;
    aCategory: string;
    b: string;
    bCategory: string;
    bOnBoard: boolean;
  }
  const flags: Flag[] = [];

  const prepared = uniqueNew.map((idea) => ({
    idea,
    titleTokens: tokens(idea.title),
    bodyTokens: tokens(`${idea.title} ${idea.body}`),
  }));
  const boardPrepared = existing.map((row) => ({
    row,
    titleTokens: tokens(row.title),
    bodyTokens: tokens(`${row.title} ${row.body}`),
  }));

  // Against the board. A candidate's own row is skipped: once the ideas have
  // been imported, every one of them is on the board, and matching an idea
  // against itself would drown the real flags.
  const selfTitles = new Set(uniqueNew.map((idea) => normalise(idea.title)));
  for (const entry of prepared) {
    for (const board of boardPrepared) {
      if (selfTitles.has(normalise(board.row.title))) continue;
      const titleJ = jaccard(entry.titleTokens, board.titleTokens);
      const titleC = containment(entry.titleTokens, board.titleTokens);
      const bodyC = containment(entry.bodyTokens, board.bodyTokens);
      const hits: string[] = [];
      if (titleJ >= t.titleJaccard) hits.push(`titleJaccard ${titleJ.toFixed(2)}`);
      if (titleC >= t.titleContainment && titleJ >= 0.25) hits.push(`titleContainment ${titleC.toFixed(2)}`);
      if (bodyC >= t.bodyContainment) hits.push(`bodyContainment ${bodyC.toFixed(2)}`);
      if (hits.length === 0) continue;
      flags.push({
        score: Math.max(titleJ, bodyC),
        reason: hits.join(", "),
        a: entry.idea.title,
        aCategory: entry.idea.category,
        b: board.row.title,
        bCategory: board.row.category,
        bOnBoard: true,
      });
    }
  }

  // Against each other.
  for (let i = 0; i < prepared.length; i += 1) {
    for (let j = i + 1; j < prepared.length; j += 1) {
      const left = prepared[i];
      const right = prepared[j];
      const titleJ = jaccard(left.titleTokens, right.titleTokens);
      const bodyC = containment(left.bodyTokens, right.bodyTokens);
      const hits: string[] = [];
      if (titleJ >= t.titleJaccard + 0.1) hits.push(`titleJaccard ${titleJ.toFixed(2)}`);
      if (bodyC >= t.bodyContainment + 0.03) hits.push(`bodyContainment ${bodyC.toFixed(2)}`);
      if (hits.length === 0) continue;
      flags.push({
        score: Math.max(titleJ, bodyC),
        reason: hits.join(", "),
        a: left.idea.title,
        aCategory: left.idea.category,
        b: right.idea.title,
        bCategory: right.idea.category,
        bOnBoard: false,
      });
    }
  }

  flags.sort((x, y) => y.score - x.score);

  const byCategory = uniqueNew.reduce<Record<string, number>>((acc, idea) => {
    acc[idea.category] = (acc[idea.category] ?? 0) + 1;
    return acc;
  }, {});

  const report = {
    files: files.length,
    parsed: ideas.length,
    uniqueNew: uniqueNew.length,
    exactRejects: exactRejects.map((r) => ({ title: r.idea.title, against: r.against, file: r.idea.origin })),
    internalRejects: internalRejects.map((r) => ({ title: r.idea.title, against: r.against, file: r.idea.origin })),
    schemaProblems: problems,
    byCategory,
    flagsAgainstBoard: flags.filter((f) => f.bOnBoard),
    flagsInternal: flags.filter((f) => !f.bOnBoard),
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`files: ${files.length}`);
  console.log(`parsed: ${ideas.length} | unique candidates: ${uniqueNew.length}`);
  console.log("by category:", JSON.stringify(byCategory));
  console.log(`\nschema problems: ${problems.length}`);
  for (const problem of problems.slice(0, 20)) console.log(`  - ${problem}`);
  if (problems.length > 20) console.log(`  … and ${problems.length - 20} more`);

  console.log(`\nexact collisions with the board: ${exactRejects.length}`);
  for (const reject of exactRejects) console.log(`  - "${reject.idea.title}" == ${reject.against}`);

  console.log(`duplicates inside the new set: ${internalRejects.length}`);
  for (const reject of internalRejects) console.log(`  - "${reject.idea.title}" == "${reject.against}"`);

  console.log(`\nrewording flags vs board: ${report.flagsAgainstBoard.length}`);
  for (const flag of report.flagsAgainstBoard.slice(0, 40)) {
    console.log(`  [${flag.score.toFixed(2)} ${flag.reason}] NEW "${flag.a}" (${flag.aCategory})  vs BOARD "${flag.b}" (${flag.bCategory})`);
  }
  console.log(`\nrewording flags new-vs-new: ${report.flagsInternal.length}`);
  for (const flag of report.flagsInternal.slice(0, 40)) {
    console.log(`  [${flag.score.toFixed(2)} ${flag.reason}] "${flag.a}" (${flag.aCategory})  vs  "${flag.b}" (${flag.bCategory})`);
  }
}

void main();
