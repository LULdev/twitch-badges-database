import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

/**
 * Manual changelog writer — the CLI half of the project rule that every
 * change and every bug fix gets a short explanation plus a timestamped
 * changelog entry.
 *
 *   npm run log:change -- bugfix "FAQ: fehlende fairQ/fairA Keys" "Die FAQ-Seite ..."
 *   npm run log:change -- feature "Titel" "Beschreibung" '{"version":"x"}'
 */
const KINDS = [
  "badge_added",
  "badge_updated",
  "badge_removed",
  "data_sync",
  "feature",
  "bugfix",
  "blog",
  "push",
] as const;

type Kind = (typeof KINDS)[number];

async function main() {
  const [kind, title, body, payloadRaw] = process.argv.slice(2);

  if (!kind || !title) {
    console.error(
      `Usage: npm run log:change -- <${KINDS.join("|")}> "<title>" ["<body>"] ["<json payload>"]`,
    );
    process.exit(1);
  }
  if (!KINDS.includes(kind as Kind)) {
    console.error(`Unknown kind "${kind}". Use one of: ${KINDS.join(", ")}`);
    process.exit(1);
  }

  let payload: Record<string, unknown> | null = null;
  if (payloadRaw) {
    try {
      payload = JSON.parse(payloadRaw) as Record<string, unknown>;
    } catch {
      console.error("Payload must be valid JSON.");
      process.exit(1);
    }
  }

  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.error("SUPABASE_DB_URL is not set in .env.local");
    process.exit(1);
  }

  const sql = postgres(url, { ssl: "prefer", max: 1 });
  try {
    const [row] = await sql`
      insert into public.changelog (kind, title, body, payload)
      values (
        ${kind},
        ${title},
        ${body ?? null},
        ${payload ? JSON.stringify(payload) : null}::jsonb
      )
      returning id, created_at
    `;
    console.log(
      `changelog #${row.id} [${kind}] at ${new Date(row.created_at).toISOString()}: ${title}`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error("log:change failed:", error);
  process.exit(1);
});
