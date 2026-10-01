/**
 * Renders the arcade's 13 per-game covers from GameArt.tsx into standalone
 * SVG files under public/games/art/, so hub tiles, detail heroes and blog
 * covers all read markup rendered from the SAME component. Re-run whenever
 * GameArt.tsx or GAME_COLORS changes:
 *
 *   npx tsx scripts/export-game-art.ts
 *
 * Standalone files have no site cascade, so the script bakes what CSS
 * resolves at runtime: the per-game hue as the root `color` attr (mirrors
 * `.gg-art svg { color: var(--gg-color) }`), and var(--success) as its
 * literal dark-theme value. NB: ids come from GAME_COLORS, NOT
 * @/lib/gamification/games — the registry transitively imports
 * next/server + the Supabase admin client, which have no place in Node-land.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const OUT_DIR = resolve("public", "games", "art");
/** globals.css :root — dark-first site; the vault arc's green zone. */
const SUCCESS = "#34d399";

async function main(): Promise<void> {
  const { default: GameArt, GAME_COLORS } = await import(
    "@/components/games/GameArt"
  );

  mkdirSync(OUT_DIR, { recursive: true });

  for (const id of Object.keys(GAME_COLORS)) {
    const hue = GAME_COLORS[id];
    if (!hue) throw new Error(`GAME_COLORS is missing a hue for '${id}'`);

    let markup = renderToStaticMarkup(
      React.createElement(GameArt, { id }),
    );

    // 1) Standalone XML needs the namespace (React SSR omits it).
    // 2) Bake the hue: `color` inherits, so every currentColor in the art
    //    (root stroke + inner fills) resolves against it, same as --gg-color.
    markup = markup.replace(
      "<svg ",
      `<svg xmlns="http://www.w3.org/2000/svg" color="${hue}" `,
    );

    // 3) var(--success) cannot resolve in a standalone document — it would
    //    compute to the inherited currentColor, silently recoloring the arc.
    markup = markup.replaceAll("var(--success)", SUCCESS);

    // Drift guard: nothing else may depend on cascade context.
    if (markup.includes("var(")) {
      throw new Error(
        `GameArt '${id}' now emits an unresolvable var() — bake it above`,
      );
    }

    const file = resolve(OUT_DIR, `${id}.svg`);
    writeFileSync(file, markup + "\n", "utf8");
    console.log(`wrote ${file} (${markup.length} bytes)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
