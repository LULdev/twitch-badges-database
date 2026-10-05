/**
 * i18n gate — exits non-zero, so `npm run build` fails before a bad deploy.
 *
 * Four checks:
 *  A) every `useTranslations("ns")` in a "use client" file ships to the
 *     client: its top-level namespace must be in CLIENT_NAMESPACES
 *     ([locale]/layout.tsx). This is the BadgeReactions bug class: the page
 *     rendered (server components read the full catalog via
 *     getTranslations) while the client component logged MISSING_MESSAGE and
 *     served raw key paths as aria-labels. next-intl 4.x NEVER throws on
 *     missing messages — it console.errors and returns the key path — and the
 *     [locale] layout reads cookies(), so pages are dynamic and never render
 *     during `next build`. Log-scraping cannot catch this.
 *  B) every literal translator key resolves in ALL 11 locale catalogs.
 *  C) catalog parity: the flattened key set is identical across locales.
 *  D) every game id in GAMES carries Title/Desc/Hint in all locales — the
 *     game pages build those keys dynamically, so Check B cannot see them.
 *
 * Dynamic keys (t(`x.${v}`), t(map[k] ?? "fallback")) are warn-only.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const LOCALES = [
  "en", "pt", "es", "fr", "de", "ru", "zh", "ar", "ja", "it", "ko",
];

type Flat = Set<string>;

function flatten(value: unknown, prefix = "", out: Flat = new Set()): Flat {
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      flatten(v, prefix ? `${prefix}.${k}` : k, out);
    }
  } else {
    out.add(prefix);
  }
  return out;
}

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (/\.(ts|tsx)$/.test(entry)) files.push(full);
  }
  return files;
}

/* ---------- catalogs ---------- */
const catalogs = new Map<string, Flat>();
for (const locale of LOCALES) {
  catalogs.set(
    locale,
    flatten(JSON.parse(readFileSync(path.join(ROOT, "messages", `${locale}.json`), "utf8"))),
  );
}

/* ---------- client namespace subset from the layout ---------- */
const layoutSrc = readFileSync(
  path.join(ROOT, "src", "app", "[locale]", "layout.tsx"),
  "utf8",
);
const nsMatch = layoutSrc.match(/CLIENT_NAMESPACES\s*=\s*\[([^\]]*)\]/);
if (!nsMatch) {
  console.error("i18n: could not parse CLIENT_NAMESPACES from [locale]/layout.tsx");
  process.exit(1);
}
const clientNamespaces = new Set(
  [...nsMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]),
);

/* ---------- source sweep ---------- */
const errors: string[] = [];
const warnings: string[] = [];

