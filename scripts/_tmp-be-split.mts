import { readFileSync, writeFileSync } from "node:fs";

const src = readFileSync("bugreports/brainstorm-evaluation.html", "utf8");
const starts: number[] = [];
let idx = src.indexOf("<article");
while (idx !== -1) { starts.push(idx); idx = src.indexOf("<article", idx + 1); }
if (starts.length !== 672) throw new Error(`expected 672 articles, got ${starts.length}`);

const blocks: string[] = [];
for (let i = 0; i < starts.length; i++) {
  const end = src.indexOf("</article>", starts[i]);
  if (end === -1) throw new Error(`no close for article ${i}`);
  blocks.push(src.slice(starts[i], end + "</article>".length));
}

// Head = everything before the first article; tail = everything after the last.
const head = src.slice(0, starts[0]);
const lastEnd = src.indexOf("</article>", starts[starts.length - 1]) + "</article>".length;
const tail = src.slice(lastEnd);

// Sanity: head + blocks joined with "\n\n" + tail must reproduce the source
// when the inter-article gaps are normalized — verify block slicing instead:
// every char between blocks must be whitespace only.
for (let i = 1; i < starts.length; i++) {
  const gap = src.slice(starts[i - 1] + blocks[i - 1].length, starts[i]);
  if (gap.trim() !== "") throw new Error(`non-whitespace gap before article ${i}`);
}

const PARTS = 16;
const per = Math.ceil(672 / PARTS);
let written = 0;
for (let p = 0; p < PARTS; p++) {
  const slice = blocks.slice(p * per, (p + 1) * per);
  if (slice.length === 0) break;
  writeFileSync(`bugreports/_be-part-${String(p + 1).padStart(2, "0")}.html`, slice.join("\n\n"), "utf8");
  written += slice.length;
  console.log(`part ${p + 1}: ${slice.length} cards`);
}
writeFileSync("bugreports/_be-head.html", head, "utf8");
writeFileSync("bugreports/_be-tail.html", tail, "utf8");
console.log(`total ${written}/672; head ${head.length} B, tail ${tail.length} B`);