import { envOrNull } from "@/lib/env";
import type { PerfilUser } from "./types";

/** Upper bound for any single third-party request, in milliseconds. */
const FETCH_TIMEOUT_MS = 15_000;


const DEFAULT_PERFIL = "https://www.badges.blog/api/perfil";
const GQL_URL = "https://gql.twitch.tv/gql";
const GQL_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";

interface RawPerfilBadge {
  setID?: string;
  version?: string | number;
  title?: string | null;
  description?: string | null;
  image1x?: string | null;
  image2x?: string | null;
  image4x?: string | null;
  clickAction?: string | null;
  clickURL?: string | null;
}

interface RawPerfilUser {
  id?: string | number;
  login?: string;
  displayName?: string;
  display_name?: string;
  profileImageURL?: string;
  profile_image_url?: string;
  createdAt?: string;
  created_at?: string;
  isAffiliate?: boolean;
  badges?: RawPerfilBadge[];
}

function normalize(raw: RawPerfilUser | null | undefined): PerfilUser {
  // Both upstream bodies are cast, not validated: a response of {"badges": {}}
  // (or a literal null) made `.map` a TypeError. Degrade to "no badges" instead —
  // the profile page turns an escaping throw into a 404.
  const user: RawPerfilUser =
    raw && typeof raw === "object" ? raw : {};
  const list = Array.isArray(user.badges) ? user.badges : [];
  return {
    id: String(user.id ?? ""),
    login: String(user.login ?? ""),
    displayName: String(user.displayName ?? user.display_name ?? user.login ?? ""),
    profileImageURL: String(
      user.profileImageURL ?? user.profile_image_url ?? "",
    ),
    createdAt: user.createdAt ?? user.created_at ?? null,
    isAffiliate: user.isAffiliate,
    badges: list.map((b) => ({
      setID: String(b.setID ?? ""),
      version: String(b.version ?? "1"),
      title: b.title ?? null,
      description: b.description ?? null,
      image1x: b.image1x ?? null,
      image2x: b.image2x ?? null,
      image4x: b.image4x ?? null,
      clickAction: b.clickAction ?? null,
      clickURL: b.clickURL ?? null,
    })),
  };
}

async function fetchFromBadgesBlog(
  login: string,
  revalidate: number,
): Promise<PerfilUser> {
  const base = envOrNull("BADGESBLOG_PERFIL_URL") ?? DEFAULT_PERFIL;
  const url = `${base}?username=${encodeURIComponent(login)}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: "application/json" },
    next: { revalidate },
  });
  if (!res.ok) {
    throw new Error(`badges.blog perfil failed: ${res.status} for ${login}`);
  }
  return normalize((await res.json()) as RawPerfilUser);
}

/**
 * Fallback: query Twitch's GQL user-badges directly (the same upstream that
 * badges.blog proxies). Used automatically when badges.blog is unreachable.
 */
async function fetchFromGql(login: string, revalidate: number): Promise<PerfilUser> {
  const query = `query($login: String!) { user(login: $login) { id login displayName profileImageURL createdAt badges { setID version title description image1x image2x image4x clickAction clickURL } } }`;
  const res = await fetch(envOrNull("TWITCH_GQL_URL") ?? GQL_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    method: "POST",
    headers: {
      "client-id": envOrNull("TWITCH_GQL_CLIENT_ID") ?? GQL_CLIENT_ID,
      "content-type": "application/json",
    },
    body: JSON.stringify([{ query, variables: { login } }]),
    // Honour the caller's window: with `revalidate: 0` an upstream badges.blog
    // outage — the exact condition this fallback exists for — turned every view
    // of every non-member profile into an uncached call to gql.twitch.tv.
    next: { revalidate },
  });
  if (!res.ok) {
    throw new Error(`Twitch GQL failed: ${res.status}`);
  }
  const payload = (await res.json()) as
    | Array<{ data?: { user?: RawPerfilUser | null } }>
    | null;
  const user = Array.isArray(payload) ? payload[0]?.data?.user : undefined;
  if (!user) {
    throw new Error(`Twitch GQL: user "${login}" not found`);
  }
  return normalize(user);
}

/**
 * Resolve the full list of badges a Twitch user owns (global + their own
 * channel badges), live. Primary source: badges.blog /api/perfil (as
 * requested); automatic fallback: Twitch GQL directly.
 */
export async function fetchUserBadges(
  login: string,
  revalidate = 300,
): Promise<PerfilUser> {
  const clean = login.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,25}$/.test(clean)) {
    throw new Error(`Invalid Twitch login: ${login}`);
  }
  try {
    return await fetchFromBadgesBlog(clean, revalidate);
  } catch (error) {
    console.warn(
      `[perfil] badges.blog failed for ${clean}, trying Twitch GQL:`,
      error instanceof Error ? error.message : error,
    );
    return fetchFromGql(clean, revalidate);
  }
}
