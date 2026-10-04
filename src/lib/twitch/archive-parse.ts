/**
 * Defensive owner-count extraction from an archived HTML capture.
 *
 * Nothing that leaves this module is ever corrected: a recovered point is
 * written to `badge_stats` with source = 'archive' and stays on the owner
 * curve forever, feeding rarity, age and momentum. A confident wrong number is
 * therefore strictly worse than no number, so every strategy below is written
 * to be willing to return null, and a page that yields more than one distinct
 * plausible value returns null rather than picking one.
 *
 * Strategy order (the first strategy that yields candidates decides, even when
 * it then concludes "ambiguous" — falling through from a contradictory
 * structured source to a looser one can only get worse). Every structured
 * source runs before prose, because prose is the one that can only guess:
 *   1. schema.org JSON-LD      — a published contract, the least ambiguous
 *   2. embedded JSON payload   — potat's real shape, but a site convention
 *   3. data-* attributes       — the source site's own machine-readable markup
 *   4. labelled prose          — most ambiguous, so it runs last, and only on
 *                                a page that is recognisably a badge page
 *
 * Prose ran third once, ahead of the embedded payload, and a capture carrying
 * both `total_owners: 48210` and a line reading "Owned by 900 users" stored
 * 900 — potat's ACTIVE figure, as a lifetime owner count, permanently.
 */

/**
 * Upper bound for a plausible owner count.
 *
 * 1e12 is ~10 000x Twitch's whole monthly active user base. Anything above it
 * is a misparse — a price, a concatenated digit run, an epoch — not data, and
 * is treated as a parse failure rather than stored.
 */
const MAX_PLAUSIBLE_OWNERS = 1e12;

/** Ceilings that keep a pathological capture from stalling a sync. */
const MAX_WALK_DEPTH = 6;
const MAX_WALK_NODES = 4_000;

/** Tag-stripped text length under which a capture is a stub, not a page. */
const MIN_REAL_PAGE_CHARS = 512;

/** A label mentioning people/ownership positively identifies an owner count. */
const OWNER_HINT = /user|owner|holder|collect|redeem|equipp|wear/i;

/**
 * ...unless it also mentions one of these. "Users who viewed this item",
 * "Subscribers" and "Review count" all contain "user"/"owner"-shaped words
 * while measuring something else entirely.
 */
const NON_OWNER_HINT =
  /rating|review|price|amount|cost|comment|question|answer|vote|follower|subscrib|view|click|play|download|item|page|post|file|image|photo|video|length|size|weight/i;

/**
 * Keys whose NAME alone identifies an owner count, ranked by how specific that
 * name is about the LIFETIME figure. Matching is done on the key with every
 * non-alphanumeric character removed, so `total_owners`, `totalOwners` and
 * `TOTALOWNERS` collapse to one entry — which is why potat's snake_case fields
 * resolve here alongside badgebase's camelCase.
 *
 * The rank is what makes a potat payload parseable. It carries `total_owners`
 * (lifetime) AND `user_count` (users ACTIVE) on the same record; read as
 * equally-weighted candidates those two values make every such page look
 * self-contradictory, and the lifetime figure — the one this feature exists to
 * recover — was thrown away. Ranking resolves it on the field's own meaning
 * rather than on which value came first in the document.
 */
const OWNER_KEY_RANKS: Record<string, number> = {
  // Lifetime totals: the only thing an archived capture can honestly report.
  totalowners: 3,
  totalusers: 3,
  ownercount: 3,
  // A declared user count. On potat this is the ACTIVE figure, so it ranks
  // below the lifetime total and is only read when nothing better is present.
  usercount: 2,
  users: 2,
  owners: 2,
};

/**
 * Keys that look owner-ish by name but say nothing about WHICH count they hold.
 *
 * `userInteractionCount` is schema.org's generic counter: the same field holds
 * `interactionType: .../ViewCount` on a page with a share widget as it holds
 * `.../UserCount` on a page that counts owners. Read unconditionally it turned
 * a page's view count into its owner count, and because a page carrying a real
 * UserCount alongside it produced two disagreeing numbers, the ambiguity guard
 * discarded the page and left the view count standing on its own. So this key
 * is gated on the object's own labels naming users or owners — which is exactly
 * what `interactionType` is for.
 */
const LABEL_GATED_KEYS = new Set(["userinteractioncount"]);

/** The rank a hit was found at, for CONTEXT_FREE_KEYS matches. */
const CONTEXT_FREE_RANK = 1;

