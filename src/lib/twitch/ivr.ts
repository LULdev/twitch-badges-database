import { envOrNull } from "@/lib/env";
import type { BadgeSetSource } from "./types";

const DEFAULT_API = "https://api.ivr.fi/v2/twitch/badges";

interface IvrVersion {
  id: string;
  image_url_1x: string | null;
  image_url_2x: string | null;
  image_url_4x: string | null;
  title: string | null;
  description: string | null;
  click_action: string | null;
  click_url: string | null;
}

interface IvrSet {
  set_id: string;
  versions: IvrVersion[];
}

/** No-auth mirror of Helix /chat/badges/global — fallback catalog source. */
export async function fetchGlobalBadgesIvr(): Promise<BadgeSetSource[]> {
  const base = envOrNull("IVR_API_URL") ?? DEFAULT_API;
  const res = await fetch(`${base}/global`, {
    headers: { accept: "application/json" },
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    throw new Error(`ivr.fi /global failed: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as unknown;
  const list = Array.isArray(json) ? json : (json as { data?: unknown }).data;
  if (!Array.isArray(list)) {
    throw new Error("ivr.fi /global: unexpected format");
  }
  return (list as IvrSet[]).map((set) => ({
    setId: set.set_id,
    versions: (set.versions ?? []).map((v) => ({
      setId: set.set_id,
      version: String(v.id),
      title: v.title,
      description: v.description,
      imageUrl1x: v.image_url_1x,
      imageUrl2x: v.image_url_2x,
      imageUrl4x: v.image_url_4x,
      clickAction: v.click_action,
      clickUrl: v.click_url,
    })),
  }));
}
