/**
 * Renders the premium primary-button treatment to PNGs under docs/screenshots/.
 *
 * Run against a live server:
 *   SHOT_BASE=https://twitch-badges-database.vercel.app npm run shots:buttons
 *
 * The interactive states are captured by really interacting with the elements
 * (hover, focus, press) rather than by re-declaring the CSS inline, so every
 * frame is the stylesheet's own output — a shadow or gradient regression shows
 * up here instead of being painted over by this script.
 */
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright";

const BASE = process.env.SHOT_BASE ?? "http://localhost:3151";
const OUT = "docs/screenshots";

/** Assembled inside the live page so it inherits the real stylesheet. */
const PANEL = `
<div id="shot-panel" style="position:fixed;inset:0;z-index:2147483647;overflow:auto;background:var(--surface);padding:40px;font-family:inherit;">
  <h2 style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 6px">Premium primary buttons</h2>
  <p style="font-size:12px;color:var(--muted);margin:0 0 28px">.btn-primary — pill radius, near-flat violet body, 1px lit top rim, tight drop shadow</p>
  <p style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:0 0 10px">Variants</p>
  <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;margin-bottom:30px">
    <button class="btn btn-primary">Sign in with Twitch</button>
    <button class="btn btn-primary btn-lg">Claim today's reward</button>
    <button class="btn btn-secondary">Secondary</button>
    <button class="btn btn-ghost">Ghost</button>
    <button class="btn btn-danger">Danger</button>
    <button class="btn btn-primary" disabled>Disabled</button>
  </div>
  <p style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:0 0 10px">Large CTA</p>
  <div style="display:flex;flex-wrap:wrap;gap:16px;align-items:center">
    <button class="btn btn-primary btn-lg">Spin the wheel</button>
    <button class="btn btn-secondary btn-lg">Browse all badges</button>
  </div>
</div>`;

async function shoot(page: Page, selector: string, name: string) {
  await page.locator(selector).screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  ${OUT}/${name}.png`);
}

/** Hover / focus / press, driven through real input rather than re-declared CSS. */
async function shootStates(page: Page) {
  const shell = `#shot-bar{position:fixed;left:40px;top:150px;z-index:2147483647;background:var(--surface);padding:26px 30px;border-radius:var(--radius-card);border:1px solid var(--line)}#shot-bar .row{display:flex;gap:22px;align-items:flex-start;margin-bottom:18px}#shot-bar .cap{font-size:10px;color:var(--muted);text-align:center;margin-top:9px}#shot-bar h2{font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 18px}`;
  await page.evaluate(
    ({ shell, html }) => {
      const style = document.createElement("style");
      style.textContent = shell;
      document.head.appendChild(style);
      document.body.insertAdjacentHTML("beforeend", html);
    },
    {
      shell,
      html: `<div id="shot-bar">
        <h2>Interaction states</h2>
        <div class="row">
          <div><button id="s-rest" class="btn btn-primary">Rest</button><p class="cap">rest</p></div>
          <div><button id="s-hover" class="btn btn-primary">Hover</button><p class="cap">hover — 1px lift</p></div>
          <div><button id="s-focus" class="btn btn-primary">Focus</button><p class="cap">focus-visible — 2px ring</p></div>
          <div><button id="s-active" class="btn btn-primary">Pressed</button><p class="cap">press — settles to 0</p></div>
        </div>
      </div>`,
    },
  );

  await shoot(page, "#shot-bar", "11-buttons-states-rest");
  await page.locator("#s-hover").hover();
  await page.waitForTimeout(320);
  await shoot(page, "#shot-bar", "12-buttons-states-hover");
  await page.locator("#s-focus").focus();
  await page.waitForTimeout(200);
  await shoot(page, "#shot-bar", "13-buttons-states-focus");
  await page.locator("#s-active").hover();
  await page.mouse.down();
  await page.waitForTimeout(260);
  await shoot(page, "#shot-bar", "14-buttons-states-press");
  await page.mouse.up();
  await page.evaluate(() => document.getElementById("shot-bar")?.remove());
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1240, height: 720 },
    // 2x so the 1px rim and shadow falloff stay legible when zoomed.
    deviceScaleFactor: 2,
    colorScheme: "dark",
  });
  const page = await context.newPage();

  const res = await page.goto(`${BASE}/en/games`, {
    waitUntil: "networkidle",
    timeout: 90_000,
  });
  console.log(`loaded ${BASE}/en/games -> ${res?.status()}`);
  if ((await page.locator(".btn-primary").count()) === 0) {
    throw new Error("no .btn-primary found — the stylesheet may not have loaded");
  }

  await page.evaluate((html) => document.body.insertAdjacentHTML("beforeend", html), PANEL);
  await page.waitForTimeout(250);
  await shoot(page, "#shot-panel", "10-buttons-dark");
  await page.evaluate(() => document.getElementById("shot-panel")?.remove());

  await shootStates(page);

  // Light theme uses the site's own `.light` class hook, not the media query.
  await page.evaluate(() => document.documentElement.classList.add("light"));
  await page.evaluate((html) => document.body.insertAdjacentHTML("beforeend", html), PANEL);
  await page.waitForTimeout(250);
  await shoot(page, "#shot-panel", "15-buttons-light");

  await browser.close();
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});