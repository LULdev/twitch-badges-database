import { readFileSync } from "node:fs";
const MARKERS = /\b(der|die|das|und|nicht|für|mit|wurde|wurden|ist|eine|einen|einem|dem|des|auch|werden|bei|auf|aus|nach|vor|dass|sich|noch|nur|wie|mehr|kann|sein|war|aber|oder|alle|durch|ohne|über|unter|beim|diese|dieser|dieses|jetzt|damit|dazu|haben|hatte|sind|kein|keine|schon|seit|wieder|jede|jeder|jedes|ihre|ihren|seine|seinen|als|vom|im|man|muss|müssen|soll|geprüft|geändert|behoben|erneut|statt|eigenen|eigenes|gelöscht|entfernt|hinzugefügt)\b/gi;
const en = [];
for (const i of [1, 2, 3]) en.push(...JSON.parse(readFileSync(`.tmp-en-batch-${i}.json`, "utf8")));
const de = [];
for (const i of [1, 2, 3]) de.push(...JSON.parse(readFileSync(`.tmp-de-batch-${i}.json`, "utf8")));
const deMap = new Map(de.map((r) => [r.id, r]));
console.log(`de: ${de.length}, en: ${en.length}, unique ids: ${new Set(en.map((r) => r.id)).size}`);

const problems = [];
let totalMarkerHits = 0;
for (const r of en) {
  const src = deMap.get(r.id);
  if (!src) { problems.push(`#${r.id}: no German source`); continue; }
  if (typeof r.title !== "string" || typeof r.body !== "string" || r.body.length < 10) problems.push(`#${r.id}: bad shape`);
  // German remnants (allow ≤2 false positives from English homographs like "die", "war", "man")
  const hits = (r.body.match(MARKERS) ?? []).length + (r.title.match(MARKERS) ?? []).length;
  totalMarkerHits += hits;
  if (hits > 2) problems.push(`#${r.id}: ${hits} German markers left`);
  // length sanity: English should be 55%–160% of German
  const ratio = r.body.length / Math.max(1, src.body.length);
  if (ratio < 0.55 || ratio > 1.6) problems.push(`#${r.id}: length ratio ${ratio.toFixed(2)}`);
  // newlines preserved
  const deNl = (src.body.match(/\n/g) ?? []).length;
  const enNl = (r.body.match(/\n/g) ?? []).length;
  if (deNl !== enNl) problems.push(`#${r.id}: newline drift ${deNl}→${enNl}`);
}
console.log(`total German marker hits across 78 rows: ${totalMarkerHits}`);
console.log(problems.length === 0 ? "ALL CHECKS PASS" : `PROBLEMS:\n${problems.join("\n")}`);
