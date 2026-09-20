import { envOrNull } from "@/lib/env";
import type { BadgeSetSource } from "./types";

const HELIX_BASE = "https://api.twitch.tv/helix";
const PUBLIC_WEB_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";

interface AppTokenResponse {
  access_token?: string;
  expires_in?: number;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAppAccessToken(): Promise<string | null> {
  const clientId = envOrNull("TWITCH_CLIENT_ID");
  const clientSecret = envOrNull("TWITCH_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;

  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
  });
  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Twitch token endpoint failed: ${res.status}`);
  }
  const json = (await res.json()) as AppTokenResponse;
  if (!json.access_token) return null;

  cachedToken = {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  return cachedToken.token;
}

function mapSets(
  data: Array<{
    set_id: string;
    versions: Array<{
      id: string;
      title?: string | null;
      description?: string | null;
      image_url_1x?: string | null;
      image_url_2x?: string | null;
      image_url_4x?: string | null;
      click_action?: string | null;
      click_url?: string | null;
    }>;
  }>,
): BadgeSetSource[] {
  return data.map((set) => ({
    setId: set.set_id,
    versions: (set.versions ?? []).map((v) => ({
      setId: set.set_id,
      version: String(v.id),
      title: v.title ?? null,
      description: v.description ?? null,
      imageUrl1x: v.image_url_1x ?? null,
      imageUrl2x: v.image_url_2x ?? null,
      imageUrl4x: v.image_url_4x ?? null,
      clickAction: v.click_action ?? null,
      clickUrl: v.click_url ?? null,
    })),
  }));
}

/**
 * Fetch the global chat badge catalog from the official Helix API using an
 * app access token (client credentials). Returns null when no own Twitch app
 * credentials are configured — callers fall back to the IVR mirror.
 */
export async function fetchGlobalBadgesHelix(): Promise<BadgeSetSource[] | null> {
  const token = await getAppAccessToken();
  if (!token) return null;

  const clientId = envOrNull("TWITCH_CLIENT_ID") ?? PUBLIC_WEB_CLIENT_ID;
  const res = await fetch(`${HELIX_BASE}/chat/badges/global`, {
    headers: {
      "client-id": clientId,
      authorization: `Bearer ${token}`,
      accept: "application/json",
    },
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    throw new Error(`Helix global badges failed: ${res.status}`);
  }
  const json = (await res.json()) as { data?: Parameters<typeof mapSets>[0] };
  return mapSets(json.data ?? []);
}
