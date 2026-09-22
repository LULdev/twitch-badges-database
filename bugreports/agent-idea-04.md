# Agent idea 04 — social / community + cool

Scope: 12 new ideas that use Twitch badges, the catalog data (owner counts,
rarity/TBRI, drop/claim windows, categories), the collector community, or the
existing gamification (steals, coin rain, feed, profiles, XP, leaderboards).
Checked against the 74 ideas already listed in `IMPROVEMENTS.md` — none of the
twelve below repeats those (no duels, tournaments, drop room, weather map,
thinkles, bounties, guestbook-free profile comments, etc.).

---

## Collector Crews
- **Category**: social
- **What**: Teams of up to 12 collectors form a crew with a shared name, emblem
  and combined XP/coin pool. A crew leaderboard ranks crews weekly, and a crew
  unlocks its own collective achievement when members together own a full
  category or a set number of legendary-tier badges. Crew chat is replaced by a
  crew activity strip on the profile.
- **Why it fits**: builds directly on the existing XP/level system and the
  `achievements` evaluation loop, and gives the public `/feed` a second, team-
  sized narrative line. Rarity tiers give crews a concrete shared goal.
- **Effort**: M
- **Risk if built badly**: elitism and closed recruiting cliques; invite spam in
  profile pushes if there is no rate limit on crew invitations.

## Drop Watch Parties
- **Category**: social
- **What**: A collector can open a scheduled "watch party" tied to a badge's
  `end_date` window: a shared countdown page people RSVP into, with an optional
  rem.to-claim reminder. Everyone who checks in while the window is live earns a
  small group XP bonus added to the feed as one party event.
- **Why it fits**: the badgebase-derived start/end windows already power the
  countdown component; this turns an empty waiting period into a joint action.
  Uses `notifications`/web-push plumbing that already exists.
- **Effort**: M
- **Risk if built badly**: reminder spam and notification fatigue if RSVPs are
  not strictly opt-in and timezone-correct.

## Community Field Notes
- **Category**: social
- **What**: A crowdsourced wiki layer over badges whose drop window, category or
  how-to-earn is missing or vague in the badgebase feed: collectors submit
  field notes ("drops in the Twitch mobile app only"), others confirm or
  dispute. Confirmed notes are shown on the badge page with a contributor name
  and a reputation counter.
- **Why it fits**: the catalog already has gaps by design (badgebase is the
  authoritative source but not exhaustive); an in-house reputation system
  extends the existing XP model to data work, not just games.
- **Effort**: M
- **Risk if built badly**: bad-faith or malicious edits to earn XP — needs
  moderation queues, sources required, and no XP for unconfirmed notes.

## Collector Mentorship
- **Category**: social
- **What**: A newcomer opts in as a "mentee" and is paired with a higher-level
  collector; the pair gets a shared progress card (XP gained together, badges
  unlocked while paired) and small mutual bonuses when the mentee crosses a
  level. Pairs are listed as a short chain on both profiles.
- **Why it fits**: directly reuses the XP/level curve and profile pages, and
  gives the 125 achievements a social payoff. Solves the "level 40 user has
  nothing to do" retention gap.
- **Effort**: M
- **Risk if built badly**: grooming-style DMs if a private channel is added;
  keep all contact public/on-site and pairings easy to break.

## Profile Guestbook (badge stamp)
- **Category**: social
- **What**: Visitors can leave one short note on a profile per day, each stamped
  with the badge icon they are currently displaying on Twitch or the rarest
  badge in their collection. Owners can hide the whole wall or individual
  entries with one click.
- **Why it fits**: the visitor tracker with 5-minute IP dedup already knows who
  arrived and when, so the guestbook is a thin layer over existing plumbing;
  the badge stamp makes it unmistakably this site's artifact.
- **Effort**: S
- **Risk if built badly**: harassment and doxxing in free text; ship with
  hide-all-by-default option, length cap, and a report button before allowing
  public walls at all.

## Coin Gift Wall
- **Category**: social
- **What**: A collector can send BadgesCoins to another with a public thank-you
  message, and every accepted gift appears on a site-wide "gifts" wall with both
  names and the amount. A weekly top-gifter strip gives the wall its own small
  leaderboard.
- **Why it fits**: BadgesCoins already flow through steals and coin rain; this
  adds a positive, non-adversarial flow to an economy that is currently entirely
  predatory, and reuses the atomic counter pattern the steals rely on.
