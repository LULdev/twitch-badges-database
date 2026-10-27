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
 *  E) ICU placeholder parity: every key's argument-name set must match en.
 *     A locale that drops {pct} renders a sentence with a hole — silently,
 *     because next-intl never throws. Plural/select/selectordinal branch
 *     interiors are skipped (CJK legitimately drops plurals, so interiors
 *     cannot be compared cross-locale); typed args ({price, number}) count
 *     by NAME (en ships plain {price} today).
 *  F) content blocklist: known-bad strings from the twice-burned Korean
 *     incident class (wrong syllable 룈 U+B8C8 vs 번 U+BC88, the 코뮤니티
 *     misspelling) and lone UTF-16 surrogates from malformed \uXXXX escapes.
 *  G) double ASCII spaces inside values (copy-paste debris).
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

/** Same walk, but keeps the VALUES — Checks E/F/G inspect message text. */
type FlatValues = Map<string, string>;
function flattenValues(
  value: unknown,
  prefix = "",
  out: FlatValues = new Map(),
): FlatValues {
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      flattenValues(v, prefix ? `${prefix}.${k}` : k, out);
    }
  } else {
    out.set(prefix, typeof value === "string" ? value : String(value));
  }
  return out;
}

/**
 * Top-level ICU argument NAMES of a message. plural/select/selectordinal
 * blocks are skipped WHOLE after recording their argument name: their branch
 * interiors may legitimately differ per locale (CJK drops plurals), so nested
 * placeholders inside branches cannot be compared cross-locale — a naive
 * {…} regex over the catalogs produces ~99 false mismatches from exactly
 * those interiors. Typed simple args ({price, number}) count by NAME.
 */
function icuArgNames(value: string): Set<string> {
  const names = new Set<string>();
  let i = 0;
  const skipBalanced = () => {
    // Consumes up to and including the closing brace matching an already
    // consumed '{' (depth starts at 1).
    let depth = 1;
    while (i < value.length && depth > 0) {
      if (value[i] === "{") depth++;
      else if (value[i] === "}") depth--;
      i++;
    }
  };
  while (i < value.length) {
    if (value[i] !== "{") {
      i++;
      continue;
    }
    i++; // past '{'
    let name = "";
    while (i < value.length && value[i] !== "," && value[i] !== "}") {
      name += value[i];
      i++;
    }
    name = name.trim();
    if (i >= value.length) break;
    if (value[i] === "}") {
      i++;
      if (name) names.add(name);
      continue;
    }
    i++; // past ','
    while (i < value.length && value[i] === " ") i++;
    let fn = "";
    while (i < value.length && /[a-zA-Z]/.test(value[i])) {
      fn += value[i];
      i++;
    }
    if (fn === "plural" || fn === "select" || fn === "selectordinal") {
      // The branch argument itself IS a message argument; the interiors are
      // not comparable cross-locale and are skipped whole.
      if (name) names.add(name);
      skipBalanced();
    } else {
      // Typed simple arg ({price, number}) or unknown function: record the
      // name, consume to the closing brace defensively.
      if (name) names.add(name);
      skipBalanced();
    }
  }
  return names;
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
const valueCatalogs = new Map<string, FlatValues>();
for (const locale of LOCALES) {
  const parsed = JSON.parse(
    readFileSync(path.join(ROOT, "messages", `${locale}.json`), "utf8"),
  );
  catalogs.set(locale, flatten(parsed));
  valueCatalogs.set(locale, flattenValues(parsed));
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

/* ---------- Check E: ICU placeholder parity (en is the reference) ---------- */
{
  const ref = valueCatalogs.get("en")!;
  for (const locale of LOCALES.slice(1)) {
    const vals = valueCatalogs.get(locale)!;
    for (const [key, refValue] of ref) {
      const value = vals.get(key);
      if (value === undefined) continue; // Check C owns missing keys
      const a = [...icuArgNames(refValue)].sort().join(",");
      const b = [...icuArgNames(value)].sort().join(",");
      if (a !== b) {
        errors.push(
          `placeholders: messages/${locale}.json "${key}" uses {${b || "none"}} but en uses {${a || "none"}}`,
        );
      }
    }
  }
}

/* ---------- Check F: known-bad content blocklist + lone surrogates ----------
 * The twice-burned Korean incident class: a hand-typed \uXXXX escape shipped
 * the wrong syllable (룈 U+B8C8 where 번 U+BC88 was meant) and a misspelling
 * (코뮤니티 for 커뮤니티) into the live catalog — invisible to every other
 * check because the keys and placeholders were perfectly fine. */
{
  const BLOCKLIST = ["룈", "이룈", "코뮤니티"];
  for (const [locale, vals] of valueCatalogs) {
    for (const [key, value] of vals) {
      for (const bad of BLOCKLIST) {
        if (value.includes(bad)) {
          errors.push(
            `blocklist: messages/${locale}.json "${key}" contains known-bad "${bad}"`,
          );
        }
      }
      for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff) {
          const next = i + 1 < value.length ? value.charCodeAt(i + 1) : 0;
          if (next >= 0xdc00 && next <= 0xdfff) i++; // valid surrogate pair
          else
            errors.push(
              `blocklist: messages/${locale}.json "${key}" contains a lone high surrogate (malformed \\uXXXX escape?)`,
            );
        } else if (code >= 0xdc00 && code <= 0xdfff) {
          errors.push(
            `blocklist: messages/${locale}.json "${key}" contains a lone low surrogate (malformed \\uXXXX escape?)`,
          );
        }
      }
    }
  }
}

/* ---------- Check G: double ASCII spaces inside values ---------- */
for (const [locale, vals] of valueCatalogs) {
  for (const [key, value] of vals) {
    if (value.includes("  ")) {
      errors.push(`style: messages/${locale}.json "${key}" contains a double space`);
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
