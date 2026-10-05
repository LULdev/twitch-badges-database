/**
 * Dead-code gate (suggestion-2 follow-up to the 20-agent sweep).
 *
 * Scans for code that nothing references and exits non-zero (so a workflow can
 * fail) when NEW dead code appears — items already known are pinned in
 * scripts/code-health.allowlist.json and do not fail the gate.
 *
 * Checks:
 *  A) Unused exports — `export function/const/interface/type/class NAME` where
 *     NAME occurs in no other file under src/ or scripts/. Dynamic use (a name
 *     built at runtime: t(`x.${k}`), object[key], rpc(name)) can make a symbol
 *     live without a textual reference, so every hit is cross-checked against
 *     the allowlist before it fails; reviewers confirm or allowlist.
 *  B) Unreferenced i18n keys — a top-level messages/en.json key whose name
 *     never appears in src/ (as a literal or as part of a t(`${...}`) family).
 *     The dynamic families the check cannot see are enumerated in the
 *     allowlist's dynamicKeys so they never false-positive.
 *  C) Unused npm dependencies — a package.json runtime dep never imported
 *     under src/ or scripts/ by its package name.
 *  D) The overview: zero css class / workflow / route checks — those were
 *     clean in the sweep and Tailwind v4 scans text, so C alone covers deps.
 *
 * Usage:
 *   npm run health:check            # exit 1 if NEW dead code is found
 *   npm run health:refresh          # rewrite the allowlist from current findings
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const ALLOWLIST_PATH = path.join(ROOT, "scripts", "code-health.allowlist.json");
const REFRESH = process.argv.includes("--refresh");

function fsExists(f: string): boolean {
  try {
    return statSync(f).isFile();
  } catch {
    return false;
  }
}

const files: string[] = [];
(function walk(dir: string) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === ".git" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(ts|tsx)$/.test(entry)) files.push(full);
  }
})(path.join(ROOT, "src"));
(function walkScripts(dir: string) {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walkScripts(full);
    else if (/\.(ts|tsx|mjs|cjs)$/.test(entry)) files.push(full);
  }
})(path.join(ROOT, "scripts"));

const read = (p: string) => readFileSync(p, "utf8");

/* ---------- A: unused exports ---------- */
const EXPR = /\bexport\s+(?:async\s+)?(?:function|const|let|interface|type|class)\s+([A-Za-z_$][\w$]*)/g;
const unusedExports: Array<{ name: string; file: string }> = [];
const exportByName = new Map<string, Array<{ name: string; file: string }>>();
for (const f of files.filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))) {
  const rel = path.relative(path.join(ROOT, "src"), f).replace(/\\/g, "/");
  for (const m of read(f).matchAll(EXPR)) {
    exportByName.set(m[1], [...(exportByName.get(m[1]) ?? []), { name: m[1], file: rel }]);
  }
}
for (const [name, decls] of exportByName) {
  // Count FILES that contain the name (not occurrences): a definition file can
  // reference the symbol many times internally; it is dead only when NO OTHER
  // file mentions it at all.
  const mentions = files.filter((f) => read(f).includes(name));
  if (mentions.length <= 1) {
    for (const d of decls) unusedExports.push(d);
  }
}
// Prune self-referential twins (a type used only to type its owner's own
// signature still shows up in one file): those are covered by mentioning in
// ONE file — which we already count. The >1 check above is the real gate.

/* ---------- B: unreferenced i18n keys (en is the reference catalog) ---------- */
const enCatalog = JSON.parse(read(path.join(ROOT, "messages", "en.json"))) as Record<string, Record<string, string>>;
const i18nKeys: Array<{ namespace: string; key: string }> = [];
{
  const srcJoined = files.filter((f) => f.includes(`${path.sep}src${path.sep}`) || f.includes(`${path.sep}src`)).map(read).join("\n");
  // Dynamic key families the literal scan cannot see: t(`${game.id}Desc`),
  // t(`${role}Hint`), t(`tier${n}`), t(map[k] ?? "x"), t(`key${v}`). A key
  // whose TAIL (last camelCase word, e.g. "Desc", "Hint", "Title", "A") matches
  // a dynamic template fragment in source is reachable. Collect the suffixes
  // next-intl templates build: `...${...}Suffix` forms.
  const dynamicTails = new Set<string>();
  for (const m of srcJoined.matchAll(/`[^`]*\$\{[^}]+\}([A-Za-z_$][\w$]*)`/g)) {
    dynamicTails.add(m[1]);
  }
  for (const [ns, members] of Object.entries(enCatalog)) {
    if (!members || typeof members !== "object") continue;
    for (const key of Object.keys(members)) {
      // Literal use: `t("key")` / t('key') / t(`key`) — exact quoted name.
      const literalRe = new RegExp(`["'\`]${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`]`);
      if (literalRe.test(srcJoined)) continue;
      // Dynamic-family use: the key's tail is built from a template fragment.
      const tail = key.match(/[A-Z][a-z0-9]*$/)?.[0] ?? key;
      if (dynamicTails.has(tail)) continue;
      i18nKeys.push({ namespace: ns, key });
    }
  }
}

