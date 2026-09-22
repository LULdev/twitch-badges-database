import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const files = [];
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(e)) files.push(p);
  }
})("src");

const rel = (p) => relative(process.cwd(), p).replace(/\\/g, "/");
const read = (p) => readFileSync(p, "utf8");

console.log("=== 1) admin/service-role modules imported from client components ===");
const ADMIN_MODULES = ["/supabase/admin", "/lib/health", "/lib/push", "/gamification/xp", "/gamification/achievements", "/gamification/daily", "/gamification/wheel", "/gamification/games", "/lib/inventory", "/lib/changelog", "/lib/blog", "/lib/syncs/"];
const clientFiles = files.filter((f) => /^["']use client["'];/.test(read(f).trimStart()));
console.log("client components found:", clientFiles.length);
let adminViolation = 0;
for (const f of clientFiles) {
  const src = read(f);
  for (const m of src.matchAll(/from\s+["'](@\/[^"']+)["']/g)) {
    if (ADMIN_MODULES.some((a) => m[1].includes(a))) {
      console.log(`   VIOLATION ${rel(f)} imports ${m[1]}`);
      adminViolation++;
    }
  }
}
if (!adminViolation) console.log("   none");

console.log("\n=== 2) transitive: client components importing modules that import admin ===");
// build import graph for src
const graph = new Map();
for (const f of files) {
  const src = read(f);
  const deps = [];
  for (const m of src.matchAll(/from\s+["'](@\/[^"']+)["']/g)) deps.push(m[1]);
  graph.set(rel(f), deps);
}
const target = (spec) => {
  const base = spec.replace(/^@\//, "src/");
  return [base + ".ts", base + ".tsx", base + "/index.ts", base + "/index.tsx"].find((c) =>
    files.map(rel).includes(c),
  );
};
const reachesAdmin = (start, seen = new Set()) => {
  if (seen.has(start)) return false;
  seen.add(start);
  for (const spec of graph.get(start) ?? []) {
    if (ADMIN_MODULES.some((a) => spec.includes(a))) return true;
    const next = target(spec);
    if (next && reachesAdmin(next, seen)) return true;
  }
  return false;
};
let transitive = 0;
for (const f of clientFiles) {
  if (reachesAdmin(rel(f))) {
    console.log("   REACHES ADMIN: " + rel(f));
    transitive++;
  }
}
if (!transitive) console.log("   none");

console.log("\n=== 3) JSON-LD injected with JSON.stringify (needs < escaping) ===");
for (const f of files) {
  const src = read(f);
  if (!src.includes("dangerouslySetInnerHTML")) continue;
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    if (line.includes("dangerouslySetInnerHTML")) {
      const ctx = lines.slice(i, i + 2).join(" ").replace(/\s+/g, " ");
      const raw = /JSON\.stringify\(([^)]+)\)/.exec(ctx);
      const escapeFn = /escapeJson|safeJson|\\u003c|replace\(\/</.test(ctx);
      console.log(`   ${rel(f)}:${i + 1}  ${raw ? "JSON.stringify(" + raw[1] + ")" : ctx.slice(0, 90)}  escaped=${escapeFn}`);
    }
  });
}

console.log("\n=== 4) timers without matching cleanup (client components) ===");
for (const f of clientFiles) {
  const src = read(f);
  const counts = (re) => (src.match(re) ?? []).length;
  const si = counts(/setInterval\(/g);
  const ci = counts(/clearInterval\(/g);
  const to = counts(/setTimeout\(/g);
  const ct = counts(/clearTimeout\(/g);
  const raf = counts(/requestAnimationFrame\(/g);
  const crf = counts(/cancelAnimationFrame\(/g);
  if (si > ci || (raf > 0 && crf === 0) || (to > 0 && ct === 0 && si === 0)) {
    console.log(`   ${rel(f)}  interval ${si}/${ci}  timeout ${to}/${ct}  raf ${raf}/${crf}`);
  }
}

console.log("\n=== 5) fetch() in client components without error handling ===");
for (const f of clientFiles) {
  const src = read(f);
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    if (/\bfetch\(/.test(line) && !/await|\.then|void|return/.test(line)) {
      console.log(`   ${rel(f)}:${i + 1}  ${line.trim().slice(0, 90)}`);
    }
  });
}

console.log("\n=== 6) hardcoded user-visible English strings in JSX (not via t()) ===");
const suspicious = [];
for (const f of clientFiles) {
  const src = read(f);
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    const m = />\s*([A-Z][A-Za-z][A-Za-z ,'’\-!?.]{6,})\s*</.exec(line);
    if (m && !/t\(|\.tsx?["']/.test(line)) suspicious.push(`   ${rel(f)}:${i + 1}  "${m[1].trim()}"`);
  });
}
console.log(suspicious.length ? suspicious.slice(0, 25).join("\n") : "   none");