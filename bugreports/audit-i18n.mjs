import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

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
const base = new Set(Object.keys(F.en));
const namespaces = new Set(Object.keys(msg.en));

const files = [];
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(e)) files.push(p);
  }
})("src");

// A key is fine if it resolves under ANY namespace that file uses.
const unresolved = [];
const dynamicSites = [];

for (const f of files) {
  const src = readFileSync(f, "utf8");
  const lineAt = (i) => src.slice(0, i).split("\n").length;

  const nsHere = new Set();
  for (const m of src.matchAll(/(?:get|use)Translations\(\s*(?:\{[^}]*namespace:\s*)?["'`]([A-Za-z0-9_]+)["'`]/g)) {
    nsHere.add(m[1]);
  }
  if (nsHere.size === 0) continue;

  const transVars = new Set();
  for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:get|use)Translations\(/g)) {
    transVars.add(m[1]);
  }

  for (const v of transVars) {
    const esc = v.replace(/\$/g, "\\$");
    const lit = new RegExp("\\b" + esc + "\\(\\s*[\"'`]([A-Za-z0-9_.\\-/]+)[\"'`]", "g");
    let m;
    while ((m = lit.exec(src)) !== null) {
      const key = m[1];
      const ok = [...nsHere].some((ns) => base.has(ns + "." + key));
      if (!ok) unresolved.push(f + ":" + lineAt(m.index) + "  t(\"" + key + "\")  ns=" + [...nsHere].join(","));
    }
    const dyn = new RegExp("\\b" + esc + "\\(\\s*`([^`]*\\$\\{)", "g");
    while ((m = dyn.exec(src)) !== null) {
      dynamicSites.push(f + ":" + lineAt(m.index) + "  " + v + "(`" + m[1].trim() + "…`)  ns=" + [...nsHere].join(","));
    }
    const byVar = new RegExp("\\b" + esc + "\\(\\s*([A-Za-z_$][\\w$.]*)\\s*[,)]", "g");
    while ((m = byVar.exec(src)) !== null) {
      if (["true", "false", "null", "undefined"].includes(m[1])) continue;
      dynamicSites.push(f + ":" + lineAt(m.index) + "  " + v + "(" + m[1] + ")  ns=" + [...nsHere].join(","));
    }
  }
}

console.log("=== A) literal keys that resolve under NO namespace of their file ===");
if (!unresolved.length) console.log("none");
for (const u of [...new Set(unresolved)]) console.log("   " + u);

console.log("\n=== B) dynamic key sites (manual verification needed) ===");
if (!dynamicSites.length) console.log("none");
for (const d of [...new Set(dynamicSites)]) console.log("   " + d);

console.log("\n=== C) untranslated: value identical to English ===");
const noise = /^(?:BadgesCoins?|XP|Turbo|Twitch|Twitch Badges Database|EN|DE|FR|ES|PT|IT|RU|ZH|JA|KO|AR|O|OK)$/;
let total = 0;
for (const l of LOCALES) {
  if (l === "en") continue;
  const same = Object.entries(F[l]).filter(
    ([k, v]) =>
      typeof v === "string" &&
      typeof F.en[k] === "string" &&
      v === F.en[k] &&
      v.length > 14 &&
      !noise.test(v) &&
      /[a-z]{3}/.test(v),
  );
  if (same.length) {
    total += same.length;
    console.log("\n  " + l + ": " + same.length);
    for (const [k, v] of same) console.log("     " + k + " = " + v.slice(0, 90));
  }
}
console.log("\ntotal identical-to-English strings:", total);