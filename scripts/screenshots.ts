/**
 * Renders the ACP's reachable views to PNGs under docs/screenshots/.
 *
 * Run against a dev server:  PORT=3111 npm run dev &  then  npm run shots
 *
 * Which views this can capture is bounded by who is allowed to see them. The
 * dashboard tabs require a signed-in owner or admin, and this script has no
 * session, so it captures everything an anonymous visitor can reach — the
 * admin gate, the public statistics page and the role badges on a profile. The
 * dashboard tabs themselves need either a real login or a temporary role grant;
 * see docs/ACP.md.
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.SHOT_BASE ?? "http://localhost:3111";
const OUT = "docs/screenshots";

const PAGES: Array<{ name: string; path: string; note?: string }> = [
  { name: "01-admin-gate-passcode", path: "/en/admin" },
  { name: "02-admin-gate-german", path: "/de/admin" },
  { name: "03-stats-visitors-block", path: "/en/stats#visitors" },
  { name: "04-stats-full", path: "/en/stats" },
  { name: "05-profile-identity", path: "/en/profile/band1to" },
  { name: "06-changelog", path: "/en/changelog" },
  { name: "07-home", path: "/en" },
  { name: "08-games-hub", path: "/en/games" },
];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    // The dark theme is the site's default; set it explicitly so the shots are
    // not decided by whatever the storage happened to hold.
    colorScheme: "dark",
  });
  const page = await context.newPage();
  const failures: string[] = [];

  for (const entry of PAGES) {
    try {
      const response = await page.goto(`${BASE}${entry.path}`, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      // Animations would otherwise be caught mid-frame; the settle timer lets
      // the chart reveal stages finish.
      await page.waitForTimeout(entries_sleep(entry.name));
      if (!response || response.status() >= 400) {
        failures.push(`${entry.name}: HTTP ${response?.status() ?? "no response"}`);
        continue;
      }
      await page.screenshot({
        path: `${OUT}/${entry.name}.png`,
        fullPage: entry.name.includes("full") || entry.name.includes("stats-visitors"),
      });
      console.log(`captured ${entry.name} (${entry.path})`);
    } catch (error) {
      failures.push(`${entry.name}: ${error instanceof Error ? error.message : "failed"}`);
    }
  }

  await browser.close();

  if (failures.length > 0) {
    console.error("\nNot captured:");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
  }
}

/** The stats page animates its counters and charts in; give them time. */
function entries_sleep(name: string): number {
  return name.includes("stats") ? 2600 : 900;
}

void main();
