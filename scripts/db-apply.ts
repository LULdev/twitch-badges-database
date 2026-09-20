import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

async function main() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.error(
      [
        "SUPABASE_DB_URL is not set.",
        "",
        "Copy the Postgres connection string from:",
        "  Supabase Dashboard → Project Settings → Database → Connection string (URI)",
        "and add it to .env.local, then re-run: npm run db:apply",
        "",
        "(Everything else — syncs, queries — works without it; it is only needed",
        "to create the tables.)",
      ].join("\n"),
    );
    process.exit(1);
  }

  const migrationPath = resolve("supabase/migrations/0001_init.sql");
  const sqlText = readFileSync(migrationPath, "utf8");

  console.log(`Applying ${migrationPath} …`);
  const sql = postgres(url, { ssl: "prefer", max: 1 });
  try {
    await sql.unsafe(sqlText);
    console.log("Migration applied successfully.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error("db:apply failed:", error);
  process.exit(1);
});
