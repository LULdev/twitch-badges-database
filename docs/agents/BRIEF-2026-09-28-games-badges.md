# BRIEF — Games speed + badge detail pages (2026-09-28)

## Read first
- `AGENTS.md` (project rules; **mandatory** changelog rule, i18n rule, verification ritual)
- `README.md` if you need data-source context

## HARD RULES for every agent
1. **DO NOT EDIT ANY FILE.** You are a *collector*. You return **complete, copy-pasteable
   code** in your final message. The main agent implements and verifies. Read-only tools
   (Read/Grep/Glob) plus `Bash` for *reading* only.
2. Code must match the repo's existing style: TypeScript strict, `camelCase` for
   functions, 2-space indent, JSDoc-style block comments **only** where a constraint is
   non-obvious, i18n strings via `messages/<locale>.json`, styling via `globals.css`
   component classes (`.card`, `.btn`, `.chip`, `.prose-content`, `.section-title`),
   `import { Link } from "@/i18n/navigation"` (named import), no emojis, inline SVG icons.
3. React Compiler lint rules are enforced: no sync `setState` inside an effect body
   (wrap in `setTimeout`/`requestAnimationFrame`); no `Date.now()` during render.
4. Every DB read must be resilient (`.catch(() => …)`) on badge pages, because an
   un-migrated DB must render an empty state, not a crash.
5. Report **evidence**: cite `file:line` for every claim about existing behaviour.

---

## PART A — Games must feel instant

### The measured problem
Clicking **Spin** on `/[locale]/wheel` does nothing visible for a long time. Cause:
`WheelOfFortune.tsx` only calls `setRotation()` **after** `await fetch("/api/wheel/spin")`
resolves (line ~82-109). The server chain is fully serial:

`/api/wheel/spin` → `playerGate()` → `getFeatures()` → `spinWheel()`:
`ensureProgress()` (INSERT) → `rpc claim_wheel_gate` → `rpc apply_xp_coins` /
`consume_and_apply_game_xp` (inside `award()`) → `getProgress()` inside `award()` →
`update user_progress` → `evaluateAchievements()` (many queries) → `logActivity()`.

Same shape in `/api/games/play` → `playGame()` (`src/lib/gamification/games.ts:75-258`),
which performs **~10 strictly sequential** Supabase round trips before responding:
settings read → flood-check select → `getProgress` → resolver → `currentStreakFlags`
select → insert round → re-select newest 2 → `rpc bump_counters` → `bumpCoins` rpc →
`getEconomy()` → `award()` → `evaluateAchievements()`.

### Agent scopes

**A1 — `wheel-client`** — `src/components/WheelOfFortune.tsx`
Make the wheel move on the same frame as the click. Required behaviour:
- On click, start an **optimistic "waiting" spin** driven by `requestAnimationFrame`
  writing `style.transform` directly on the wheel DOM node (~2 deg/frame). Zero latency
  between click and motion.
- When the response arrives, cancel the rAF loop, compute the final angle **relative to
  the current animated angle** (so the settle animation continues from where the wheel
  actually is, never jumps), and apply a CSS `transition` for the deceleration. Show the
  result card at the end of the settle.
- On an error, unwind: rAF cancelled, rotation settled back to a neutral resting angle,
  button re-enabled, existing i18n error copy unchanged.
- Also: the centre circle currently renders a non-interactive "Spin" label inside the
  wheel — make the whole wheel face clickable (button semantics, `aria-disabled`,
  keyboard focusable) in addition to the existing bottom button.
- Keep the server authoritative: the **amounts shown come from the response**, never
  from the local `SEGMENTS` table (that invariant is documented at the top of the file).
- Return the **full rewritten file**.

**A2 — `play-roundtrip`** — `src/lib/gamification/games.ts` (`playGame`)
Cut server latency without weakening any of the existing safety properties (race
voiding, `bump_counters` atomicity, coin settlement, economy grading). Concretely:
- Hoist the two settings reads (`getGames`/`getFeatures`) so they overlap with the
  flood-check select instead of running before it.
- The flood-check `select` and the per-game streak `select` are independent — run them
  concurrently. The post-insert race recheck must stay *after* the insert.
- `getEconomy()` and `currentStreakFlags` are independent of each other.
- `evaluateAchievements()` is called with `.catch(() => undefined)` and is **not** part
  of the response — make it fire *after* the response is constructed, without changing
  the function's public contract. Propose the exact mechanism (e.g. a fire-and-forget
  helper that does not block, or moving it behind `queueMicrotask`/an explicit
  `after(() => …)` callback) and state clearly what is guaranteed vs best-effort.
