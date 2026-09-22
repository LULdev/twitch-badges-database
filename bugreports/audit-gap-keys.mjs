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

// German is fully localised, so it acts as the arbiter: if German differs from
// English the key is translatable, and any of the nine locales still showing
// the English value has a real gap.
const NINE = ["es", "fr", "pt", "it", "ru", "zh", "ja", "ko", "ar"];
const gaps = new Set();
for (const key of Object.keys(F.en)) {
  const en = F.en[key];
  if (typeof en !== "string" || en.trim() === "") continue;
  if (F.de[key] === en) continue; // German also keeps it → brand/name
  for (const l of NINE) {
    if (F[l][key] === en) {
      gaps.add(key);
      break;
    }
  }
}

console.log("gap keys:", gaps.size);
const byNs = {};
for (const key of gaps) {
  const ns = key.split(".")[0];
  byNs[ns] = (byNs[ns] ?? 0) + 1;
}
console.log("by namespace:", JSON.stringify(byNs, null, 0));
console.log("value length: max =", Math.max(...[...gaps].map((k) => F.en[k].length)));

const perLocale = NINE.map((l) => ({
  l,
  n: [...gaps].filter((k) => F[l][k] === F.en[k]).length,
}));
console.log("missing per locale:", perLocale.map((x) => `${x.l}:${x.n}`).join(" "));

console.log("\n=== keys and English values ===");
for (const key of [...gaps].sort()) console.log(`${key}\t${F.en[key]}`);