/**
 * Keys that carry no meaning on their own ("value" inside a PropertyValue,
 * "count" inside anything) and therefore only count when the surrounding
 * object labels itself as an owner count. Deliberately excludes ratingValue,
 * reviewCount and price — NON_OWNER_HINT handles those.
 */
const CONTEXT_FREE_KEYS = new Set(["value", "count", "total", "itemcount"]);

/** Label fields that can identify a JSON-LD node as an owner counter. */
const LABEL_KEYS = [
  "@type",
  "name",
  "interactionType",
  "alternateName",
  "propertyID",
  "valueName",
];

/**
 * Identity fields used to bind a recovered number to the badge being parsed.
 * Ordered strongest first: `name` is last because it doubles as the label the
 * owner-hint test reads, so inheriting an identity from it can only ever drop
 * a hit, never invent one.
 */
const IDENTITY_KEYS = ["badge", "set_id", "setId", "set", "slug", "title", "name"];

/** Marks a tag-stripped capture as a real page rather than a stub. */
const REAL_PAGE_MARKERS =
  /badge|jtvnw|jtv\.twimg|static-cdn|potat|twitch|set[_-]?id/i;

/**
 * Digit strings that may be read as a count: plain digits, or grouped by
 * thousands with a comma / non-breaking space / narrow space / plain space.
 *
 * Anything containing a decimal separator fails here on purpose. "1.2K" and
 * "3.4M" are abbreviations whose magnitude rounding is site-specific, and
 * "4.99" is a price — converting either would be a guess, so a capture whose
 * only owner figure is abbreviated yields null and the sync moves on.
 */
const COUNT_TOKEN = /^(?:\d{1,3}(?:[,\u00a0\u202f ]\d{3})+|\d+)$/;

/** Prose labels that unambiguously mean owners. */
const OWNER_PROSE = "(?:owners|collectors|holders)";

/**
 * "users" is NOT one of them. It heads site-wide counters as readily as owner
 * counts — "Join 200000 users worldwide" is a footer, not a badge fact — so it
 * only counts with a verb that ties it to possession.
 */
const USER_PROSE = "users";

const OWN_VERB =
  "(?:own|owns|owning|have|has|held|hold|holding|collected|equipped|redeemed)";

const TAG = /<[^>]+>/g;

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  thinsp: " ",
  ensp: " ",
  emsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/**
 * Shared plausibility gate. Every strategy funnels its output through this, so
 * a bound can never be tightened in one place and forgotten in another.
 *
 * Zero is accepted. A never-redeemed badge legitimately reports 0 owners, and
 * on an old capture that 0 is the most interesting thing on the page — the
 * whole point of the recovery pass is the tail of the curve, where zeros are
 * the norm. Rejecting it would silently drop exactly the points the feature
 * exists to recover.
 */
function isPlausibleCount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_PLAUSIBLE_OWNERS
  );
}

/** Collapse a key to lowercase alphanumerics so naming styles unify. */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Parse a digit string into a count, or null.
 *
 * Both the grouping grammar and the plausibility gate are applied here, so no
 * caller can bypass the "1.2K is not a number we read" rule by parsing first.
 */
function parseCountToken(token: string): number | null {
  const trimmed = token.trim();
  if (!COUNT_TOKEN.test(trimmed)) return null;
  const value = Number(trimmed.replace(/[,\u00a0\u202f ]/g, ""));
  return isPlausibleCount(value) ? value : null;
}

