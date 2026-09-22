import { readFileSync } from "node:fs";

const LOCALES = ["en", "de", "es", "fr", "pt", "it", "ru", "zh", "ja", "ko", "ar"];
const flat = (o, p = "") => {
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    const q = p ? p + "." + k : k;
    if (v && typeof v === "object" && !Array.isArray(v)) Object.assign(out, flat(v, q));
    else out[q] = v;
  }
  return out;
};
const F = {};
for (const l of LOCALES) F[l] = flat(JSON.parse(readFileSync(`messages/${l}.json`, "utf8")));

// Keys that stay English on purpose: brand, product and game names.
const KEEP = new Set([
  "meta.siteTitle", "meta.postTitle", "blog.title", "stats.legendCoins", "stats.legendXp",
  "games.slotsTitle", "games.shootTitle", "games.scratchTitle", "games.blackjackTitle",
  "games.hubTitle", "games.memoryTitle", "games.rouletteTitle", "games.catcherTitle",
  "games.slotsSymbolScatter", "games.ladderTarget", "games.cashoutAt",
  "customizer.accent2", "customizer.profileTheme",
]);

// A key counts as translated in a locale when it differs from English.
const rows = [];
for (const l of LOCALES) {
  if (l === "en") continue;
  const same = Object.keys(F.en).filter((k) => {
    if (KEEP.has(k)) return false;
    const a = F.en[k];
    const b = F[l][k];
    return typeof a === "string" && typeof b === "string" && a === b && a.trim().length > 0;
  });
  rows.push({ locale: l, count: same.length, keys: same });
}

console.log("=== identical-to-English per locale (excluding intentional brand/name keys) ===");
for (const row of rows.sort((a, b) => b.count - a.count)) {
  console.log(`  ${row.locale.padEnd(3)} ${String(row.count).padStart(4)}`);
}

const worst = rows.sort((a, b) => b.count - a.count)[0];
if (worst.count === 0) {
  console.log("\nno untranslated keys left");
} else {
  console.log(`\n=== keys still English in ${worst.locale} ===`);
  for (const k of worst.keys) console.log(`  ${k} = ${F.en[k]}`);
}

// Cross-check against German, which is fully translated: anything German also
// leaves in English is a code/i18n problem rather than a translation gap.
console.log("\n=== also identical in German (suspicious) ===");
const suspicious = Object.keys(F.en).filter(
  (k) => !KEEP.has(k) && typeof F.en[k] === "string" && F.en[k] === F.de[k] && F.en[k].trim().length > 0,
);
console.log(suspicious.length ? suspicious.map((k) => `  ${k} = ${F.en[k]}`).join("\n") : "  none");