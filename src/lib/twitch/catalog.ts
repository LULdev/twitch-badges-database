import { fetchGlobalBadgesHelix } from "./helix";
import { fetchGlobalBadgesIvr } from "./ivr";
import type { BadgeSetSource } from "./types";

/** Fetch the definitive global badge catalog: official Helix when app
 *  credentials are configured, otherwise the public IVR mirror. */
export async function fetchGlobalBadgeCatalog(): Promise<{
  sets: BadgeSetSource[];
  source: "helix" | "ivr";
}> {
  try {
    const helix = await fetchGlobalBadgesHelix();
    if (helix) return { sets: helix, source: "helix" };
  } catch (error) {
    console.warn("[catalog] Helix failed, falling back to IVR:", error);
  }
  return { sets: await fetchGlobalBadgesIvr(), source: "ivr" };
}
