/**
 * Exports the current Ideas board as a compact inventory, so brainstorming
 * agents can be told precisely what already exists.
 *
 *   npx tsx scripts/export-idea-inventory.ts
 *
 * Writes bugreports/existing-ideas-inventory.md — one line per idea, grouped by
 * category, with a truncated gist. The gist is what matters: an agent must be
 * able to recognise that a new idea is the same idea in different words.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.error("SUPABASE_DB_URL is not set");
    process.exit(1);
  }
  const postgres = (await import("postgres")).default;
  const sql = postgres(url, { ssl: "prefer", max: 1 });

  try {
    interface Row {
      category: string;
      title: string;
      body: string;
      status: string;
    }
    const rows = (await sql`
      select category, title, body, status from brainstorm_ideas
      order by category, votes desc, id`) as unknown as Row[];

    const byCategory = new Map<string, Row[]>();
    for (const row of rows) {
      const list = byCategory.get(row.category) ?? [];
      list.push(row);
      byCategory.set(row.category, list);
    }

    const gist = (body: string): string => {
      const first = body
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0 && !line.startsWith("Source:"));
      const text = (first ?? "").replace(/\s+/g, " ");
      return text.length > 190 ? `${text.slice(0, 187)}…` : text;
    };

    const lines: string[] = [
      "# Existing ideas on the board — do not duplicate these",
      "",
      `Exported ${rows.length} ideas from \`brainstorm_ideas\`. Every line is one`,
      "idea that is ALREADY on the board. A new proposal that carries the same",
      "idea in different words counts as a duplicate and will be rejected.",
      "",
      "Note: the twenty entries marked `planned` are the ACP features that were",
      "researched and deliberately postponed.",
      "",
      `Total: ${rows.length} ideas.`,
      "",
    ];

    for (const [category, list] of [...byCategory.entries()].sort()) {
      lines.push(`## ${category} (${list.length})`, "");
      for (const row of list) {
        const flag = row.status === "planned" ? " **[planned]**" : "";
        lines.push(`- **${row.title}**${flag} — ${gist(row.body)}`);
      }
      lines.push("");
    }

    const out = resolve("bugreports", "existing-ideas-inventory.md");
    writeFileSync(out, lines.join("\n"), "utf8");
    console.log(`wrote ${out}`);
    console.log(`categories: ${[...byCategory.entries()].map(([c, l]) => `${c}=${l.length}`).join(" ")}`);
  } finally {
    await sql.end();
  }
}

void main();
