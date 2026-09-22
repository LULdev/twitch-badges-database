import { createAdminClient } from "@/lib/supabase/admin";
import { award, getProgress, logActivity } from "./xp";

export type AchievementCategory = "common" | "creative" | "special";

export interface Achievement {
  id: string;
  category: AchievementCategory;
  title: string;
  description: string;
  xp: number;
  coins: number;
  points: number;
  check: (s: AchStats) => boolean;
}

export interface AchStats {
  progress: {
    xp: number; coins: number; level: number; login_streak: number;
    best_login_streak: number; games_played: number; games_won: number;
    coins_won: number; coins_lost: number; wheel_spins: number;
    steals_successful: number; steals_failed: number; times_robbed: number;
    game_xp_today: number; achievements_points: number;
  };
  badgesOwned: number;
  activeOwned: number;
  expiredOwned: number;
  legendaryOwned: number;
  mythicOwned: number;
  tiersOwned: number;
  hasTwitchcon: boolean;
  oldestBadgeYear: number;
  newestBadgeAgeHours: number;
  bestBadgeScore: number;
  gamesByType: Record<string, { played: number; won: number }>;
  roundsToday: number;
  distinctHoursToday: number;
  maxBet: number;
  winStreak: number;
  lossStreak: number;
  wheelBest: number;
  turboWins: number;
  profileViews: number;
  visitorsCount: number;
  rainsReceived: number;
  rainsGiven: number;
  stealVisits: number;
  defendedCount: number;
  stealCostPaid: number;
  bestStealAmount: number;
  reactionsGiven: number;
  faqVisits: number;
  profilesVisited: number;
  customizationKeys: number;
  /** Slots actually set in the profile's badge showcase (capped at 6). */
  showcaseSlots: number;
  moodSet: boolean;
  activityCount: number;
  dailyCount: number;
  userCount: number;
  twitchBirthday: boolean;
  recentPerfectFlags: Record<string, boolean>;
  recentResults: Array<{ game: string; won: boolean; bet: number; payout: number; hour: number; at: number; flags: Record<string, number | boolean> }>;
}

type Ctor = (
  id: string,
  title: string,
  description: string,
  check: (s: AchStats) => boolean,
  xp?: number,
  coins?: number,
) => Achievement;

const COMMON: Ctor = (id, title, description, check, xp = 100, coins = 100) => ({
  id, category: "common", title, description, check, xp, coins, points: 10,
});
const CREATIVE: Ctor = (id, title, description, check, xp = 500, coins = 250) => ({
  id, category: "creative", title, description, check, xp, coins, points: 25,
});
const SPECIAL: Ctor = (id, title, description, check, xp = 2500, coins = 1000) => ({
  id, category: "special", title, description, check, xp, coins, points: 100,
});

const GAME_IDS = [
  "rps", "slots", "shoot", "memory", "quiz", "coinflip", "hilo",
  "roulette", "blackjack", "vault", "scratch", "tower", "catcher",
];

/** The showcase has six slots (`showcase_slots` is capped at 6 when written). */
const SHOWCASE_SLOTS = 6;

function hasFlag(s: AchStats, game: string, flag: string): boolean {
  return s.recentResults.some((r) => r.game === game && !!r.flags?.[flag]);
}

