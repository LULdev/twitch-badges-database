import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Site settings, read by the app and written by the admin panel.
 *
 * Every accessor falls back to the constant the code used before the settings
 * existed, so an empty (or un-migrated) `site_settings` table reproduces the
 * previous behaviour exactly — turning the panel on must never silently change
 * the economy.
 *
 * Values are cached for a few seconds because they are read on hot paths (every
 * game play, steal and daily claim). The admin route clears the cache on write,
 * so an operator sees the change immediately; the TTL only bounds the staleness
 * across serverless instances that did not handle the write.
 */

export interface EconomySettings {
  /** Daily login bonus. */
  dailyXp: number;
  dailyCoins: number;
  /** Extra per streak day, and the cap on that extra. */
  streakXpPerDay: number;
  streakXpCap: number;
  streakCoinsPerDay: number;
  streakCoinsCap: number;
  /** XP for a won and a lost game round. */
  gameWinXp: number;
  gameLoseXp: number;
  /** Coins a visitor's coin rain gifts the profile owner. */
  coinRainCoins: number;
  /** Fallback steal settings for members who never configured their own. */
  stealPrice: number;
  stealMax: number;
  /** Flood control. */
  stealFloodMinutes: number;
  stealPerHour: number;
}

export const ECONOMY_DEFAULTS: EconomySettings = {
  dailyXp: 10,
  dailyCoins: 50,
  streakXpPerDay: 5,
  streakXpCap: 50,
  streakCoinsPerDay: 25,
  streakCoinsCap: 250,
  gameWinXp: 10,
  gameLoseXp: 2,
  coinRainCoins: 1,
  stealPrice: 100,
  stealMax: 250,
  stealFloodMinutes: 5,
  stealPerHour: 6,
};

export interface GameSetting {
  enabled: boolean;
  minBet: number;
  maxBet: number;
}

export interface GamesSettings {
  /** Master switch for the whole arcade. */
  enabled: boolean;
  games: Record<string, GameSetting>;
}

export interface FeatureSettings {
  feed: boolean;
  wheel: boolean;
  steals: boolean;
  coinRain: boolean;
  compare: boolean;
  games: boolean;
}

export const FEATURE_DEFAULTS: FeatureSettings = {
  feed: true,
  wheel: true,
  steals: true,
  coinRain: true,
  compare: true,
  games: true,
};

/** One admin/moderator grant stored in site_settings.admins. */
export interface AdminGrant {
  profileId: string;
  username: string;
  role: "moderator" | "admin";
  addedAt: string;
}

export interface AdminIdentity {
  profileId?: string;
  username?: string;
  registeredAt?: string;
  /** Additional admins and moderators granted from the panel. */
  grants?: AdminGrant[];
}

const CACHE_TTL_MS = 5_000;
const cache = new Map<string, { value: unknown; at: number }>();

export function clearSettingsCache(): void {
  cache.clear();
}

async function readSetting<T>(key: string, fallback: T): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as T;
  try {
    // The anon server client, not the service role: the keys read here
    // (features, economy, games) are deliberately world-readable — public pages
    // need them — so the service-role key is neither needed nor appropriate. The
    // two keys that are NOT public (`admin`, `acp_gate_state`) are excluded by
    // the policy in migration 0029 and are read with the service role where they
    // are needed (see getAdminIdentity below).
    const supabase = await createClient();
    const { data } = await supabase
      .from("site_settings")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    const value = (data?.value as T | undefined) ?? fallback;
    cache.set(key, { value, at: Date.now() });
    return value;
  } catch {
    // A missing table must not break the arcade.
    return fallback;
  }
}

/** Merges a stored partial document over the defaults, key by key. */
function merge<T extends object>(fallback: T, stored: unknown): T {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return fallback;
  }
  const out = { ...fallback } as Record<string, unknown>;
  for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
    if (!(key in fallback)) continue;
    const base = (fallback as Record<string, unknown>)[key];
    if (typeof base === "number") {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 0) out[key] = parsed;
    } else if (typeof base === "boolean") {
      out[key] = value === true;
    } else if (typeof base === "string") {
      out[key] = String(value).slice(0, 500);
    }
  }
  return out as T;
}

export async function getEconomy(): Promise<EconomySettings> {
  return merge(ECONOMY_DEFAULTS, await readSetting<unknown>("economy", null));
}

export async function getGames(
  catalog: Array<{ id: string; minBet: number; maxBet: number }>,
): Promise<GamesSettings> {
  const stored = await readSetting<Partial<GamesSettings>>("games", {});
  const games: Record<string, GameSetting> = {};
  for (const meta of catalog) {
    const entry = stored?.games?.[meta.id];
    games[meta.id] = {
      enabled: entry?.enabled !== false,
      minBet:
        typeof entry?.minBet === "number" && entry.minBet >= 0
          ? entry.minBet
          : meta.minBet,
      maxBet:
        typeof entry?.maxBet === "number" && entry.maxBet > 0
          ? entry.maxBet
          : meta.maxBet,
    };
  }
  return { enabled: stored?.enabled !== false, games };
}

export async function getFeatures(): Promise<FeatureSettings> {
  return merge(FEATURE_DEFAULTS, await readSetting<unknown>("features", null));
}

/**
 * The owner record and the grant roster.
 *
 * This is the one settings key the public read policy excludes (migration 0029),
 * so it is read with the service role rather than the anon client every other
 * accessor uses. It is only ever needed inside the panel.
 */
export async function getAdminIdentity(): Promise<AdminIdentity> {
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("site_settings")
      .select("value")
      .eq("key", "admin")
      .maybeSingle();
    return ((data?.value as AdminIdentity | undefined) ?? {}) as AdminIdentity;
  } catch {
    return {};
  }
}

/**
 * The same document, but a FAILED read is distinguishable from an absent one.
 *
 * `getAdminIdentity` collapses both to `{}`, which is harmless for a reader but
 * not for a writer: spreading `{}` into `site_settings.admin` erases `profileId`,
 * and `bootstrapAvailable()` — `!value?.profileId` — then reopens the one-shot
 * passcode door on an installation that already has an owner. Writers use this
 * and refuse on `null`; readers keep the tolerant accessor.
 */
export async function getAdminIdentityOrNull(): Promise<AdminIdentity | null> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("site_settings")
      .select("value")
      .eq("key", "admin")
      .maybeSingle();
    if (error) return null;
    return ((data?.value as AdminIdentity | undefined) ?? {}) as AdminIdentity;
  } catch {
    return null;
  }
}

/**
 * The bet bounds and switch actually in force for one game. Unknown ids fall
 * back to the catalog metadata so a new game cannot be unplayable because the
 * settings document predates it.
 */
export async function gameRules(
  id: string,
  meta: { minBet: number; maxBet: number },
): Promise<GameSetting> {
  const settings = await getGames([{ id, ...meta }]);
  return settings.games[id] ?? { enabled: true, minBet: meta.minBet, maxBet: meta.maxBet };
}