function decodeEntities(text: string): string {
  return text.replace(
    /&(#[xX]?[0-9a-fA-F]+|[a-zA-Z]+);/g,
    (match: string, code: string): string => {
      if (!code.startsWith("#")) {
        return NAMED_ENTITIES[code.toLowerCase()] ?? match;
      }
      const hex = code[1] === "x" || code[1] === "X";
      const point = hex
        ? Number.parseInt(code.slice(2), 16)
        : Number.parseInt(code.slice(1), 10);
      if (!Number.isFinite(point) || point < 0 || point > 0x10ffff) return match;
      try {
        return String.fromCodePoint(point);
      } catch {
        return match;
      }
    },
  );
}

/**
 * Visible text of a capture: script/style bodies are removed, tags become
 * spaces (so "12,345</b><b> users" reads as one number, but "12</b>345" cannot
 * be glued into a bogus run), entities are decoded, and all whitespace collapses
 * so a number split across a line break still parses.
 *
 * Script bodies must go before the prose pass. Their contents are not prose:
 * `"total_owners":12345` inside a __NEXT_DATA__ blob matches the "N … owners"
 * shape and was read as the number 12345 by way of a capture that says
 * `:12345,` — punctuation the prose grammar cannot account for. Stripping them
 * hands that value to the embedded-JSON strategy, which knows the field name
 * and can bind it to the badge, and leaves the prose pass reading only words a
 * human would read.
 */
const NON_PROSE_BLOCKS = /<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi;

function plainText(html: string): string {
  return decodeEntities(
    html.replace(NON_PROSE_BLOCKS, " ").replace(TAG, " "),
  ).replace(/\s+/g, " ");
}

interface ScriptBlock {
  /** Lowercased attribute string, so `type=`/`id=` probes are case-safe. */
  attrs: string;
  body: string;
}

function scriptBlocks(html: string): ScriptBlock[] {
  const blocks: ScriptBlock[] = [];
  // Rebuilt per call: a module-level /g regex carries lastIndex between
  // callers, and a partially-consumed regex silently skips blocks.
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    blocks.push({ attrs: (match[1] ?? "").toLowerCase(), body: match[2] ?? "" });
  }
  return blocks;
}

/** One owner count found in a structured payload, with the record it came from. */
interface OwnerHit {
  value: number;
  identity: string | null;
  /** How specific the key that produced it was; see OWNER_KEY_RANKS. */
  rank: number;
}

interface WalkBudget {
  nodes: number;
}

function labelText(record: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of LABEL_KEYS) {
    const raw = record[key];
    if (typeof raw === "string") {
      parts.push(raw.slice(0, 300));
    } else if (Array.isArray(raw)) {
      for (const item of raw) {
        if (typeof item === "string") parts.push(item.slice(0, 300));
      }
    }
  }
  return parts.join(" ");
}

function identityOf(record: Record<string, unknown>): string | null {
  for (const key of IDENTITY_KEYS) {
    const raw = record[key];
    if (typeof raw === "string" && raw.trim().length > 0) {
      return raw.trim().toLowerCase();
    }
  }
  return null;
}

/**
 * Walk a parsed JSON payload and collect every owner count it declares.
 *
 * Identity is inherited downwards, so a counter nested inside a labelled parent
 * (`Product` → `interactionStatistic` → `userInteractionCount`) stays bound to
 * the product rather than escaping anonymous — without that, identity filtering
 * would discard exactly the good JSON-LD hits.
 *
 * `allowContextFree` is the difference between the two callers: JSON-LD may
 * read a bare `value` when the object labels itself as an owner count, an
 * embedded site payload may not, because a potat record's `value` means
 * whatever its author felt like at the time.
 */
function collectOwnerHits(
  node: unknown,
  depth: number,
  allowContextFree: boolean,
  inheritedIdentity: string | null,
  budget: WalkBudget,
  out: OwnerHit[],
): void {
  if (out.length > 64 || budget.nodes >= MAX_WALK_NODES) return;
  if (Array.isArray(node)) {
    for (const item of node) {
      collectOwnerHits(item, depth + 1, allowContextFree, inheritedIdentity, budget, out);
    }
    return;
  }
  if (!node || typeof node !== "object" || depth > MAX_WALK_DEPTH) return;

  const record = node as Record<string, unknown>;
  budget.nodes += 1;
  const identity = identityOf(record) ?? inheritedIdentity;
  const labels = allowContextFree ? labelText(record) : "";
  const ownerLabeled =
    allowContextFree && OWNER_HINT.test(labels) && !NON_OWNER_HINT.test(labels);

  for (const [key, value] of Object.entries(record)) {
    // A numeric string goes through the same strict token grammar as prose, so
    // "1,234" is read and "1.2" / "1.2K" is still rejected.
    const numeric =
      typeof value === "number"
        ? isPlausibleCount(value)
          ? value
          : null
        : typeof value === "string"
          ? parseCountToken(value)
          : null;
    if (numeric === null) continue;

    const norm = normalizeKey(key);
    const rank = OWNER_KEY_RANKS[norm];
    if (rank !== undefined) {
      out.push({ value: numeric, identity, rank });
      continue;
    }
    if (LABEL_GATED_KEYS.has(norm)) {
      // Only when the object itself says the counter is about users/owners.
      if (ownerLabeled) out.push({ value: numeric, identity, rank: 2 });
      continue;
    }
    if (!ownerLabeled || !CONTEXT_FREE_KEYS.has(norm)) continue;
    out.push({ value: numeric, identity, rank: CONTEXT_FREE_RANK });
  }

  for (const value of Object.values(record)) {
    if (value && typeof value === "object") {
      collectOwnerHits(value, depth + 1, allowContextFree, identity, budget, out);
    }
  }
}

