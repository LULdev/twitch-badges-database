import { readFileSync } from "node:fs";

const LOCALES = ["en", "de", "es", "fr", "pt", "it", "ru", "zh", "ja", "ko", "ar"];
const msg = {};
for (const l of LOCALES) msg[l] = JSON.parse(readFileSync(`messages/${l}.json`, "utf8"));

const flat = (o, p = "") => {
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    const path = p ? `${p}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) Object.assign(out, flat(v, path));
    else out[path] = v;
  }
  return out;
};
const F = {};
for (const l of LOCALES) F[l] = flat(msg[l]);

// Strings that are short, proper-noun-ish or brand names are legitimately identical.
const noise = /^(?:BadgesCoins?|XP|Turbo|O|OK|EN|DE|FR|ES|PT|IT|RU|ZH|JA|KO|AR)$/;
const looksLatin = (s) => /[a-z]{3}/.test(s);
const isProse = (s) => s.split(/\s+/).length >= 4;

console.log("=== untranslated-by-locale summary (identical to English) ===");
const byLocale = {};
for (const l of LOCALES) {
  if (l === "en") continue;
  const rows = Object.entries(F[l]).filter(
    ([k, v]) =>
      typeof v === "string" &&
      typeof F.en[k] === "string" &&
      v === F.en[k] &&
      v.length > 14 &&
      !noise.test(v) &&
      looksLatin(v),
  );
  byLocale[l] = rows;
  const prose = rows.filter(([, v]) => isProse(v)).length;
  console.log(
    `  ${l.padEnd(3)} identical=${String(rows.length).padStart(4)}  prose(>=4 words)=${String(prose).padStart(4)}`,
  );
}

console.log("\n=== per-locale namespace breakdown (prose strings only, real gaps) ===");
for (const l of LOCALES) {
  if (l === "en") continue;
  const rows = (byLocale[l] ?? []).filter(([, v]) => isProse(v));
  if (!rows.length) continue;
  const byNs = {};
  for (const [k] of rows) {
    const ns = k.split(".")[0];
    byNs[ns] = (byNs[ns] ?? 0) + 1;
  }
  const parts = Object.entries(byNs)
    .sort((a, b) => b[1] - a[1])
    .map(([ns, n]) => `${ns}:${n}`);
  console.log(`  ${l}: total prose=${rows.length}   ${parts.join("  ")}`);
}

console.log("\n=== full list for the worst locale ===");
const worst = Object.entries(byLocale).sort((a, b) => b[1].length - a[1].length)[0];
console.log(`worst = ${worst[0]} (${worst[1].length} identical strings)`);
for (const [k, v] of worst[1]) console.log(`  ${k}\n      ${v.slice(0, 120)}`);