- **Effort**: S
- **Risk if built badly**: farming alternative accounts to launder coins or
  fake generosity — needs hard transfer limits and no public ranking by amount
  alone.

## Local Chapters
- **Category**: social
- **What**: Self-declared city/region chapters let collectors find people
  nearby who are chasing the same badges, plus a per-chapter feed of "who
  unlocked what this week". Chapters get a dedicated page with a map and an
  optional link to a public Discord.
- **Why it fits**: works off the existing profile and activity data, and the
  owner-delta data behind rarity momentum makes "local trend" legible without
  exposing any individual's real location.
- **Effort**: M
- **Risk if built badly**: location privacy — region granularity must be coarse
  and purely self-declared, never GPS or IP-derived.

---

## Badge Soundtrack
- **Category**: cool
- **What**: Turns a badge's six TBRI signals into a short looping audio clip —
  owner scarcity drives tempo, claim-window brevity drives rhythm density, age
  drives the octave. Each badge gets a play button next to its rarity score and
  a deterministic seed so the same badge always sounds the same.
- **Why it fits**: TBRI is the site's proprietary differentiator and the
  computation already exists in `rarity.ts`; a deterministic mapping to audio
  needs no new data, only a client-side synth.
- **Effort**: S
- **Risk if built badly**: autoplay audio and accessibility regressions — must
  be click-to-play, respect `prefers-reduced-motion`, and never autostart.

## Badge Constellation
- **Category**: cool
- **What**: Plots the whole catalog as a night sky: brighter stars are higher
  rarity, star colour is the rarity tier, and stars cluster by category the way
  constellations do. Clicking a star opens the badge; a "your sky" mode dims
  everything you do not own.
- **Why it fits**: reuses owner counts and TBRI directly, and gives the
  catalog a second, exploratory view that is nothing like the existing grid and
  behaves well on the live-updating data.
- **Effort**: M
- **Risk if built badly**: perf on a catalog of many thousands of points if it
  rerenders per owner-count tick instead of on a debounce.

## Collection Binder
- **Category**: cool
- **What**: A trading-card-binder view of a profile: badge icons snapped into
  pocketed sheets, with empty sockets for the badges in a chosen category the
  collector has not unlocked yet. Flipping a page animates the badges in.
- **Why it fits**: the owned/missing split is already computed at login via the
  perfil path, and the "empty sockets" make missing badges as visible and
  motivating as owning them.
- **Effort**: M
- **Risk if built badly**: a purely cosmetic feature that inflates profile page
  weight; keep it lazy and off the default path.

## Rarity Wall
- **Category**: cool
- **What**: A full-screen ambient mode showing the entire catalog as a slowly
  drifting wall of badge tiles; tiles pulse when a badge's owner count changes
  and dim when a claim window closes. Intended as something a collector leaves
  running on a second monitor.
- **Why it fits**: the 15-minute potat sync is already a stream of owner
  deltas, so the wall has genuinely live content; it turns the sync cadence the
  project is proud of into something visible.
- **Effort**: M
- **Risk if built badly**: constant polling from an idle tab would hammer the
  site and the upstream data source — needs a single shared stream and a cap.

## Palette Pull
- **Category**: cool
- **What**: Generates a site accent theme from the dominant colours of your
  rarest owned badge, applied to your profile and (optionally) the whole site
  for your session. A "surprise me" mode pulls from a random legendary in the
  catalog.
- **Why it fits**: badge art is already served from the synced image assets, so
  the palette is derivable with no new data, and it plugs straight into the
  existing `--accent` token system in `globals.css`.
- **Effort**: S
- **Risk if built badly**: unreadable dark/light contrast from arbitrary badge
  palettes — clamp luminance and contrast server- or client-side before apply.

## Badge Review Board
- **Category**: cool
- **What**: A community rating view for every badge: "how hard is it to earn",
  "is it worth the grind", and "will you still display it next month", averaged
  from collector votes with the voter's level shown next to their score. The
  aggregate feeds a "most underrated" and "most overhyped" leaderboard.
- **Why it fits**: combines the existing rarity score (objective) with the
  subjective wear signal the project already computes, giving the catalog a
  human judgement layer it deliberately does not currently have.
- **Effort**: M
- **Risk if built badly**: review-bombing a badge, and vote manipulation by
  fresh accounts — needs level or age gating and visible sample sizes.