/**
 * Identity comparison on alphanumerics only, so "Foo Badge", "foo-badge" and
 * "foo_badge" agree. The substring fallback requires at least four characters in
 * BOTH directions: short ids like "founder" vs "cofounder" are too easy to
 * confuse at the length where a substring match starts being worth the recall.
 */
function identityMatches(identity: string, wanted: string): boolean {
  const left = normalizeKey(identity);
  const right = normalizeKey(wanted);
  if (!left || !right) return false;
  if (left === right) return true;
  return (
    left.length >= 4 && right.length >= 4 && (left.includes(right) || right.includes(left))
  );
}

/**
 * Turn a hit list into at most one number.
 *
 * An unfiltered, multi-record payload (a potat page that embeds the whole
 * catalog) can easily contain the owner count of a DIFFERENT badge, and a page
 * can carry two genuinely different lifetime figures. Both resolve the same
 * way: null — after the pool has first been narrowed to its most specific key
 * rank, so that a record's lifetime total is not counted as contradicting its
 * own active-user figure.
 *
 * `badgeKey` — the catalog set_id or the archive source's own slug — narrows
 * the pool before any of that, which is what makes a whole-catalog payload
 * usable at all. When it is supplied and nothing matches, the result is null: a
 * number belonging to some other badge is the exact failure this module exists
 * to prevent, so there is deliberately no unfiltered fallback.
 */
function resolveOwnerCount(
  hits: OwnerHit[],
  badgeKey: string | null,
): number | null {
  const wanted = badgeKey ? normalizeKey(badgeKey) : "";
  const identified = wanted
    ? hits.filter(
        (hit) => hit.identity !== null && identityMatches(hit.identity, wanted),
      )
    : hits;
  if (identified.length === 0) return null;
  const best = Math.max(...identified.map((hit) => hit.rank));
  const pool = identified.filter((hit) => hit.rank === best);
  if (new Set(pool.map((hit) => hit.value)).size !== 1) return null;
  return pool[0]?.value ?? null;
}

/** Collapse a flat candidate list that has no identity dimension. */
function resolvePlainCount(values: number[]): number | null {
  if (values.length === 0) return null;
  if (new Set(values).size !== 1) return null;
  return values[0] ?? null;
}

/**
 * schema.org JSON-LD. Blocks are captured by regex and stripped of tags before
 * JSON.parse, exactly like `parseHowTo` / `parseTemporalCoverage` in
 * badgebase.ts — including skipping a malformed block rather than throwing,
 * because one bad capture must not end a backfill.
 *
 * A typical hit is `{"@type":"InteractionCounter",
 * "interactionType":"…/UserCount","userInteractionCount":12345}` or a
 * PropertyValue labelled "Owners" with a bare `value`. An `aggregateRating` is
 * never read: ratingCount and reviewCount measure engagement, not ownership.
 */
function jsonLdCandidates(html: string): OwnerHit[] {
  const hits: OwnerHit[] = [];
  const budget: WalkBudget = { nodes: 0 };
  for (const block of scriptBlocks(html)) {
    if (!block.attrs.includes("application/ld+json")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(block.body.replace(TAG, ""));
    } catch {
      continue; // malformed JSON-LD — skip
    }
    collectOwnerHits(parsed, 0, true, null, budget, hits);
  }
  return hits;
}

/**
 * `__NEXT_DATA__` / `application/json` payloads, keyed on potat's own field
 * names (`total_owners`, `user_count` — see PotatBadgeOwners /
 * PotatBadgeDistribution in ./types and fetchAllOwners in potat.ts).
 *
 * Deliberately NOT tag-stripped, unlike the JSON-LD pass: a JSON string value
 * may legitimately contain "<", and stripping would corrupt the payload into
 * something that no longer parses.
 *
 * `user_count` is potat's "Users Active" figure, not lifetime owners, so it is
 * only ever reached when no `total_owners` is present — and it lands in
 * `owner_count` anyway, which is the conservative direction: a lower number that
 * is visibly too low is recoverable, a wrong peak is not.
 */
