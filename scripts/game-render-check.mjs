// One-off authenticated render check (task: pixels-verify the GameAction CTAs).
// Modes: seed | check | cleanup. The seeded user is deleted in cleanup; the
// profiles/user_progress rows cascade from auth.users.
import fs from "node:fs";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

dotenv.config({ path: ".env.local" });
const STATE = ".render-session.json";
const mode = process.argv[2];

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

if (mode === "seed") {
  const a = admin();
  const email = `render-check-${Date.now()}@users.noreply.local`;
  const password = "Rc-" + Math.random().toString(36).slice(2, 12) + "!7Aa";
  const { data, error } = await a.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { preferred_username: "render-check" },
  });
  if (error) throw error;
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`password grant failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const session = await res.json();
  fs.writeFileSync(STATE, JSON.stringify({ userId: data.user.id, email, password, session }));
  console.log("SEEDED user", data.user.id);
} else if (mode === "cleanup") {
  const { userId } = JSON.parse(fs.readFileSync(STATE, "utf8"));
  const { error } = await admin().auth.admin.deleteUser(userId);
  if (error) throw error;
  fs.rmSync(STATE);
  console.log("CLEANED user", userId);
} else if (mode === "check") {
  const { session } = JSON.parse(fs.readFileSync(STATE, "utf8"));
  const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  const value = encodeURIComponent(JSON.stringify(session));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 920 }, deviceScaleFactor: 2 });
  await ctx.addCookies([
    { name: `sb-${ref}-auth-token`, value, domain: "twitch-badges-database.vercel.app", path: "/", sameSite: "Lax", httpOnly: false, secure: true },
  ]);
  const page = await ctx.newPage();
  const base = "https://twitch-badges-database.vercel.app";
  const failures = [];

  // Hilo: Higher (primary) + Lower (secondary), side by side — full={false}.
  await page.goto(`${base}/en/games/hilo`, { waitUntil: "networkidle" });
  const hiloButtons = await page.$$eval(".btn-lg", (els) => els.map((e) => ({ c: e.className, t: e.textContent.trim() })));
  const hiloPrimary = hiloButtons.filter((b) => b.c.includes("btn-primary") && b.c.includes("btn-lg"));
  const hiloSecondary = hiloButtons.filter((b) => b.c.includes("btn-secondary") && b.c.includes("btn-lg"));
  if (hiloPrimary.length !== 1 || !hiloPrimary[0].t.includes("▲")) failures.push(`hilo primary: ${JSON.stringify(hiloPrimary)}`);
  if (hiloSecondary.length !== 1 || !hiloSecondary[0].t.includes("▼")) failures.push(`hilo secondary: ${JSON.stringify(hiloSecondary)}`);
  if (hiloButtons.some((b) => b.c.includes("w-full"))) failures.push("hilo buttons must NOT be full-width");
  // Note: HiloGame renders its own hiloHint at the bottom of the board for
  // authed players, so the hint string appearing here is expected, not a leak.
  await page.screenshot({ path: "docs/screenshots/19-hilo-authenticated.png", fullPage: true });
  console.log("hilo: primary", hiloPrimary.length, "| secondary", hiloSecondary.length, "| full-width", hiloButtons.some((b) => b.c.includes("w-full")));

  // Slots: one full-width Spin pill.
  await page.goto(`${base}/en/games/slots`, { waitUntil: "networkidle" });
  const spin = await page.$$eval(".btn-lg", (els) => els.map((e) => ({ c: e.className, t: e.textContent.trim() })));
  const spinBtn = spin.find((b) => b.c.includes("btn-primary") && b.c.includes("w-full"));
  if (!spinBtn || !/Spin/i.test(spinBtn.t)) failures.push(`slots spin: ${JSON.stringify(spin)}`);
  await page.screenshot({ path: "docs/screenshots/20-slots-authenticated.png", fullPage: true });
  console.log("slots: spin button", JSON.stringify(spinBtn ?? null));

  // Blackjack: one full-width Deal pill.
  await page.goto(`${base}/en/games/blackjack`, { waitUntil: "networkidle" });
  const bj = await page.$$eval(".btn-lg", (els) => els.map((e) => ({ c: e.className, t: e.textContent.trim() })));
  const dealBtn = bj.find((b) => b.c.includes("btn-primary") && b.c.includes("w-full"));
  if (!dealBtn || !/Deal/i.test(dealBtn.t)) failures.push(`blackjack deal: ${JSON.stringify(bj)}`);
  await page.screenshot({ path: "docs/screenshots/21-blackjack-authenticated.png", fullPage: true });
  console.log("blackjack: deal button", JSON.stringify(dealBtn ?? null));

  // The wall itself renders for logged-out users — run post-deploy ("wall" mode).
  await browser.close();
  if (failures.length) {
    console.log("FAILURES:");
    for (const f of failures) console.log(" -", f);
    process.exit(1);
  }
  console.log("RENDER CHECK PASSED");
} else if (mode === "wall") {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 920 } })).newPage();
  await page.goto("https://twitch-badges-database.vercel.app/en/games/hilo", { waitUntil: "networkidle" });
  const label = await page.getByText("How to play", { exact: true }).isVisible().catch(() => false);
  const hint = await page.getByText("Will the next badge").isVisible().catch(() => false);
  await page.screenshot({ path: "docs/screenshots/22-game-wall-teaser.png", fullPage: true });
  await browser.close();
  if (!label || !hint) { console.log("WALL FAIL: label", label, "hint", hint); process.exit(1); }
  console.log("WALL TEASER PASSED");
}
