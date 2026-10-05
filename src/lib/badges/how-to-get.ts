import type { BadgeRow } from "@/lib/queries";

/**
 * Per-badge "how to get it" guide.
 *
 * 485 badges, 13 acquisition routes and only 51 rows carrying a curated
 * `how_to_earn` — so a hand-written page per badge is not maintainable, and a
 * single generic paragraph would be wrong on 90% of the catalog. Instead every
 * badge is CLASSIFIED from its own row and the guide is assembled from that
 * route's steps plus the facts the row actually contains.
 *
 * Three rules make the output trustworthy, which matters because these pages are
 * the most-crawled surface on the site:
 *
 *  - **No invented facts.** A step never claims a watch time, a Bits amount or a
 *    channel the row does not state. `watchMinutes` is parsed out of the
 *    description or omitted, and the guide then points the reader at the
 *    campaign page instead of printing a made-up duration. The unknown route
 *    renders an honest "not documented" block rather than plausible fiction.
 *  - **Strings resolve once.** Like `faq.ts`, the caller hands over a translator
 *    and gets back finished strings, which then feed BOTH the visible guide and
 *    the schema.org HowTo. A key path leaking into JSON-LD would ship
 *    `stepWatchOpen` to Google as step text.
 *  - **Links are verified and Twitch-owned.** The `L` table below is a fixed
 *    allowlist of live Twitch URLs (each returned HTTP 200 when added) plus the
 *    badge's own `click_url` when that host is Twitch. Third-party and
 *    tracking URLs are never rendered.
 */

/** How the badge is obtained. Selects the route's step template set. */
export type HowToMethod =
  | "watch"
  | "subscribe"
  | "gift"
  | "bits"
  | "hypeTrain"
  | "recap"
  | "rewards"
  | "attend"
  | "coStream"
  | "founder"
  | "premium"
  | "share"
  | "donate"
  | "predict"
  | "leader"
  | "internal"
  | "unknown";

export interface HowToStep {
  /** Finished sentence. Rendered verbatim and reused by the JSON-LD. */
  text: string;
  /** Optional external Twitch link rendered as a clickable chip on the step. */
  href?: string;
}

export interface HowToLink {
  /** Finished link label. */
  label: string;
  href: string;
}

export interface HowToGuide {
  method: HowToMethod;
  /** Short route label, e.g. "Watch campaign". */
  methodLabel: string;
  /** Which row signal decided the route — rendered as provenance text. */
  evidence: string;
  /** True when the row itself carries a curated `how_to_earn`. */
  fromCuratedField: boolean;
  intro: string;
  steps: HowToStep[];
  /** "Go straight to Twitch" block. Empty when nothing Twitch-owned applies. */
  links: HowToLink[];
  /** schema.org HowTo, or null when there is no honest procedure to state. */
  jsonLd: Record<string, unknown> | null;
}

/** A translator already bound to the `badgeHowTo` namespace. */
export type HowToTranslate = (
  key: string,
  values?: Record<string, string | number>,
) => string;

export interface HowToContext {
  t: HowToTranslate;
  /** Absolute origin of the badge page, for the JSON-LD `url`. */
  pageUrl: string;
}

/* ------------------------------------------------------------------ */
/* Verified Twitch destinations                                        */
/* ------------------------------------------------------------------ */

/** Hosts an outbound link is allowed to use. */
const TWITCH_HOSTS = new Set([
  "twitch.tv",
  "www.twitch.tv",
  "m.twitch.tv",
  "bits.twitch.tv",
  "help.twitch.tv",
  "blog.twitch.tv",
  "link.twitch.tv",
  "clips.twitch.tv",
]);

const L = {
  badgeSettings: "https://www.twitch.tv/settings/profile#channel-badges",
  dropsInventory: "https://www.twitch.tv/drops/inventory",
  directory: "https://www.twitch.tv/directory",
  subscriptions: "https://www.twitch.tv/subscriptions",
  bits: "https://bits.twitch.tv",
  hypeTrainGuide: "https://help.twitch.tv/s/article/hype-train-guide",
  weeklyRewards: "https://help.twitch.tv/s/article/weekly-rewards",
  subscriberBadgeGuide: "https://help.twitch.tv/s/article/subscriber-badge-guide",
  foundersBadge: "https://help.twitch.tv/s/article/founders-badge",
  annualRecap: "https://www.twitch.tv/annual-recap",
  turbo: "https://www.twitch.tv/products/turbo",
  primeGaming: "https://www.twitch.tv/prime-gaming",
  events: "https://www.twitch.tv/events",
  blog: "https://blog.twitch.tv/",
} as const;