/* ---------- C: unused npm deps ---------- */
const pkg = JSON.parse(read(path.join(ROOT, "package.json"))) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const unusedDeps: string[] = [];
const srcScripts = files.map(read).join("\n");
// Config files (eslint, tsconfig, postcss) legitimately mention tooling deps
// without importing them — fold their text into the reference corpus so a
// devDep used only there is not flagged.
const configText = [
  "eslint.config.mjs", "postcss.config.mjs", "tsconfig.json", "next.config.ts",
  "next.config.mjs", "package.json",
]
  .filter((f) => fsExists(path.join(ROOT, f)))
  .map((f) => read(path.join(ROOT, f)))
  .join("\n");
const depCorpus = `${srcScripts}\n${configText}`;
for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
  const importRe = new RegExp(`(?:from\\s*["']|import\\s*\\(\\s*["']|require\\(\\s*["'])${dep.replace(/[-/\\^$.*+?()[\]{}|]/g, "\\$&")}(?:/|["'])`);
  const mentioned = importRe.test(depCorpus) || depCorpus.includes(`"${dep}"`) || depCorpus.includes(`'${dep}'`);
  // A runtime dep is dead only when no import references it; a devDep is fine
  // when the configs mention it. Flag either way so the allowlist is explicit.
  if (!mentioned) unusedDeps.push(dep);
}

/* ---------- allowlist ---------- */
const allowlist = JSON.parse(read(ALLOWLIST_PATH)) as {
  exports: string[];
  i18n: Array<{ namespace: string; key: string }>;
  deps: string[];
};

const newExports = unusedExports.filter((e) => !allowlist.exports.includes(`${e.file}:${e.name}`) && !allowlist.exports.includes(e.name));
const newI18n = i18nKeys.filter((k) => !allowlist.i18n.some((a) => a.namespace === k.namespace && a.key === k.key));
const newDeps = unusedDeps.filter((d) => !allowlist.deps.includes(d));

let failures = 0;
const report = (title: string, items: Array<unknown> | Array<{ name: string; file?: string }>, print: (i: unknown | { name: string; file?: string }) => string) => {
  if (items.length === 0) return;
  console.log(`\n## ${title} (${items.length})`);
  for (const i of items) console.log(`  ${print(i)}`);
};
report("Unused exports (new)", newExports, (e) => `${(e as { file: string }).file}: ${(e as { name: string }).name}`);
report("Unreferenced i18n keys (new)", newI18n, (k) => `${(k as { namespace: string }).namespace}.${(k as { key: string }).key}`);
report("Unused npm deps (new)", newDeps, (d) => String(d));
failures = newExports.length + newI18n.length + newDeps.length;

console.log(
  `\ncode-health: ${unusedExports.length} exports, ${i18nKeys.length} i18n keys, ${unusedDeps.length} deps scanned — ` +
    `${failures} NEW finding(s), ${unusedExports.length + i18nKeys.length + unusedDeps.length - failures} allowlisted.`,
);

if (REFRESH) {
  // Merge current findings into the allowlist (dedup) and write it back so the
  // next run only fails on genuinely NEW code. Files are written by an explicit
  // --refresh, never by the gate itself.
  const allExports = unusedExports.map((e) => e.name);
  const allI18n = i18nKeys;
  const allDeps = unusedDeps;
  for (const d of allExports) if (!allowlist.exports.includes(d)) allowlist.exports.push(d);
  for (const k of allI18n) if (!allowlist.i18n.some((a) => a.namespace === k.namespace && a.key === k.key)) allowlist.i18n.push(k);
  for (const d of allDeps) if (!allowlist.deps.includes(d)) allowlist.deps.push(d);
  writeFileSync(ALLOWLIST_PATH, JSON.stringify(allowlist, null, 2) + "\n");
  console.log(`code-health: allowlist refreshed (${allowlist.exports.length} exports, ${allowlist.i18n.length} i18n, ${allowlist.deps.length} deps).`);
}

process.exit(failures > 0 && !REFRESH ? 1 : 0);