- `logActivity`/feed writes inside `award()`: identify which are on the critical path.
Return **exact diffs** (`// filename` + full replacement functions), not prose.

**A3 — `xp-award`** — `src/lib/gamification/xp.ts` + `achievements.ts`
`award()` and `evaluateAchievements()` are called on **every** wheel spin and every
single game round, so their round-trip count multiplies across the whole site.
- Enumerate the exact number of sequential Supabase calls per path (quote line numbers).
- Propose a **request-scoped / module-level short-TTL cache** for the read-only data
  these functions re-read every time (`getProgress` in `award()`, the achievement
  catalogue, the profiles read inside `logActivity`). It MUST be safe: name the TTL, say
  exactly which fields may be stale, and state which consumers cannot tolerate staleness
  (the balance shown in the response, the flood check, the bet affordability check).
  `getProgress` is used for the **coin balance returned to the client** — say explicitly
  whether it may be cached and how the returned balance stays correct.
- Propose an `evaluateAchievements` fast path: skip the whole evaluation when nothing
  that feeds an achievement could have changed, or when a per-user "last evaluated at"
  watermark makes a re-run pointless. Give the migration sketch if a column is needed
  (`supabase/migrations/00XX_*.sql`, matching the existing ledger conventions).
Return exact code, not a description.

**A4 — `games-ui`** — `src/components/games/*.tsx` (13 components + `useGame.tsx`)
Every game component blocks its own animation on the server round trip. For each of the
13, note where the UI waits on `await play(...)` before showing motion, and give the
optimistic/parallel treatment: start the client animation immediately, render the
verdict from the response when it lands. Also:
- `useGame.refresh()` hits `/api/progress` on mount for every game page — propose
  prefetching the balance (e.g. from the header HUD that already renders it) instead.
- The 1/s rate limit means a rejected round returns `roundFailed`; several components
  may leave a "flying" animation stuck. Identify which ones and how they should reset.
Return per-file diffs.

**A5 — `daily-wheel-server`** — `src/lib/gamification/daily.ts`,
`src/app/api/wheel/spin/route.ts`, `src/app/api/daily/claim/route.ts`,
`src/lib/gamification/wheel.ts`
- `playerGate()` + `getFeatures()` run serially in the route before the engine starts.
  Propose the safe overlap and state what must remain serial (the ban check gates the
  mutation; nothing may be written before it resolves).
- `spinWheel`: `ensureProgress()` runs on *every* spin even though the gate RPC would
  also create the row — check `claim_wheel_gate` in the migrations and say whether
  `ensureProgress` is redundant, and if so how to drop it without changing behaviour for
  a first-time user.
- The Turbo jackpot path awaits `logActivity` + `createFeaturePost` **before returning**
  the spin result — that is an unbounded-feeling wait on a 1-in-100,000,000 path.
  Make it non-blocking without losing the compensating delete.
Return exact code.

---

## PART B — Badge detail pages need real content

Every badge page at `/[locale]/badges/[slug]` needs:
**(1) a detailed, badge-specific FAQ**, **(2) simplified owner counts**, and
**(3) more genuinely useful information**.

### Available data (`BadgeRow`, `src/lib/queries.ts:3-36`)
`set_id, version, slug, title, description, image_url_*, click_url, category, is_paid,
how_to_earn, start_date, end_date, release_date, status, first_seen_at, last_seen_at,
removed_at, source, owner_count, active_count, percentage, last_polled_at,
rarity_score, rarity_tier, created_at, updated_at`
Plus: `getBadgeStatsHistory(badge.id)` → `{polled_at, owner_count, active_count}[]`,
`fetchBadgeLiveStats(setId)` → `{userCount, percentage}`, related badges in the same
`category`, and `src/lib/rarity.ts` (TBRI).

### Agent scopes

**B1 — `badge-faq`** — a NEW file `src/lib/badges/faq.ts`
Write a pure, server-safe module that builds a **per-badge FAQ** from a `BadgeRow`:
`export function buildBadgeFaq(badge: BadgeRow, ctx: FaqContext): BadgeFaq`
where `BadgeFaq = { items: Array<{ q: string; a: string }>; jsonLd: object }`.
Requirements:
- Questions must be **derived from the badge's actual data** (status + dates → "is it
  still available?"; `owner_count`/`percentage` → "how many people have it?"; rarity tier
  + score → "how rare is it?"; `is_paid` → "does it cost money?"; `click_url`/`category`/
  `how_to_earn` → "how do I get it?"; version/set_id → "is this the same as badge X?").
  Aim for **8–12 questions per badge**, all answerable from the row.
- Answers must be **honest**: no invented statistics. Where the data is null, the answer
  must say the number is not known rather than printing 0 — this exact bug exists today
  (see the comment at `badges/[slug]/page.tsx:248-252`).
