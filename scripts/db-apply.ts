import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

async function main() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.error(
      "SUPABASE_DB_URL is not set. Copy the Postgres connection string from " +
        "Supabase Dashboard → Project Settings → Database and add it to " +
        ".env.local, then re-run: npm run db:apply",
    );
    process.exit(1);
  }

  const migrationsDir = resolve("supabase/migrations");
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const sql = postgres(url, { ssl: "prefer", max: 1 });
  try {
    // One-shot guard: each migration runs at most once. (0001 contains a
    // destructive replace of any prior schema — re-running it would wipe
    // the live data.)
    await sql`create table if not exists supabase_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )`;
    const applied = new Set(
      (await sql`select name from supabase_migrations`).map(
        (row) => String(row.name),
      ),
    );

    const pending = files.filter((name) => !applied.has(name));
    if (pending.length === 0) {
      console.log("All migrations already applied — nothing to do.");
      return;
    }

    for (const name of pending) {
      const text = readFileSync(resolve(migrationsDir, name), "utf8");
      console.log(`Applying ${name} ...`);
      await sql.unsafe(text);
      await sql`insert into supabase_migrations (name) values (${name})`;
      console.log(`OK ${name}`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error("db:apply failed:", error);
  process.exit(1);
});