export const ACHIEVEMENTS: Achievement[] = [
  // ---------- 50 common ----------
  COMMON("c_first_login", "Welcome Aboard", "Log in with Twitch for the first time.", () => true),
  COMMON("c_daily_1", "First Steps", "Claim your first daily login bonus.", (s) => s.dailyCount >= 1),
  COMMON("c_daily_7", "Regular", "7-day login streak.", (s) => s.progress.best_login_streak >= 7),
  COMMON("c_daily_30", "Creature of Habit", "30-day login streak.", (s) => s.progress.best_login_streak >= 30, 300, 300),
  COMMON("c_sync_first", "Collector Born", "Sync your Twitch badges once.", (s) => s.badgesOwned >= 1),
  COMMON("c_badges_10", "Ten Badges", "Own 10 catalog badges.", (s) => s.badgesOwned >= 10),
  COMMON("c_badges_50", "Fifty Badges", "Own 50 catalog badges.", (s) => s.badgesOwned >= 50, 200, 200),
  COMMON("c_badges_100", "Century Collector", "Own 100 catalog badges.", (s) => s.badgesOwned >= 100, 300, 300),
  COMMON("c_badges_250", "Badge Vault", "Own 250 catalog badges.", (s) => s.badgesOwned >= 250, 500, 500),
  COMMON("c_level_5", "Level 5", "Reach level 5.", (s) => s.progress.level >= 5),
  COMMON("c_level_10", "Level 10", "Reach level 10.", (s) => s.progress.level >= 10, 150, 150),
  COMMON("c_level_25", "Level 25", "Reach level 25.", (s) => s.progress.level >= 25, 300, 300),
  COMMON("c_level_50", "Halfway There", "Reach level 50.", (s) => s.progress.level >= 50, 500, 500),
  COMMON("c_level_75", "Almost Legendary", "Reach level 75.", (s) => s.progress.level >= 75, 750, 750),
  COMMON("c_level_100", "Max Level", "Reach level 100.", (s) => s.progress.level >= 100, 2500, 2500),
  COMMON("c_coins_100", "Pocket Money", "Hold 100 coins.", (s) => s.progress.coins >= 100),
  COMMON("c_coins_1000", "Thousandaire", "Hold 1,000 coins.", (s) => s.progress.coins >= 1000, 150, 150),
  COMMON("c_coins_10000", "Coin Mountain", "Hold 10,000 coins.", (s) => s.progress.coins >= 10000, 300, 300),
  COMMON("c_coins_100000", "Coin Tycoon", "Hold 100,000 coins.", (s) => s.progress.coins >= 100000, 750, 750),
  COMMON("c_games_first", "First Spin", "Play your first game.", (s) => s.progress.games_played >= 1),
  COMMON("c_games_10", "Getting Warmer", "Play 10 rounds.", (s) => s.progress.games_played >= 10),
  COMMON("c_games_50", "Frequent Player", "Play 50 rounds.", (s) => s.progress.games_played >= 50, 150, 150),
  COMMON("c_games_100", "Arcade Regular", "Play 100 rounds.", (s) => s.progress.games_played >= 100, 250, 250),
  COMMON("c_games_500", "Arcade Legend", "Play 500 rounds.", (s) => s.progress.games_played >= 500, 500, 500),
  COMMON("c_win_first", "First Blood", "Win your first game.", (s) => s.progress.games_won >= 1),
  COMMON("c_win_10", "Ten Wins", "Win 10 games.", (s) => s.progress.games_won >= 10),
  COMMON("c_win_50", "Fifty Wins", "Win 50 games.", (s) => s.progress.games_won >= 50, 250, 250),
  COMMON("c_wheel_first", "Let It Spin", "Spin the Wheel of Fortune once.", (s) => s.progress.wheel_spins >= 1),
  COMMON("c_wheel_10", "Wheel Fan", "Spin the wheel 10 times.", (s) => s.progress.wheel_spins >= 10),
  COMMON("c_wheel_50", "Wheel Addict", "Spin the wheel 50 times.", (s) => s.progress.wheel_spins >= 50, 300, 300),
  COMMON("c_wheel_loyal", "Daily Ritual", "Spin the wheel on 7 days in a row.", (s) => s.progress.wheel_spins >= 7 && s.progress.login_streak >= 7, 200, 200),
  COMMON("c_profile_customized", "Make It Yours", "Customize at least 5 profile settings.", (s) => s.customizationKeys >= 5),
  COMMON("c_views_10", "Getting Noticed", "10 profile views.", (s) => s.profileViews >= 10),
  COMMON("c_views_100", "Rising Star", "100 profile views.", (s) => s.profileViews >= 100, 200, 200),
  // The showcase lives in `profiles.showcase_slots`, not in `customization`.
  // It used to check `customizationKeys >= 0` — always true — so "Curator"
  // fired on the first owned badge, duplicating c_sync_first.
  COMMON("c_showcase_set", "Curator", "Fill your badge showcase.", (s) => s.showcaseSlots >= SHOWCASE_SLOTS),
  COMMON("c_bio_written", "Storyteller", "Write a profile bio.", (s) => s.moodSet || s.customizationKeys >= 1),
  COMMON("c_frame", "Framed", "Equip an avatar frame.", (s) => s.customizationKeys >= 3),
  COMMON("c_ach_1", "First Achievement", "Unlock 1 achievement.", () => false, 0, 0),
  COMMON("c_ach_10", "Achievement Hunter", "Unlock 10 achievements.", () => false, 150, 150),
  COMMON("c_ach_25", "Trophy Room", "Unlock 25 achievements.", () => false, 300, 300),
  COMMON("c_ach_50", "Half the Wall", "Unlock 50 achievements.", () => false, 500, 500),
  COMMON("c_ach_100", "Completionist", "Unlock 100 achievements.", () => false, 1500, 1500),
  COMMON("c_games_all", "Jack of All Games", "Play every game at least once.", (s) => GAME_IDS.every((g) => (s.gamesByType[g]?.played ?? 0) >= 1), 250, 250),
  COMMON("c_daily_claim_100", "Loyalty Program", "Claim 100 daily login bonuses.", (s) => s.dailyCount >= 100, 500, 500),
  COMMON("c_rps_first", "Rock Solid", "Play Rock-Paper-Scissors.", (s) => (s.gamesByType["rps"]?.played ?? 0) >= 1),
  COMMON("c_slots_first", "Reel Curious", "Play Badges of Ra.", (s) => (s.gamesByType["slots"]?.played ?? 0) >= 1),
  COMMON("c_quiz_first", "Quiz Time", "Play Badge Quiz.", (s) => (s.gamesByType["quiz"]?.played ?? 0) >= 1),
  COMMON("c_steal_first", "First Heist", "Attempt your first coin steal.", (s) => s.progress.steals_successful + s.progress.steals_failed >= 1),
  COMMON("c_robbed_first", "It Happens", "Someone tried to steal from you.", (s) => s.progress.times_robbed >= 1),
  COMMON("c_feed_first", "On the Record", "Appear in the live activity feed.", (s) => s.activityCount >= 1),

  // ---------- 50 creative ----------
  CREATIVE("k_night_owl", "Night Owl", "Claim a daily bonus between 0 and 5 AM.", (s) => new Date().getUTCHours() < 5),
  CREATIVE("k_early_bird", "Early Bird", "Claim a daily bonus before 7 AM UTC.", (s) => new Date().getUTCHours() < 7 && new Date().getUTCHours() >= 5),
  CREATIVE("k_weekend_warrior", "Weekend Warrior", "Play 10 rounds on a weekend day.", (s) => [0, 6].includes(new Date().getUTCDay()) && s.roundsToday >= 10),
  CREATIVE("k_lucky_2500", "Jackpot!", "Win the 2,500 XP wheel top prize.", (s) => s.wheelBest >= 2500, 0, 1000),
  CREATIVE("k_unlucky_10", "Cursed Dice", "Lose 10 games in a row.", (s) => s.lossStreak >= 10),
  CREATIVE("k_phoenix", "Phoenix", "Lose 1,000+ coins total, then hold 1,000+ again.", (s) => s.progress.coins_lost >= 1000 && s.progress.coins >= 1000),
  CREATIVE("k_high_roller", "High Roller", "Place a single bet of 1,000+ coins.", (s) => s.maxBet >= 1000),
  CREATIVE("k_cautious", "Cautious Gambler", "Win 10 games without ever betting more than 10 coins.", (s) => s.progress.games_won >= 10 && s.maxBet <= 10),
  CREATIVE("k_marathon_day", "Marathon", "Play 100 rounds in a single day.", (s) => s.roundsToday >= 100, 750, 500),
  CREATIVE("k_perfect_memory", "Photographic", "Finish Badge Memory with zero mismatches.", (s) => hasFlag(s, "memory", "perfect")),
  CREATIVE("k_sharpshooter", "Sharpshooter", "Reach 90% accuracy in Shoot the Badges.", (s) => hasFlag(s, "shoot", "sharp")),
  CREATIVE("k_speedrunner", "Speedrunner", "Finish Badge Memory in under 30 seconds.", (s) => hasFlag(s, "memory", "fast")),
  CREATIVE("k_blackjack_5", "Card Shark", "Win 5 Blackjack hands in a row.", (s) => hasFlag(s, "blackjack", "streak5")),
  CREATIVE("k_tower_top", "Tower Climber", "Reach level 10 of the Tower of Badges.", (s) => hasFlag(s, "tower", "top")),
  CREATIVE("k_vault_master", "Vault Cracker", "Crack the vault perfectly three times.", (s) => hasFlag(s, "vault", "perfect3")),
  CREATIVE("k_scratch_jackpot", "Golden Scratch", "Win a 20× payout on a scratch card.", (s) => hasFlag(s, "scratch", "jackpot")),
  CREATIVE("k_quiz_10", "Badge Professor", "Answer 10 quiz questions correctly in a row.", (s) => hasFlag(s, "quiz", "streak10")),
  CREATIVE("k_hilo_10", "Rarity Sense", "Predict 10 higher/lower rounds in a row.", (s) => hasFlag(s, "hilo", "streak10")),
  CREATIVE("k_roulette_green", "Green Zero", "Hit the green slot on Badge Roulette.", (s) => hasFlag(s, "roulette", "green")),
  CREATIVE("k_coinflip_7", "Lucky Streak", "Win the 7-step coin flip ladder.", (s) => hasFlag(s, "coinflip", "ladder7")),
  CREATIVE("k_collector_active", "Fully Current", "Own every currently active badge.", (s) => s.activeOwned >= 20 && s.activeOwned === s.badgesOwned, 1000, 1000),
  CREATIVE("k_legend_own", "Legendary Touch", "Own a legendary-rarity badge.", (s) => s.legendaryOwned >= 1),
  CREATIVE("k_mythic_own", "Myth Keeper", "Own a mythic-rarity badge.", (s) => s.mythicOwned >= 1, 750, 750),
  CREATIVE("k_all_tiers", "Full Spectrum", "Own badges of all six rarity tiers.", (s) => s.tiersOwned >= 6),
  CREATIVE("k_event_ticket", "Been There", "Own a TwitchCon (ticket) badge.", (s) => s.hasTwitchcon),
  CREATIVE("k_retro_2017", "Time Traveler", "Own a badge from 2017 or earlier.", (s) => s.oldestBadgeYear <= 2017),
  CREATIVE("k_fresh_drop", "Fresh Catch", "Own a badge within 48 hours of its detection.", (s) => s.newestBadgeAgeHours <= 48),
  CREATIVE("k_mood_set", "Mood Setter", "Set a profile mood status.", (s) => s.moodSet),
  CREATIVE("k_rain_10", "Rain Dance", "Receive 10 coin rains on your profile.", (s) => s.rainsReceived >= 10),
  CREATIVE("k_rain_maker", "Rain Maker", "Send 25 coin rains to others.", (s) => s.rainsGiven >= 25),
  CREATIVE("k_popular_25", "Local Celebrity", "25 different profile visitors.", (s) => s.visitorsCount >= 25, 300, 300),
  CREATIVE("k_celebrity", "Certified Celebrity", "1,000 profile views.", (s) => s.profileViews >= 1000, 750, 750),
  CREATIVE("k_spy", "Window Shopper", "Visit 50 other profiles.", (s) => s.profilesVisited >= 50),
  CREATIVE("k_thief_10", "Master Thief", "Pull off 10 successful steals.", (s) => s.progress.steals_successful >= 10),
  CREATIVE("k_fortress", "Fortress", "Fend off 10 steal attempts.", (s) => s.defendedCount >= 10),
  CREATIVE("k_robin_hood", "Robin Hood", "Successfully steal, then gamble away 1,000+ coins.", (s) => s.progress.steals_successful >= 1 && s.progress.coins_lost >= 1000),
  CREATIVE("k_ghost", "Ghost Login", "Keep a 10-day streak with fewer games than login days.", (s) => s.progress.login_streak >= 10 && s.progress.games_played < s.progress.login_streak),
  CREATIVE("k_gambler_1000", "Thousand Bets", "Play 1,000 rounds total.", (s) => s.progress.games_played >= 1000, 1000, 500),
  CREATIVE("k_comeback", "Comeback Kid", "Recover from 500+ coins lost to net positive.", (s) => s.progress.coins_lost >= 500 && s.progress.coins_won > s.progress.coins_lost),
  CREATIVE("k_slots_scatter", "Scatter! ", "Land 3+ scatter badges in Badges of Ra.", (s) => hasFlag(s, "slots", "scatter")),
  CREATIVE("k_rps_mindreader", "Mind Reader", "Win 5 RPS duels in a row.", (s) => hasFlag(s, "rps", "streak5")),
  CREATIVE("k_catcher_100", "Golden Gloves", "Catch 100 badges in one Drops Catcher run.", (s) => hasFlag(s, "catcher", "hundred")),
  CREATIVE("k_shoot_500", "Badge Hunter", "Play 50 rounds of Shoot the Badges.", (s) => (s.gamesByType["shoot"]?.played ?? 0) >= 50),
  CREATIVE("k_reactor", "Reactor", "React to 5 blog posts.", (s) => s.reactionsGiven >= 5),
  CREATIVE("k_faq_scholar", "FAQ Scholar", "Read the FAQ 5 times.", (s) => s.faqVisits >= 5),
  CREATIVE("k_sharer", "Influencer", "Get 10 visits through your steal/share link.", (s) => s.stealVisits >= 10),
  CREATIVE("k_big_spender", "Big Spender", "Wager 10,000+ coins in total losses.", (s) => s.progress.coins_lost >= 10000),
  CREATIVE("k_profiteer", "Profiteer", "Win 10,000+ coins in total winnings.", (s) => s.progress.coins_won >= 10000),
  CREATIVE("k_xp_100k", "Six Figures", "Earn 100,000 lifetime XP.", (s) => s.progress.xp >= 100000, 1000, 1000),
  CREATIVE("k_coin_millionaire", "Coin Millionaire", "Hold 1,000,000 coins.", (s) => s.progress.coins >= 1000000, 5000, 0),

  // ---------- 25 special (unexpected) ----------
  SPECIAL("s_turbo_winner", "One in a Hundred Million", "Win the Twitch Turbo subscription jackpot on the wheel.", (s) => s.turboWins >= 1, 5000, 50000),
  SPECIAL("s_midas", "Midas Touch", "Win 10 games in a row.", (s) => s.winStreak >= 10),
  SPECIAL("s_cursed", "Properly Cursed", "Lose 20 games in a row.", (s) => s.lossStreak >= 20, 1000, 500),
  SPECIAL("s_owl_gambler", "3 AM Gambler", "Win a game between 3 and 4 AM UTC.", (s) => s.recentResults.some((r) => r.won && r.hour === 3)),
  SPECIAL("s_top_percent", "The 1%", "Be among the top 3 coin holders.", (s) => s.userCount >= 20 && s.progress.coins >= 50000),
  SPECIAL("s_broke", "Rock Bottom", "Hit exactly 0 coins after playing 10+ games.", (s) => s.progress.coins === 0 && s.progress.games_played >= 10, 500, 250),
  SPECIAL("s_lazy_week", "Zen Week", "Keep a 7-day login streak with fewer than 7 games played.", (s) => s.progress.login_streak >= 7 && s.progress.games_played < 7),
  SPECIAL("s_generous", "Charitable", "Pay 1,000+ coins in failed steal attempts.", (s) => s.stealCostPaid >= 1000, 750, 0),
  SPECIAL("s_archivist", "Archivist", "Own 25 expired badges.", (s) => s.expiredOwned >= 25),
  SPECIAL("s_completionist", "Museum Curator", "Own 400+ catalog badges.", (s) => s.badgesOwned >= 400, 2500, 2500),
  SPECIAL("s_pioneer", "Pioneer", "Be among the first 100 users.", (s) => s.userCount <= 100),
  SPECIAL("s_full_house", "Full House", "Play 10+ rounds of every game.", (s) => GAME_IDS.every((g) => (s.gamesByType[g]?.played ?? 0) >= 10), 1500, 1500),
  SPECIAL("s_lucky_777", "Lucky Sevens", "Hold exactly 777 coins.", (s) => s.progress.coins === 777, 777, 77),
  SPECIAL("s_level_42", "Answer to Everything", "Reach level 42.", (s) => s.progress.level === 42, 420, 420),
  SPECIAL("s_level_69", "Nice", "Reach level 69.", (s) => s.progress.level === 69, 690, 690),
  SPECIAL("s_daily_cap", "Cap Crasher", "Hit the 100 XP daily game cap.", (s) => s.progress.game_xp_today >= 100),
  SPECIAL("s_wheel_misfortune", "Wheel of Misfortune", "Spin 20 times without ever winning more than 100 XP.", (s) => s.progress.wheel_spins >= 20 && s.wheelBest <= 100, 300, 300),
  SPECIAL("s_sniper", "Sniper", "Steal 200+ coins in a single successful heist.", (s) => s.bestStealAmount >= 200),
  SPECIAL("s_slots_jackpot", "Ra's Jackpot", "Win 5,000+ coins in a single Badges of Ra spin.", (s) => s.recentResults.some((r) => r.game === "slots" && r.payout >= 5000)),
  SPECIAL("s_birthday", "Badge Birthday", "Log in on your Twitch account's creation anniversary.", (s) => s.twitchBirthday, 1000, 1000),
  // The old check accepted ANY three wins among the last 60 rounds — the same
  // game a week apart satisfied "different games within 10 minutes". The wins
  // must now be three distinct games inside a real 10-minute span.
  SPECIAL("s_hattrick", "Hat-Trick", "Win three different games within 10 minutes.",
    (s) => {
      const wins = s.recentResults.filter((r) => r.won).sort((a, b) => a.at - b.at);
      return wins.some((start, i) => {
        const games = new Set<string>();
        for (let j = i; j < wins.length && wins[j].at - start.at <= 10 * 60_000; j += 1) {
          games.add(wins[j].game);
        }
        return games.size >= 3;
      });
    }, 500, 500),
  SPECIAL("s_perfectionist_rps", "RPS Perfectionist", "Win 70%+ of 20+ RPS duels.", (s) => (s.gamesByType["rps"]?.played ?? 0) >= 20 && (s.gamesByType["rps"]?.won ?? 0) / Math.max(1, s.gamesByType["rps"]?.played ?? 1) >= 0.7),
  SPECIAL("s_ghost_town", "Ghost Town", "Have zero profile visitors in your first 7 days.", (s) => s.profileViews === 0 && s.activityCount > 0, 100, 100),
  SPECIAL("s_endgame", "Endgame Collector", "Own a badge with a 90+ rarity score.", (s) => s.bestBadgeScore >= 90),
  SPECIAL("s_immortal", "Immortal", "Reach the maximum level of 100.", (s) => s.progress.level >= 100, 5000, 10000),
];