- The FAQ must cover the questions a visitor actually asks: availability window,
  how to earn, cost, rarity, whether it expires, whether it stays after subscribing
  lapses, why the owner count differs from the live count, what the set id means,
  how the site determines the status, and how the user can get it on their own channel.
- Return the complete file plus a short list of the i18n message keys it needs
  (`badgeFaq.<key>` under a new `faq` namespace or the existing `badges` namespace —
  recommend one and justify it).

**B2 — `badge-faq-ui`** — the JSX that renders it
Give the exact JSX for the badge detail page to (a) render the FAQ as an accessible
`<details>/<summary>` accordion or disclosure list with the repo's classes, and
(b) emit a `schema.org/FAQPage` JSON-LD script next to the existing `Product` JSON-LD.
Requirements:
- The existing `jsonLdScript()` helper (`src/lib/jsonld.ts`) and the `Product` block at
  `badges/[slug]/page.tsx:112-130` must stay valid — show the merged object.
- The visible answers and the JSON-LD answers must be **identical strings** (Google
  penalises a mismatch). Show how to render from one source.
- Every visible string goes through `messages/<locale>.json` — give the exact key set.
- Must degrade gracefully when the FAQ is empty.
Return the exact JSX blocks to insert and where.

**B3 — `owner-count`** — simplify the owner-count display
Today `badges/[slug]/page.tsx:243-295` stacks up to **four** numbers in a row:
`owner_count`, `active_count`, live `userCount (+%)`, and `percentage` — which
contradicts each other (the DB `owner_count` and the live potat `userCount` are polled
at different times by different sources) and reads as clutter.
- Recommend a single, clearly-labelled **primary** ownership figure and which source it
  should come from, with the reason. Justify it against the sync architecture
  (`src/lib/twitch/potat.ts`, `src/lib/syncs/*`).
- Collapse the rest into a compact, labelled secondary block.
- Add a "last updated" line tied to `last_polled_at` so a stale number is self-evident.
- Consider compact notation for large numbers (e.g. `1.2M`) — decide whether that is a
  win for this page and give the formatter with locale-correct output.
- Produce the exact replacement JSX for the whole `<dl>` and the exact
  `messages/en.json` + `messages/de.json` keys (full JSON fragments, not just names).
- Do **not** break the JSON-LD `Product` or the `t("ownerCount", {count})` ICU plural
  contract without showing the replacement.

**B4 — `badge-extra-info`** — more useful content sections
Propose 3–5 genuinely useful, **data-backed** additions to the badge page — no filler.
Good candidates (verify what the data actually supports, and drop any that do not):
a **timeline** (first seen / start / end / last seen / removed, from the real date
columns), a **rarity explainer** (TBRI in plain language, from `src/lib/rarity.ts`),
a **"how this site knows"** provenance line (which source `badge.source` is and when it
was last polled), an **ownership trend summary in words** (derived from
`getBadgeStatsHistory`: is it growing or shrinking, over what window), and a
**version/sibling list** (other versions of the same set — check whether a query for it
is needed and give it).
For each: the exact JSX, the data query (with `.catch()`), the i18n keys, and a one-line
justification of why it helps a visitor. Prefer 3 excellent sections over 5 thin ones.

**B5 — `i18n-locales`** — `messages/*.json`
After B1/B2/B3/B4 settle, the repo has 11 locales:
`en, de, fr, es, it, pt, nl, pl, ru, tr, ja` (verify with `ls messages/`).
Produce the **new/changed key fragments for the 9 non-English locales**
(fr, es, it, pt, nl, pl, ru, tr, ja) for the keys B1–B4 introduce. Requirements:
- All 11 files stay **key-identical** (the project rule) — list the exact key paths.
- Real translations, not English placeholders.
- Preserve every existing ICU plural / placeholder signature exactly
  (e.g. `ownerCount` uses `{count}`), because a mismatched plural form throws at render.
- `FAQ_KEYS` in `[locale]/faq/page.tsx` builds keys dynamically and fails **silently
  per locale** if a key is missing — note any key that must also be registered there.
Return the JSON fragments per locale.

---

## Definition of done (checked by the MAIN agent, not you)
- Clicking Spin moves the wheel on the same frame; the result still comes from the server.
- Server round-trip count per wheel spin and per game round is measurably lower.
- Every badge page renders a badge-specific FAQ with honest answers, visible and in JSON-LD.
- Owner counts read as one clear primary number plus labelled detail.
- `npm run lint && npm run typecheck && npm run build` clean; no `MISSING_MESSAGE` in the log.
- A timestamped changelog entry exists for the change.
