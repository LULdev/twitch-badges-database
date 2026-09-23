/**
 * One-shot: seeds the ACP's Ideas board with the catalogue of features that
 * were researched but not built, so they are tracked rather than forgotten.
 * Idempotent: an idea with the same title is not inserted twice.
 *
 *   npx tsx scripts/seed-acp-ideas.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import postgres from "postgres";

interface Seed {
  category: "profile" | "game" | "badge" | "design" | "content" | "stats" | "other";
  title: string;
  body: string;
  status: "idea" | "planned";
}

const IDEAS: Seed[] = [
  {
    category: "other",
    title: "Impersonation with its own audit trail",
    body: "Let an admin act as a member to reproduce a bug. Deliberately postponed rather than skipped: it needs a separate, non-repudiable record of every action taken while impersonating, otherwise the audit log becomes ambiguous about who did what. Effort: high.",
    status: "planned",
  },
  {
    category: "other",
    title: "Export and import",
    body: "Export a table (or a member's full record) as JSON/CSV for analysis or a manual backup, and import it back. Effort: medium. Note the CSV would need care around the JSON columns.",
    status: "idea",
  },
  {
    category: "other",
    title: "Sync dry run",
    body: "Run the catalog diff in a mode that reports what it would add, update and remove without writing anything. The engines already compute those sets before writing, so this is mostly threading a flag through runGlobalSync. Effort: medium.",
    status: "planned",
  },
  {
    category: "other",
    title: "Achievement re-evaluation for every member",
    body: "Re-check all 125 achievements for all members, for when a definition changes and previously-earned achievements would now qualify. Needs a queue rather than a loop — one pass over a large member base would not fit in a serverless invocation. Effort: medium.",
    status: "idea",
  },
  {
    category: "stats",
    title: "Economy time machine",
    body: "Simulate an economy change (daily bonus, steal price, game XP) against real recent activity before publishing it, answering 'what would this have done last month'. Effort: high — needs a replayable activity log, which the statistics views only partly provide.",
    status: "planned",
  },
  {
    category: "stats",
    title: "Session monitor",
    body: "See who is signed in right now, from where, and sign a device out. Supabase holds the sessions; this would need its admin API and a careful privacy stance on the stored metadata. Effort: medium.",
    status: "idea",
  },
  {
    category: "stats",
    title: "Outbound uptime alerting",
    body: "The Status tab shows availability but nothing pushes a message when a service goes down. Would need a destination (mail, webhook) and a threshold that does not page on a single hiccup. Effort: low-medium.",
    status: "planned",
  },
  {
    category: "content",
    title: "Scheduled publishing",
    body: "Give blog posts a future published_at and have them appear on their own. The column already exists and the public query already filters on status; what is missing is a scheduled flip. Effort: low.",
    status: "planned",
  },
  {
    category: "content",
    title: "Media library",
    body: "Upload and reuse images instead of pasting URLs. Needs a storage bucket, a size cap, and image optimisation on the way in. Effort: medium.",
    status: "idea",
  },
  {
    category: "content",
    title: "Moderation queue and report system",
    body: "Hold user-generated content for review and let members report it. Nothing on the site generates such content today (blog reactions are IP-gated, there are no comments), so this waits for the feature that needs it. Effort: high.",
    status: "idea",
  },
  {
    category: "other",
    title: "Read-only database browser",
    body: "Browse any table with filters and pagination. The Users, Content and Badges tabs already cover the tables that actually need browsing, which is why this stayed unbuilt. Effort: medium-high for a safe version.",
    status: "idea",
  },
  {
    category: "other",
    title: "SEO settings editor",
    body: "Editable meta templates per page type. The current values are derived from the content itself, so an editor would introduce a second source of truth for titles that already read well. Effort: low, value unclear.",
    status: "idea",
  },
  {
    category: "other",
    title: "Redirect management and a 404 monitor",
    body: "Manage redirects in the panel and surface the paths that 404 most often. No redirect surface exists yet; the 404 monitor would be the more useful half and could reuse the analytics table. Effort: medium.",
    status: "idea",
  },
  {
    category: "other",
    title: "Cache reset",
    body: "Bust the site's cached pages in one action. Next's revalidation is per route and this deployment exposes no site-wide hook, so a real version needs an infrastructure change rather than a panel button. Effort: medium-high.",
    status: "idea",
  },
  {
    category: "other",
    title: "Login attempt log for members",
    body: "Record member sign-in attempts for the panel. Supabase owns that flow and does not expose the events to the app, so this needs a call in the auth callback plus its own retention rule. Effort: low-medium.",
    status: "idea",
  },
  {
    category: "other",
    title: "Per-action permissions instead of three roles",
    body: "A capability matrix (can edit content, can ban, can change settings) rather than moderator/admin/owner. Three roles cover the team this site has; a matrix is worth it the day moderation is delegated widely. Effort: medium.",
    status: "idea",
  },
  {
    category: "other",
    title: "Two-factor for the panel",
    body: "A TOTP step on top of the Twitch login for staff accounts. The Twitch login is already a second factor for a Twitch account, but not for this site. Effort: medium.",
    status: "idea",
  },
  {
    category: "other",
    title: "Bulk user actions",
    body: "Select several members and ban, role-change or grant an achievement in one go. Needs a selection model in the users table and a batch endpoint. Effort: low-medium.",
    status: "idea",
  },
  {
    category: "stats",
    title: "Visitor replay from anonymised paths",
    body: "Reconstruct a plausible journey through the site from the stored path sequence. The analytics table keeps paths without any visitor identity beyond the salted hash, so a real version would need a per-session grouping the privacy stance deliberately avoids. Effort: high, and it pushes against the privacy design.",
    status: "idea",
  },
  {
    category: "badge",
    title: "Trigger the global sync's collision skip with real provider data",
    body: "The custom-badge protection skips a provider badge that would collide on (set_id, version). The logic is in place and verified at the data layer, but no collision exists today, so the skip has never actually fired. Worth a deliberate test the next time a provider reuses a set id. Effort: low.",
    status: "planned",
  },
];

async function main() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.error("SUPABASE_DB_URL is not set");
    process.exit(1);
  }
  const sql = postgres(url, { ssl: "prefer", max: 1 });
  let inserted = 0;
  let skipped = 0;
  try {
    for (const idea of IDEAS) {
      const existing = await sql`
        select id from brainstorm_ideas where title = ${idea.title} limit 1`;
      if (existing.length > 0) {
        skipped += 1;
        continue;
      }
      await sql`
        insert into brainstorm_ideas (category, title, body, status)
        values (${idea.category}, ${idea.title}, ${idea.body}, ${idea.status})`;
      inserted += 1;
    }
    const [count] = await sql`select count(*)::int n from brainstorm_ideas`;
    console.log(`inserted ${inserted}, skipped ${skipped}, board now holds ${count.n}`);
  } finally {
    await sql.end();
  }
}

void main();