export const ACH_BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

/** Count-unlock achievements that can't self-check (unlocked N achievements). */
const META_ACHIEVEMENTS: Array<{ id: string; at: number }> = [
  { id: "c_ach_1", at: 1 },
  { id: "c_ach_10", at: 10 },
  { id: "c_ach_25", at: 25 },
  { id: "c_ach_50", at: 50 },
  { id: "c_ach_100", at: 100 },
];

export async function evaluateAchievements(userId: string): Promise<string[]> {
  const supabase = createAdminClient();
  const stats = await buildStats(userId);

  const { data: unlockedRows } = await supabase
    .from("user_achievements")
    .select("achievement_id")
    .eq("user_id", userId);
  const unlocked = new Set(
    (unlockededRowsSafe(unlockedRows)).map((r) => r.achievement_id),
  );

  const newly: string[] = [];
  for (const ach of ACHIEVEMENTS) {
    if (ach.id.startsWith("c_ach_")) continue;
    if (unlocked.has(ach.id)) continue;
    let passed = false;
    try {
      passed = ach.check(stats);
    } catch {
      passed = false;
    }
    if (passed) newly.push(ach.id);
  }

  // Only REAL achievements count towards the meta thresholds. `unlocked`
  // already contains the c_ach_* rows, so counting it let c_ach_10 unlock with
  // 9 real achievements (+1 meta = 10), and each meta achievement inflated the
  // next one's total by the same amount.
  const totalUnlocked =
    [...unlocked].filter((id) => !id.startsWith("c_ach_")).length + newly.length;
  for (const meta of META_ACHIEVEMENTS) {
    if (!unlocked.has(meta.id) && totalUnlocked >= meta.at) newly.push(meta.id);
  }

  for (const id of newly) {
    const ach = ACH_BY_ID.get(id);
    if (!ach) continue;
    // Plain INSERT, not an upsert: `ON CONFLICT DO UPDATE` matches an existing
    // row without raising, so a second concurrent evaluation would carry on and
    // pay ach.xp/ach.coins/ach.points a second time. 23505 (a parallel run
    // unlocked it first) means the reward was already paid — skip it.
    const { error } = await supabase
      .from("user_achievements")
      .insert({ user_id: userId, achievement_id: id });
    if (error) continue;

    // Atomic increment: two unlocks resolving together used to overwrite each
    // other's points because the total came from a stale read. A failure here
    // cannot be retried (the row above is in, so this id never comes round
    // again), so surface it rather than pretending the points moved.
    const { error: pointsError } = await supabase.rpc("bump_counters", {
      p_user_id: userId,
      p_deltas: { achievements_points: ach.points },
    });
    if (pointsError) {
      console.warn("[achievements] achievements_points bump failed:", pointsError);
    }

    await logActivity({
      userId,
      kind: "achievement",
      title: `unlocked: ${ach.title}`,
      body: ach.description,
      xpAmount: ach.xp,
      coinsAmount: ach.coins,
      payload: { achievement: ach.id, category: ach.category },
    });

    // Reward without re-triggering evaluation (prevents recursion).
    await award(
      userId,
      {
        xp: ach.xp,
        coins: ach.coins,
        source: `achievement:${ach.id}`,
        skipAchievements: true,
      },
    ).catch(() => undefined);
  }

  return newly;
}

