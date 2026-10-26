/**
 * Contrast gate — exits non-zero, so `npm run build` fails before a deploy
 * ships a WCAG-AA regression in the theme tokens.
 *
 * Parses the :root (dark) and .light token blocks straight out of
 * src/app/globals.css (the source of truth — the check can never drift from
 * the shipped colors), computes WCAG 2.1 contrast ratios for a curated list
 * of fg x bg pairs the UI actually renders as TEXT, and classifies each pair
 * as normal (4.5:1) or large text (3:1) per the surface's font size/weight.
 *
 * Scope (v1): opaque token-on-token pairs only. rgba() tokens (--line,
 * --accent-soft, --ambient, --sparkle) are borders/tints, never text
 * backgrounds — skipped. Surfaces with color-mix backgrounds
 * (.chip-gold, .jackpot-hit, .jackpot-chip) are composite and deliberately
 * out of scope; the round-8 audit verified them by hand.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const css = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");

/** Extract one token block by its exact opening selector, brace-balanced. */
function tokenBlock(opening: string): Record<string, string> {
  const start = css.indexOf(opening);
  if (start < 0) throw new Error(`token block not found: ${opening}`);
  let depth = 0;
  let end = -1;
  for (let i = css.indexOf("{", start); i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) throw new Error(`unclosed token block: ${opening}`);
  // Strip comments FIRST: a prose mention like "--accent:" inside a comment
  // would otherwise match the declaration regex and swallow the next real
  // declaration (its [^;]+ value runs to the following semicolon).
  const body = css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, "");
  const tokens: Record<string, string> = {};
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const value = match[2].trim();
    // Only opaque hex literals; skip rgba()/var()/shadow/radius declarations.
    if (/^#[0-9a-fA-F]{3,8}$/.test(value)) tokens[match[1]] = value;
  }
  return tokens;
}

const DARK = tokenBlock(":root {");
const LIGHT = tokenBlock(".light {");
const THEMES: Array<[string, Record<string, string>]> = [["dark", DARK], ["light", LIGHT]];

// WCAG 2.1 relative luminance + ratio.
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const ch = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return ch(r) * 0.2126 + ch(g) * 0.7152 + ch(b) * 0.0722;
}
function ratio(fg: string, bg: string): number {
  const [l1, l2] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

// [label, fg token, bg token, largeText] — the curated text surfaces.
// Font-size classification (WCAG): large = >=24px, or >=18.66px bold.
const PAIRS: Array<[string, string, string, boolean]> = [
  ["foreground on background (body)", "--foreground", "--background", false],
  ["foreground on surface (.card)", "--foreground", "--surface", false],
  ["muted on surface (stat-label, data-table th)", "--muted", "--surface", false],
  ["accent on surface (links, focus)", "--accent", "--surface", false],
  ["success on surface (stat-trend 10px bold)", "--success", "--surface", false],
  ["success on surface LARGE (stat-value 22px bold)", "--success", "--surface", true],
  ["danger on surface (stat-trend 10px bold)", "--danger", "--surface", false],
  ["warning on surface (jackpot-label 11px bold)", "--warning", "--surface", false],
  ["rank-gold on surface-2 (jackpot-chip-pot 11px bold)", "--rank-gold", "--surface-2", false],
  ["rank-silver on surface (HoF medal 10px)", "--rank-silver", "--surface", false],
  ["rank-bronze on surface (HoF medal 10px)", "--rank-bronze", "--surface", false],
  ["accent-ink on accent-deep (primary button)", "--accent-ink", "--accent-deep", false],
];

let failures = 0;
let checked = 0;
for (const [themeName, tokens] of THEMES) {
  for (const [label, fg, bg, large] of PAIRS) {
    const fgHex = tokens[fg];
    const bgHex = tokens[bg];
    if (!fgHex || !bgHex) {
      console.error(`MISSING TOKEN (${themeName}) ${fg} or ${bg} — block drifted?`);
      failures += 1;
      continue;
    }
    const r = ratio(fgHex, bgHex);
    const need = large ? 3 : 4.5;
    checked += 1;
    if (r < need) {
      failures += 1;
      console.error(
        `FAIL ${themeName} ${label}: ${r.toFixed(2)}:1 (need ${need}) [${fgHex} on ${bgHex}]`,
      );
    }
  }
}

if (failures > 0) {
  console.error(`contrast: ${failures} failure(s) across ${checked} pairs`);
  process.exit(1);
}
console.log(`contrast: OK — ${checked} pairs across both themes pass WCAG AA`);