/** Accept a URL only if it parses and its host is Twitch-owned. */
export function isTwitchUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    return TWITCH_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Drop the utm_* tracking params Twitch appends to its own badge links. */
function cleanClickUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("utm_")) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return value;
  }
}

/* ------------------------------------------------------------------ */
/* Row-signal extraction                                               */
/* ------------------------------------------------------------------ */

/** Watch time stated by the row, in minutes — null when it states none. */
function watchMinutes(badge: BadgeRow): number | null {
  const source = `${badge.description ?? ""} ${badge.how_to_earn ?? ""}`;
  const hourMatch = /(\d+(?:\.\d+)?)\s*(?:-\s*\d+(?:\.\d+)?\s*)?hours?/i.exec(source);
  if (hourMatch) {
    const hours = Number.parseFloat(hourMatch[1]);
    if (Number.isFinite(hours) && hours > 0) return Math.round(hours * 60);
  }
  const minuteMatch = /(\d+)\s*minutes?/i.exec(source);
  if (minuteMatch) {
    const minutes = Number.parseInt(minuteMatch[1], 10);
    if (Number.isFinite(minutes) && minutes > 0) return minutes;
  }
  return null;
}

/** For a `cheer N` badge the version IS the amount. */
function bitsAmount(badge: BadgeRow): number | null {
  if (badge.set_id.toLowerCase() !== "bits") return null;
  const amount = Number.parseInt(badge.version, 10);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/** Consecutive sub months for the subscriber ladder (v3 → 3, v6 → 6). */
function subMonths(badge: BadgeRow): number | null {
  if (badge.set_id.toLowerCase() !== "subscriber") return null;
  const months = Number.parseInt(badge.version, 10);
  return Number.isFinite(months) && months > 0 ? months : null;
}

/** Say a minute count the way a reader would ("90 minutes", "1.5 hours"). */
function humaniseMinutes(minutes: number): string {
  if (minutes >= 120 && minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  if (minutes >= 120) return `${(minutes / 60).toFixed(1)} hours`;
  return `${minutes} minutes`;
}

/* ------------------------------------------------------------------ */
/* Classifier                                                          */
/* ------------------------------------------------------------------ */

interface Route {
  method: HowToMethod;
  evidence: string;
}

/**
 * Decide the acquisition route from signals actually present in the row.
 * Order matters: the most specific signal wins, so a TwitchCon badge whose
 * description happens to contain "subscribe" stays an attendance badge.
 */
function classify(badge: BadgeRow): Route {
  const setId = badge.set_id.toLowerCase();
  const hay = `${badge.title} ${badge.set_id} ${badge.description ?? ""} ${badge.how_to_earn ?? ""}`.toLowerCase();

  // Exact set ids — unambiguous, checked first.
  if (setId === "bits") return { method: "bits", evidence: "set id `bits`" };
  if (setId === "founder") return { method: "founder", evidence: "set id `founder`" };
  if (setId === "hype-train") return { method: "hypeTrain", evidence: "set id `hype-train`" };
  if (setId === "turbo" || setId === "premium") {
    return { method: "premium", evidence: `set id \`${badge.set_id}\`` };
  }
  if (setId === "subscriber") return { method: "subscribe", evidence: "set id `subscriber`" };
  if (setId === "predictions") return { method: "predict", evidence: "set id `predictions`" };
  if (/^twitch-recap-\d{4}$/.test(setId)) return { method: "recap", evidence: `set id \`${badge.set_id}\`` };

  // Community leaderboards — a mechanic of its own: you cannot buy a place in
  // one, so it must not fall through to the "subscribe or watch" templates.
  if (/top cheerer|top clipper|top supporter|top clip/.test(hay)) {
    return { method: "leader", evidence: "community leaderboard placement" };
  }

  // Co-streaming is a distinct, high-signal phrase.
  if (/co-?stream/.test(hay)) return { method: "coStream", evidence: "description mentions co-streaming" };

  // Staff tenure is not obtainable by any viewer at all.
  if (/years? as twitch staff/.test(hay)) return { method: "internal", evidence: "staff-tenure badge" };

  // Attendance: tickets, registration, venues.
  if (badge.category === "twitchcon" || /attended twitchcon|registered for twitchcon/.test(hay)) {
    return { method: "attend", evidence: "TwitchCon attendance record" };
  }
  if (/purchas(?:ed|ing) (?:a )?\d?-?day ticket|admission ticket|vip ticket/.test(hay)) {
    return { method: "attend", evidence: "description mentions a ticket purchase" };
  }

  // Weekly channel-point watch rewards (Bloom / Blossom ladders).
  if (badge.category === "rewards" || /watching a clip, vod or live stream \d days? a week/.test(hay)) {
    return { method: "rewards", evidence: "weekly watch-reward ladder" };
  }

  // Bits used as a campaign incentive.
  if (/\bbits\b|\bcheer/.test(hay) && badge.category !== "bits") {
    return { method: "bits", evidence: "description mentions Bits" };
  }

  // Gifting is stated before plain subscribing, since gifting implies a sub.
  if (/\bgift(?:ing|ed|s)?\b/.test(hay)) return { method: "gift", evidence: "description mentions gifting a sub" };

  // Clip-sharing / community campaigns.
  if (/\bshared?\b[^.]{0,60}\bclips?\b|\bshare the love\b/.test(hay)) {
    return { method: "share", evidence: "description mentions sharing clips" };
  }

  // Charity donations carry a stated amount we can quote verbatim.
  if (/donat/.test(hay)) return { method: "donate", evidence: "description mentions donating" };

  if (/subscri|\bsubbed\b|\bsub to\b/.test(hay)) {
    return { method: "subscribe", evidence: "description mentions subscribing" };
  }

  // Watching is the largest generic campaign route, so it sits last. "Tuning
  // in", "viewed" and "stream together" are the same mechanic said differently.
  if (/watch|\btuning in|\btuned in|\bviewed\b|stream together/.test(hay)) {
    return { method: "watch", evidence: "description mentions watching" };
  }

  return { method: "unknown", evidence: "no acquisition signal in the row" };
}

const METHOD_LABEL_KEY: Record<HowToMethod, string> = {
  watch: "methodWatch",
  subscribe: "methodSubscribe",
  gift: "methodGift",
  bits: "methodBits",
  hypeTrain: "methodHypeTrain",
  recap: "methodRecap",
  rewards: "methodRewards",
  attend: "methodAttend",
  coStream: "methodCoStream",
  founder: "methodFounder",
  premium: "methodPremium",
  share: "methodShare",
  donate: "methodDonate",
  predict: "methodPredict",
  leader: "methodLeader",
  internal: "methodInternal",
  unknown: "methodUnknown",
};

export function buildHowToGet(badge: BadgeRow, ctx: HowToContext): HowToGuide {
  const { t } = ctx;
  const route = classify(badge);
  const minutes = watchMinutes(badge);
  const bits = bitsAmount(badge);
  const months = subMonths(badge);
  const clickUrl = isTwitchUrl(badge.click_url) ? cleanClickUrl(badge.click_url) : null;

  const steps: HowToStep[] = [];
  const links: HowToLink[] = [];
  // Dedupe on a normalised key: `bits.twitch.tv` and `bits.twitch.tv/` are the
  // same destination and rendered as two chips otherwise.
  const seen = new Set<string>();
  const pushLink = (labelKey: string, href: string) => {
    const key = href.replace(/\/+$/, "").toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ label: t(labelKey), href });
  };
  const pushStep = (key: string, values?: Record<string, string | number>, href?: string) => {
    steps.push({ text: t(key, values), href });
  };

  // The row states its own requirement — show it verbatim, add nothing to it.
  const curated = badge.how_to_earn?.trim();
  if (curated) pushStep("stepCurated", { how: curated });

  switch (route.method) {
    case "watch":
      pushStep("stepWatchOpen", undefined, L.dropsInventory);
      pushStep("stepWatchFind", undefined, L.directory);
      if (minutes === null) pushStep("stepWatchTimeUnknown");
      else pushStep("stepWatchTime", { time: humaniseMinutes(minutes) });
      pushLink("linkDropsInventory", L.dropsInventory);
      pushLink("linkBrowseDirectory", L.directory);
      break;

    case "subscribe":
      pushStep("stepSubPick", undefined, L.directory);
      if (months === null) pushStep("stepSubStart");
      else pushStep("stepSubStart", { months });
      pushStep("stepSubClaim");
      pushLink("linkSubDirectory", L.directory);
      pushLink("linkSubscriberGuide", L.subscriberBadgeGuide);
      pushLink("linkMySubscriptions", L.subscriptions);
      break;

    case "gift":
      pushStep("stepGiftFind", undefined, L.directory);
      pushStep("stepGiftBuy");
      pushStep("stepGiftClaim");
      pushLink("linkSubDirectory", L.directory);
      pushLink("linkSubscriberGuide", L.subscriberBadgeGuide);
      break;

    case "bits":
      if (bits === null) pushStep("stepBitsCheer");
      else pushStep("stepBitsCheer", { amount: bits.toLocaleString("en-US") });
      pushStep("stepBitsSend");
      pushStep("stepBitsClaim");
      pushLink("linkGetBits", L.bits);
      break;

    case "hypeTrain":
      pushStep("stepHypeRide");
      pushStep("stepHypeTop");
      pushStep("stepHypeClaim");
      pushLink("linkHypeTrainGuide", L.hypeTrainGuide);
      break;

    case "recap":
      pushStep("stepRecapOpen", undefined, L.annualRecap);
      pushStep("stepRecapFinish");
      pushLink("linkAnnualRecap", L.annualRecap);
      break;

    case "rewards":
      pushStep("stepRewardsWatch");
      pushStep("stepRewardsDays");
      pushStep("stepRewardsClaim");
      pushLink("linkWeeklyRewards", L.weeklyRewards);
      break;

    case "attend":
      pushStep("stepAttendTicket");
      pushStep("stepAttendShow");
      pushStep("stepAttendClaim");
      pushLink("linkTwitchEvents", L.events);
      break;

    case "coStream":
      pushStep("stepCoStreamStart");
      pushStep("stepCoStreamKeep");
      pushStep("stepCoStreamClaim");
      pushLink("linkBrowseDirectory", L.directory);
      break;

    case "founder":
      pushStep("stepFounderOnly");
      pushLink("linkFoundersBadge", L.foundersBadge);
      break;

    case "premium":
      if (badge.set_id.toLowerCase() === "turbo") {
        pushStep("stepPremiumTurbo", undefined, L.turbo);
        pushLink("linkTurbo", L.turbo);
      } else {
        pushStep("stepPremiumPrime", undefined, L.primeGaming);
        pushLink("linkPrimeGaming", L.primeGaming);
      }
      pushStep("stepSubStart");
      break;

    case "share":
      pushStep("stepSharePick");
      pushStep("stepSharePost");
      pushLink("linkTwitchBlog", L.blog);
      break;

    case "donate":
      pushStep("stepDonatePick");
      pushStep("stepDonateGive");
      pushStep("stepDonateClaim");
      break;

    case "predict":
      pushStep("stepPredictOpen", undefined, L.directory);
      pushStep("stepPredictPick");
      pushStep("stepPredictLock");
      pushLink("linkBrowseDirectory", L.directory);
      break;

    case "leader":
      // A leaderboard placement cannot be bought — say so plainly.
      pushStep("stepLeaderOnly");
      break;

    case "internal":
      // Not obtainable by any reader — state that instead of faking a guide.
      pushStep("stepInternalOnly");
      break;

    case "unknown":
      if (badge.description?.trim()) {
        pushStep("stepUnknownWithDescription", { description: badge.description.trim() });
      } else {
        pushStep("stepUnknownBare");
      }
      break;
  }

  // Universal tail: the badge is invisible in chat until it is switched on.
  // Not offered on the routes that are not procedures — pointing a reader who
  // cannot earn the badge at the settings page would be a dead end.
  if (
    route.method !== "internal" &&
    route.method !== "unknown" &&
    route.method !== "leader"
  ) {
    pushStep("stepEnable", undefined, L.badgeSettings);
    pushLink("linkBadgeSettings", L.badgeSettings);
  }

  // The badge's own Twitch destination, when it has a trustworthy one.
  if (clickUrl) pushLink("linkOfficialSource", clickUrl);

  return {
    method: route.method,
    methodLabel: t(METHOD_LABEL_KEY[route.method]),
    evidence: route.evidence,
    fromCuratedField: Boolean(curated),
    intro: t("intro", { title: badge.title }),
    steps,
    links,
    jsonLd: buildHowToJsonLd(badge, route.method, steps, curated, ctx.pageUrl),
  };
}

/**
 * schema.org HowTo built from the SAME `steps` array the page renders — Google
 * invalidates a rich result when structured data and visible text disagree.
 *
 * Null for the two routes that are not procedures at all (an unobtainable staff
 * badge, and a badge whose route could not be determined): inventing steps to
 * populate a schema field is exactly the failure this module exists to avoid.
 */
function buildHowToJsonLd(
  badge: BadgeRow,
  method: HowToMethod,
  steps: HowToStep[],
  curated: string | undefined,
  pageUrl: string,
): Record<string, unknown> | null {
  if (method === "internal" || method === "unknown" || method === "leader") return null;
  if (steps.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: `How to get the ${badge.title} Twitch badge`,
    description:
      curated ??
      badge.description ??
      `Step-by-step guide to earning the ${badge.title} badge on Twitch.`,
    url: pageUrl,
    step: steps.map((step, index) => ({
      "@type": "HowToStep",
      position: index + 1,
      text: step.text,
      ...(step.href ? { url: step.href } : {}),
    })),
  };
}