function unlockededRowsSafe(rows: unknown): Array<{ achievement_id: string }> {
  return Array.isArray(rows) ? (rows as Array<{ achievement_id: string }>) : [];
}

async function buildStats(userId: string): Promise<AchStats> {
  const supabase = createAdminClient();
  const progress = await getProgress(userId);

  const [badgesRes, gamesRes, roundsRes, wheelRes, turboRes, profileRes,
    rainRes, stealRes, reactRes, faqRes, visitsRes, usersRes, achRes, visitorsRes,
    maxBetRes] =
    await Promise.all([
      supabase.from("user_inventory").select("badges(rarity_tier,status,set_id,first_seen_at,rarity_score)").eq("user_id", userId),
      supabase.from("game_rounds").select("game,won").eq("user_id", userId),
      supabase.from("game_rounds").select("game,won,bet,payout,result,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(60),
      supabase.from("activity_events").select("xp_amount").eq("user_id", userId).eq("kind", "wheel"),
      supabase.from("turbo_wins").select("id", { count: "exact", head: true }).eq("user_id", userId),
      supabase.from("profiles").select("view_count, customization, mood, twitch_created_at, showcase_slots").eq("id", userId).maybeSingle(),
      supabase.from("activity_events").select("payload").eq("kind", "coin_rain").eq("user_id", userId),
      supabase.from("steal_attempts").select("thief_id,victim_id,coins,cost,success").or(`thief_id.eq.${userId},victim_id.eq.${userId}`),
      supabase.from("blog_reactions").select("id", { count: "exact", head: true }).eq("user_id", userId),
      supabase.from("activity_events").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("kind", "profile").eq("payload->>page", "faq"),
      supabase.from("activity_events").select("payload").in("kind", ["profile_visit", "steal_visit"]).eq("user_id", userId),
      supabase.from("profiles").select("id", { count: "exact", head: true }),
      supabase.from("activity_events").select("kind").eq("user_id", userId),
      supabase.from("profile_visits").select("ip_hash").eq("profile_id", userId).limit(1000),
      // Lifetime maximum bet in ONE row: the recent-round window above cannot
      // answer "never bet more than 10 coins", and an unfiltered round list is
      // capped by PostgREST. Ordering server-side returns the true maximum.
      supabase.from("game_rounds").select("bet").eq("user_id", userId).order("bet", { ascending: false }).limit(1).maybeSingle(),
    ]);

  const badges = ((badgesRes.data ?? []) as Array<Record<string, unknown>>).map((b) => b.badges as Record<string, unknown>).filter(Boolean);
  const rarityTiers = new Set<string>(badges.map((b) => String(b.rarity_tier)));
  const firstSeens = badges.map((b) => String(b.first_seen_at ?? "")).filter(Boolean).sort();
  const newestAgeH = firstSeens.length
    ? (Date.now() - new Date(firstSeens[firstSeens.length - 1]).getTime()) / 3_600_000
    : 9999;
  const oldestYear = firstSeens.length
    ? new Date(firstSeens[0]).getUTCFullYear()
    : 9999;

  const gamesByType: Record<string, { played: number; won: number }> = {};
  for (const row of (gamesRes.data ?? []) as Array<{ game: string; won: boolean }>) {
    gamesByType[row.game] ??= { played: 0, won: 0 };
    gamesByType[row.game].played += 1;
    if (row.won) gamesByType[row.game].won += 1;
  }

  const recentRounds = ((roundsRes.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    game: String(r.game),
    won: Boolean(r.won),
    bet: Number(r.bet ?? 0),
    payout: Number(r.payout ?? 0),
    hour: new Date(String(r.created_at)).getUTCHours(),
    // Millisecond timestamp: s_hattrick needs real elapsed time, and `hour`
    // alone cannot tell two wins 1 minute apart from two 59 minutes apart.
    at: new Date(String(r.created_at)).getTime(),
    flags: ((r.result ?? {}) as Record<string, number | boolean>),
  }));

  let winStreak = 0;
  for (const r of recentRounds) {
    if (r.won) winStreak += 1;
    else break;
  }
  let lossStreak = 0;
  for (const r of recentRounds) {
    if (!r.won) lossStreak += 1;
    else break;
  }

  const wheelBest = Math.max(0, ...((wheelRes.data ?? []) as Array<{ xp_amount: number | null }>).map((r) => r.xp_amount ?? 0));
  const todayStr = new Date().toISOString().slice(0, 10);
  const rawRounds = (roundsRes.data ?? []) as Array<Record<string, unknown>>;
  const roundsToday = rawRounds.filter((r) => String(r.created_at).slice(0, 10) === todayStr).length;
  const hoursToday = new Set(
    rawRounds
      .filter((r) => String(r.created_at).slice(0, 10) === todayStr)
      .map((r) => new Date(String(r.created_at)).getUTCHours()),
  ).size;

  const customization = (profileRes.data?.customization ?? {}) as Record<string, unknown>;
  const twitchCreated = profileRes.data?.twitch_created_at
    ? new Date(String(profileRes.data.twitch_created_at))
    : null;
  const now = new Date();
  const twitchBirthday = twitchCreated
    ? twitchCreated.getUTCMonth() === now.getUTCMonth() &&
      twitchCreated.getUTCDate() === now.getUTCDate()
    : false;

  const rains = (rainRes.data ?? []) as Array<{ payload: Record<string, unknown> | null }>;
  const rainsReceived = rains.filter((r) => r.payload?.role === "receiver").length;
  const rainsGiven = rains.filter((r) => r.payload?.role === "giver").length;

  const steals = (stealRes.data ?? []) as Array<{ thief_id: string; victim_id: string; coins: number; cost: number; success: boolean }>;
  const mySteals = steals.filter((s) => s.thief_id === userId);
  const againstMe = steals.filter((s) => s.victim_id === userId);

  const visitPayloads = (visitsRes.data ?? []) as Array<{ payload: Record<string, unknown> | null }>;

  return {
    progress: {
      xp: progress.xp, coins: progress.coins, level: progress.level,
      login_streak: progress.login_streak, best_login_streak: progress.best_login_streak,
      games_played: progress.games_played, games_won: progress.games_won,
      coins_won: progress.coins_won, coins_lost: progress.coins_lost,
      wheel_spins: progress.wheel_spins, steals_successful: progress.steals_successful,
      steals_failed: progress.steals_failed, times_robbed: progress.times_robbed,
      game_xp_today: progress.game_xp_today, achievements_points: progress.achievements_points,
    },
    badgesOwned: badges.length,
    activeOwned: badges.filter((b) => b.status === "active").length,
    expiredOwned: badges.filter((b) => b.status === "expired").length,
    legendaryOwned: badges.filter((b) => b.rarity_tier === "legendary").length,
    mythicOwned: badges.filter((b) => b.rarity_tier === "mythic").length,
    tiersOwned: rarityTiers.size,
    hasTwitchcon: badges.some((b) => /twitchcon/i.test(String(b.set_id))),
    oldestBadgeYear: oldestYear,
    newestBadgeAgeHours: newestAgeH,
    bestBadgeScore: Math.max(0, ...badges.map((b) => Number(b.rarity_score ?? 0))),
    gamesByType,
    roundsToday,
    distinctHoursToday: hoursToday,
    // Lifetime maximum, not the 60-round window: k_cautious ("never bet more
    // than 10 coins") was satisfied by 60 small bets after a history of
    // 5,000-coin bets, and k_high_roller was missed by an old big bet.
    maxBet: Number(maxBetRes.data?.bet ?? 0),
    winStreak,
    lossStreak,
    wheelBest,
    turboWins: turboRes.count ?? 0,
    profileViews: profileRes.data?.view_count ?? 0,
    visitorsCount: new Set(
      ((visitorsRes.data ?? []) as Array<{ ip_hash: string }>).map((v) => v.ip_hash),
    ).size,
    rainsReceived,
    rainsGiven,
    stealVisits: visitPayloads.filter((v) => v.payload?.page === "steal-link").length,
    defendedCount: againstMe.filter((s) => !s.success).length,
    stealCostPaid: mySteals.filter((s) => !s.success).reduce((sum, s) => sum + s.cost, 0),
    bestStealAmount: Math.max(0, ...mySteals.filter((s) => s.success).map((s) => s.coins)),
    reactionsGiven: reactRes.count ?? 0,
    faqVisits: faqRes.count ?? 0,
    profilesVisited: visitPayloads.filter((v) => v.payload?.page === "profile").length,
    customizationKeys: Object.keys(customization).length,
    showcaseSlots: Array.isArray(profileRes.data?.showcase_slots)
      ? profileRes.data.showcase_slots.length
      : 0,
    moodSet: Boolean(profileRes.data?.mood),
    activityCount: (achRes.data ?? []).length,
    dailyCount: (achRes.data ?? []).filter((k) => (k as { kind?: string }).kind === "daily").length,
    userCount: usersRes.count ?? 0,
    twitchBirthday,
    recentPerfectFlags: {},
    recentResults: recentRounds,
  };
}