function embeddedJsonCandidates(html: string): OwnerHit[] {
  const hits: OwnerHit[] = [];
  const budget: WalkBudget = { nodes: 0 };
  for (const block of scriptBlocks(html)) {
    if (block.attrs.includes("application/ld+json")) continue;
    const isJson =
      block.attrs.includes("application/json") ||
      block.attrs.includes("__next_data__");
    if (!isJson) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(block.body);
    } catch {
      continue; // truncated / non-JSON payload — skip
    }
    collectOwnerHits(parsed, 0, false, null, budget, hits);
  }
  return hits;
}

/**
 * `data-count` / `data-owners` / `data-owner-count` / `data-user-count`.
 * `data-count` is the loosest of them — generic enough to be a view count on
 * some site — which is why it is the second strategy and not the first, and why
 * every value still has to survive the token grammar and the plausibility gate.
 */
function attributeCandidates(html: string): number[] {
  const values: number[] = [];
  const re =
    /data-(?:count|owners|owner-count|user-count|usercount|ownercount)\s*=\s*"([^"]{1,24})"/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const value = parseCountToken(match[1] ?? "");
    if (value !== null) values.push(value);
  }
  return values;
}

/** Sentence punctuation that trails a value without being part of it. */
const TRAILING_PUNCTUATION = /[,;:.!?)\]]+$/;

/** Currency symbols that lead a value without being part of it. */
const LEADING_CURRENCY = /^[$€£¥]+/;

/**
 * Reduce a raw matched run to the number it claims to be, or null.
 *
 * The capture is a whole non-space run rather than a digit class, and that is
 * deliberate. A digit class lets the regex backtrack to satisfy its own trailing
 * lookahead: on "Owners 45%" the class gives up the "5" to escape the `%` check
 * and matches "4", so a percentage was stored as an owner count. Capturing the
 * whole run and letting COUNT_TOKEN judge it makes that impossible — "45%" is
 * not a count token, and the value is dropped rather than truncated.
 */
function cleanToken(raw: string): number | null {
  const trimmed = raw
    .replace(LEADING_CURRENCY, "")
    .replace(TRAILING_PUNCTUATION, "")
    .trim();
  return parseCountToken(trimmed);
}

/**
 * Prose, in both orders: "12,345 users own it" and "Owners: 12,345".
 *
 * Both patterns capture a non-space run and hand it to cleanToken, so a value
 * glued to a percent sign or an abbreviation fails as a whole instead of being
 * truncated into a shorter, wrong number. The number-first pattern is lazy, so
 * it starts at each digit position and a year or percentage earlier in the
 * sentence ("since 2023 users complained") is stepped over rather than
 * swallowed into the capture.
 *
 * Three gates keep site furniture out of the catalog. The patterns only fire on
 * a page recognisably a badge page, and only when no structured source produced
 * anything. The number-first pattern additionally requires an owner word, or the
 * word "users" FOLLOWED BY a possession verb — that combination is what
 * separates "12,345 users own this badge" from "Join 200000 users worldwide",
 * and reading the latter as a lifetime owner count is the failure this rule
 * exists to prevent. The label-first pattern needs no such rule: it captures
 * whatever non-space run follows the label, and cleanToken rejects "worldwide"
 * because it is not a number.
 *
 * This is the weakest strategy by construction — surrounding prose is the one
 * part of a capture nobody versions — and a page with two different labelled
 * figures returns null rather than a coin flip.
 */
function proseCandidates(html: string): number[] {
  const values: number[] = [];
  const text = plainText(html);
  if (!REAL_PAGE_MARKERS.test(text)) return values;

  const lead = new RegExp(
    `([^\\s]{1,26}?)\\s*(?:${OWNER_PROSE}\\b|${USER_PROSE}\\s+${OWN_VERB}\\b)`,
    "gi",
  );
  let match: RegExpExecArray | null;
  while ((match = lead.exec(text)) !== null) {
    const value = cleanToken(match[1] ?? "");
    if (value !== null) values.push(value);
  }
  if (values.length > 0) return values;

  const trail = new RegExp(
    `(?:${OWNER_PROSE}|${USER_PROSE})\\s*(?:owning|own|have|has|with|of|:|–|-)?\\s*([^\\s]{1,26})`,
    "gi",
  );
  while ((match = trail.exec(text)) !== null) {
    const value = cleanToken(match[1] ?? "");
    if (value !== null) values.push(value);
  }
  return values;
}

