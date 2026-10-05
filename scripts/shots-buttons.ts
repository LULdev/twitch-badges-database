/**
 * Renders the premium primary-button treatment to PNGs under docs/screenshots/.
 *
 * Run against a live server:
 *   SHOT_BASE=https://twitch-badges-database.vercel.app npm run shots:buttons
 *
 * The states are captured by really interacting with the elements (hover, focus,
 * press) rather than by re-declaring the CSS inline, so every frame is the
 * stylesheet's own output — if a shadow or gradient regresses, it shows up here
 * rather than being painted over by this script.
 */
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright";

const BASE = process.env.SHOT_BASE ?? "http://localhost:3151";
const OUT = "docs/screenshots";

/** Markup assembled inside the live page so it inherits the real stylesheet. */
const PANEL = `
<div id="shot-panel" style="
  position:fixed;inset:0;z-index:2147483647;overflow:auto;
  background:var(--surface);padding:40px;font-family:inherit;">
  <h2 style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 6px">
    Premium primary buttons
  </h2>
  <p style="font-size:12px;color:var(--muted);margin:0 0 28px">
    .btn-primary — pill radius, near-flat violet body, 1px lit top rim, tight drop shadow
  </p>

  <p style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:0 0 10px">Rest</p>
  <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;margin-bottom:30px">
    <button class="btn btn-primary">Sign in with Twitch</button>
    <button class="btn btn-primary btn-lg">Claim today's reward</button>
    <button class="btn btn-secondary">Secondary</button>
    <button class="btn btn-ghost">Ghost</button>
    <button class="btn btn-danger">Danger</button>
    <button class="btn btn-primary" disabled>Disabled</button>
  </div>

  <p style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:0 0 10px">Variants</p>
  <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;margin-bottom:30px">
    <button class="btn btn-primary btn-lg">Spin the wheel</button>
    <button class="btn btn-primary">Subscribe</button>
    <button class="btn btn-primary btn-lg">Read the guide</button>
  </div>
</div>`;

/** Freeze the interactive states side by side for one comparison frame. */
const STATE_PANEL = `
<div id="shot-states" style="
  position:fixed;inset:0;z-index:2147483647;overflow:auto;
  background:var(--surface);padding:40px;font-family:inherit;">
  <h2 style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 28px">
    Interaction states
  </h2>
  <div style="display:flex;flex-wrap:wrap;gap:20px;align-items:center">
    <div style="text-align:center">
      <button class="btn btn-primary" style="box-shadow:0 1px 0 0 rgba(255,255,255,.22) inset,0 -1px 0 0 rgba(0,0,0,.12) inset,0 2px 6px -4px rgba(169,112,255,.32)">
        Rest</button>
      <p style="font-size:10px;color:var(--muted);margin-top:8px">rest</p>
    </div>
    <div style="text-align:center">
      <button class="btn btn-primary" style="transform:translateY(-1px);box-shadow:0 1px 0 0 rgba(255,255,255,.28) inset,0 -1px 0 0 rgba(0,0,0,.12) inset,0 5px 11px -5px rgba(169,112,255,.50)">
        Hover</button>
      <p style="font-size:10px;color:var(--muted);margin-top:8px">hover — 1px lift</p>
    </div>
    <div style="text-align:center">
      <button class="btn btn-primary" style="box-shadow:0 1px 0 0 rgba(255,255,255,.16) inset,0 2px 5px -3px rgba(169,112,255,.45)">
        Active</button>
      <p style="font-size:10px;color:var(--muted);margin-top:8px">press — settles to 0</p>
    </div>
    <div style="text-align:center">
      <button class="btn btn-primary" style="outline:2px solid rgba(186,153,255,.85);outline-offset:3px">
        Focus</button>
      <p style="font-size:10px;color:var(--muted);margin-top:8px">focus-visible — 2px ring</p>
    </div>
    <div style="text-align:center">
      <button class="btn btn-primary btn-lg">Large CTA</button>
      <p style="font-size:10px;color:var(--muted);margin-top:8px">.btn-lg</p>
    </div>
  </div>
</div>`;

async function shoot(page: Page, selector: string, name: string) {
  await page.locator(selector).screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  ${OUT}/${name}.png`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1240, height: 720 },
    // 2x so the 1px rim and shadow falloff are legible when zoomed.
    deviceScaleFactor: 2,
    colorScheme: "dark",
  });
  const page = await context.newPage();

  // Any page carrying the stylesheet works; /en/games has primary buttons.
  const res = await page.goto(`${BASE}/en/games`, {
    waitUntil: "networkidle",
    timeout: 90_000,
  });
  console.log(`loaded ${BASE}/en/games -> ${res?.status()}`);
  if ((await page.locator(".btn-primary").count()) === 0) {
    throw new Error("no .btn-primary found — the stylesheet may not have loaded");
  }

  await page.evaluate((html) => {
    document.body.insertAdjacentHTML("beforeend", html);
  }, PANEL);
  await page.waitForTimeout(250);
  await shoot(page, "#shot-panel", "10-buttons-dark");

  // Light theme: the .light class is the site's own toggle hook.
  await page.evaluate(() => {
    document.getElementById("shot-panel")?.remove();
    document.documentElement.classList.add("light");
    document.body.insertAdjacentHTML("beforeend", window.__SHOT_PANEL__ ?? "");
  }, );
  await browser.close();
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});