for (const file of walk(path.join(ROOT, "src"))) {
  const rel = path.relative(ROOT, file);
  const src = readFileSync(file, "utf8");
  const isClient = /^["']use client["']/m.test(src);

  // Translator declarations: getTranslations("ns") / useTranslations("ns") /
  // getTranslations({ locale, namespace: "ns" }). A variable name can carry
  // SEVERAL namespaces across scopes (generateMetadata and the page both
  // declare `t`), so collect a set per name; a key passes when it resolves
  // under any of them.
  const nsByVar = new Map<string, Set<string>>();
  const addNs = (varName: string, ns: string) => {
    if (!nsByVar.has(varName)) nsByVar.set(varName, new Set());
    nsByVar.get(varName)!.add(ns);
  };
  for (const m of src.matchAll(
    /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:get|use)Translations\(\s*(?:"([^"]+)"|\{\s*[^}]*namespace:\s*"([^"]+)")[^)]*\)/g,
  )) {
    addNs(m[1], m[2] ?? m[3]);
  }
  // Destructured Promise.all batches: `const [sp, t] = await Promise.all([
  // searchParams, getTranslations("badges") ])` — non-translator entries sit in
  // the same array, so pairing is by INDEX: a getTranslations at argument
  // position i belongs to destructured variable i.
  for (const m of src.matchAll(
    /const\s*\[([^\]]+)\]\s*=\s*(?:await\s+)?Promise\.all\(\s*\[([\s\S]*?)\]\s*\)/g,
  )) {
    const vars = m[1].split(",").map((v) => v.trim());
    // top-level comma split (depth-aware for nested parens/brackets/braces)
    const args: string[] = [];
    let depth = 0;
    let current = "";
    for (const ch of m[2]) {
      if ("([{".includes(ch)) depth++;
      if (")]}".includes(ch)) depth--;
      if (ch === "," && depth === 0) {
        args.push(current);
        current = "";
      } else current += ch;
    }
    if (current.trim()) args.push(current);
    args.forEach((arg, i) => {
      const call = arg.match(/getTranslations\(\s*(?:"([^"]+)"|\{\s*[^}]*namespace:\s*"([^"]+)")/);
      if (call && vars[i]) addNs(vars[i], call[1] ?? call[2]);
    });
  }
  if (nsByVar.size === 0) continue;

  // Check A: client files' namespaces must be shipped by the provider.
  if (isClient) {
    for (const [varName, namespaces] of nsByVar) {
      for (const ns of namespaces) {
        const top = ns.split(".")[0];
        if (!clientNamespaces.has(top)) {
          errors.push(
            `${rel}: ${varName} = useTranslations("${ns}") in a client component, but "${top}" is not in CLIENT_NAMESPACES (src/app/[locale]/layout.tsx)`,
          );
        }
      }
    }
  }

  // Check B: literal keys must resolve in every locale.
  for (const [varName, namespaces] of nsByVar) {
    // Built from plain strings: a raw backtick inside the pattern would
    // terminate a template literal, and the lookbehind stops identifiers
    // merely ENDING in the var name (st(, count() …) from matching t(.
    const callRe = new RegExp(
      "(?<![\\w.$])" + varName + "\\(\\s*([\"'`])((?:[^\"'`\\\\]|\\\\.)*)\\1",
      "g",
    );
    for (const m of src.matchAll(callRe)) {
      const key = m[2];
      if (!key || key.includes("${")) {
        warnings.push(`${rel}: dynamic translator key via ${varName} — verify manually`);
        continue;
      }
      for (const locale of LOCALES) {
        const catalog = catalogs.get(locale)!;
        const resolves = [...namespaces].some((ns) => catalog.has(`${ns}.${key}`));
        if (!resolves) {
          errors.push(
            `${rel}: ${varName}("${key}") resolves under none of [${[...namespaces].join(", ")}] in messages/${locale}.json`,
          );
        }
      }
    }
    // Computed keys (t(map[k]), t(`tpl${x}`)) can't be checked statically.
    const dynamic = new RegExp("(?<![\\w.$])" + varName + "\\(\\s*(?![\"'`])", "g");
    if (dynamic.test(src)) {
      warnings.push(`${rel}: non-literal argument to ${varName}() — verify manually`);
    }
  }
}

/* ---------- Check C: parity across locales ---------- */
const reference = catalogs.get("en")!;
for (const locale of LOCALES.slice(1)) {
  const set = catalogs.get(locale)!;
  for (const key of reference) {
    if (!set.has(key)) errors.push(`parity: messages/${locale}.json is missing "${key}"`);
  }
  for (const key of set) {
    if (!reference.has(key)) errors.push(`parity: messages/${locale}.json has extra "${key}"`);
  }
}

/* ---------- Check D: every game id carries Title/Desc/Hint in all locales ----------
 * The game pages build keys dynamically — t(`${game}Title`), t(`${game}Desc`),
 * t(`${game}Hint`) — which Check B can only warn about. A game added to GAMES
 * without its copy would render raw key paths on the login wall, so resolve
 * the registry itself: parse the id fields out of the GAMES array and require
 * the three keys per game in every locale. */
const gamesSrc = readFileSync(
  path.join(ROOT, "src", "lib", "gamification", "games.ts"),
  "utf8",
);
const gamesArrayStart = gamesSrc.indexOf("export const GAMES");
const gamesArrayEnd = gamesSrc.indexOf("export const GAME_IDS");
if (gamesArrayStart < 0 || gamesArrayEnd <= gamesArrayStart) {
  errors.push("games: could not locate the GAMES array in src/lib/gamification/games.ts");
} else {
  const gamesSlice = gamesSrc.slice(gamesArrayStart, gamesArrayEnd);
  const gameIds = [...gamesSlice.matchAll(/\{\s*id:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]);
  if (gameIds.length === 0) {
    errors.push("games: could not parse any game ids from the GAMES array — verify manually");
  }
  for (const locale of LOCALES) {
    const catalog = catalogs.get(locale)!;
    for (const id of gameIds) {
      for (const suffix of ["Title", "Desc", "Hint"]) {
        const key = `games.${id}${suffix}`;
        if (!catalog.has(key)) {
          errors.push(`games: messages/${locale}.json is missing "${key}" (every game id needs Title/Desc/Hint)`);
        }
      }
    }
  }
}

for (const w of [...new Set(warnings)]) console.warn(`i18n warn: ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`i18n: ${e}`);
  console.error(`\ni18n: ${errors.length} error(s), ${new Set(warnings).size} warning(s)`);
  process.exit(1);
}
console.log(`i18n: OK — ${clientNamespaces.size} client namespaces, 11 locales in parity`);