/**
 * archive.org failure notices that cannot appear on a real badge page. Run on
 * every capture regardless of length, because the archive appends its error
 * banner to captures it failed to store.
 */
const DECISIVE_STUB_PROBES: RegExp[] = [
  /not been archived/i,
  /not archived/i,
  /no (?:url|page)s? has been archived/i,
  /doesn'?t have (?:that|this|the page)/i,
  /hasn'?t been saved|no archived versions|no snapshots? (?:were )?(?:found|available|exist)/i,
  /excluded from the wayback machine|this url has been excluded/i,
  // The archive answers an outage with a branded HTML page and HTTP **200**, so
  // `res.ok` is true and only the body gives it away.
  /internet archive.{0,40}offline|temporarily offline/i,
  /too many requests|rate limit|you'?ve been blocked|slow down|try again later|error 429|service unavailable/i,
];

/**
 * Redirect / transport stubs, applied ONLY to short bodies. On a full page
 * `window.location.href=` and `<meta http-equiv="refresh">` are just bundle and
 * markup, not evidence that the capture is a bounce.
 */
const SHORT_STUB_PROBES: RegExp[] = [
  /<meta[^>]+http-equiv=["']?refresh/i,
  /window\.location\.(?:href|replace)\s*=/i,
  /^\s*redirecting/i,
  /client closed connection|connection reset|connection timed out/i,
  /error 5\d\d/i,
];

/**
 * Is this capture archive.org telling us it has nothing, rather than a real page
 * that simply carries no owner figure?
 *
 * Without this the sync cannot tell "the archive does not have this URL" (zero
 * captures exist — the summary would look like a successful run that recovered
 * nothing) from "the capture exists but the number is not on it", so the
 * backfill would report success while writing nothing.
 *
 * Size is the primary signal because it is the one that never produces a false
 * positive: a real badge page from any of the sources renders far above
 * MIN_REAL_PAGE_CHARS, and every archive.org error stub renders far below it.
 */
export function isLikelyArchiveErrorPage(html: string): boolean {
  if (typeof html !== "string") return true;
  if (html.trim().length === 0) return true;

  const text = plainText(html);

  for (const probe of DECISIVE_STUB_PROBES) {
    if (probe.test(text)) return true;
  }
  if (text.trim().length >= MIN_REAL_PAGE_CHARS) return false;

  for (const probe of SHORT_STUB_PROBES) {
    if (probe.test(text)) return true;
  }
  // A stub that still mentions the subject is not an archive failure — it is a
  // real (if truncated) page, and belongs in the "no data" bucket.
  return !REAL_PAGE_MARKERS.test(text);
}

/**
 * Recover the owner count from an archived capture, or null.
 *
 * `badgeKey` is the difference between a usable parse and a null on any page
 * that embeds more than one record: pass the catalog `set_id` (or the archive
 * source's own slug) whenever the caller knows it. A potat badge page routinely
 * embeds owner counts for many badges, and without the filter the first record
 * in that array wins.
 *
 * Never throws. A malformed capture must produce null, never an exception that
 * aborts a backfill mid-batch.
 */
export function parseArchivedOwnerCount(
  html: string,
  badgeKey?: string | null,
): number | null {
  if (typeof html !== "string" || html.length === 0) return null;
  const key = badgeKey ?? null;
  try {
    // Cheap decisive-phrase pre-check only; the full detector is left to the
    // caller so the skip can be ATTRIBUTED to the archive rather than to "no
    // data on this page", and so the capture is not tag-stripped twice.
    for (const probe of DECISIVE_STUB_PROBES) {
      if (probe.test(html)) return null;
    }

    const jsonLd = jsonLdCandidates(html);
    if (jsonLd.length > 0) return resolveOwnerCount(jsonLd, key);

    // Embedded site payloads outrank both the attributes and the prose: they
    // carry potat's own field names, which say what the number is, whereas a
    // labelled line of prose only suggests it.
    const embedded = embeddedJsonCandidates(html);
    if (embedded.length > 0) return resolveOwnerCount(embedded, key);

    const attributes = attributeCandidates(html);
    if (attributes.length > 0) return resolvePlainCount(attributes);

    const prose = proseCandidates(html);
    if (prose.length > 0) return resolvePlainCount(prose);

    return null;
  } catch {
    // A pathological capture (adversarial nesting, a regex blowing the stack on
    // a huge body) is a lost data point, not a failed sync.
    return null;
  }
}
