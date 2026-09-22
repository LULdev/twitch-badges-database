# Agent Idea Report #8 — growth, retention, content & community

Scope: 12 features that reuse surfaces that already exist (login, inventory,
leaderboards, push, RSS, profile, games, changelog). Nothing here repeats the
74 ideas in `IMPROVEMENTS.md`, and nothing depends on scraping a
ToS-protected source beyond what the project already queries politely.

---

## Embeddable Live Badge Widget
- **Category**: growth
- **What**: A one-line `<script>`/`<iframe>` embed that renders a badge's live owner count, countdown or a user's TBRI score, with a small "Powered by" backlink. Any streamer, fansite or Discord bot page can paste it; the widget reads the same public catalog rows the badge page already serves.
- **Plugs into**: badge detail pages (catalog reads) + profile
- **Why it works for a collector**: every pasted widget is a permanent, self-updating ad carrying the collector's own rarity flex.
- **Effort**: M

## Guest Inventory Preview (soft login wall)
- **Category**: growth
- **What**: A visitor types any Twitch login and immediately sees that account's owned/missing badges, rarity score and rank — read through the existing `/api/perfil` path with the same caching and Twitch GQL fallback. Saving, tracking and alerts then require the existing Twitch login.
- **Plugs into**: login + inventory
- **Why it works for a collector**: the ranked, gap-highlighted result is the pitch; a loginless visitor has already "seen their collection" before being asked to keep it.
- **Effort**: M

## Missing-Badge Challenge Card
- **Category**: growth
- **What**: A share card generated from the existing OG route that frames the collector's gap instead of their haul ("3 badges from a complete Legendary set"). One tap exports a PNG/copyable link aimed at the friends who can help fill it.
- **Plugs into**: inventory + profile (OG images)
- **Why it works for a collector**: it turns an incomplete collection into a public challenge, which is the most shareable thing a completionist owns.
- **Effort**: S

## Lapse-Back Crate
- **Category**: retention
- **What**: Track last-seen per profile and, on the first login after a 7-day absence, grant one "welcome back" crate (coins + a modest XP boost) once per lapse period — separate from the existing daily-streak bonus, which rewards continuity rather than return.
- **Plugs into**: login + games/economy
- **Why it works for a collector**: a lapsed collector gets a reason to open the site rather than the awkwardness of a broken streak.
- **Effort**: S

## Weekly Themed Leaderboard Rotations
- **Category**: retention
- **What**: Feature one rotating ranking per week alongside the global boards — "rarest single badge owned", "biggest rank climb", "fastest to claim this week's drop" — each computed from data already collected, with the current theme pinned to the homepage.
- **Plugs into**: leaderboards + changelog (weekly announcement row)
- **Why it works for a collector**: a collector who cannot top the lifetime board can still win a niche board this week, so there is a fresh goal every Monday.
- **Effort**: M

## Catalog-Locked Profile Frames
- **Category**: retention
- **What**: Unlock a handful of profile frames/effects by real catalog milestones instead of coins — own every badge in a category, complete a rarity tier's currently-claimable set, or hit a level tier. The reward hooks into the existing 35 profile customization settings and renders on the public profile.
- **Plugs into**: profile + inventory + achievements
- **Why it works for a collector**: progress in the catalog becomes permanently visible on the profile, so collecting has a display payoff beyond a number.
- **Effort**: M

## Badge of the Day
- **Category**: content
- **What**: One short editorial entry per day — a badge, its rarity tier, a one-line history and how to earn it — chosen from the catalog by a deterministic daily roll and published to the blog and the feed. Extends the auto-blog cadence, which today only fires on brand-new badges.
- **Plugs into**: blog + RSS + push (optional daily digest)
- **Why it works for a collector**: a daily reason to open the site that surfaces badges the collector already passed over.
- **Effort**: S

## "This Month in Badges" Catalog Digest
- **Category**: content
- **What**: A monthly post assembled from the `changelog` table itself: badges added, badges expired, tier promotions and demotions, and the biggest rarity movers. Because every sync already writes a changelog row, the digest is generated, not hand-written.
- **Plugs into**: changelog + blog + RSS
- **Why it works for a collector**: skimming one monthly post catches every catalog change they would otherwise chase one row at a time.
- **Effort**: S

## How-to-Earn Playbooks
- **Category**: content
- **What**: Expand each badge's existing how-to-earn line into a step-by-step playbook: where to claim, whether it is free or paid, region caveats and the deadline countdown. Admin-editable (the same `ADMIN_LOGINS` gate as other content) and localized through the existing message files.
- **Plugs into**: badge detail pages + blog
- **Why it works for a collector**: it answers "how do I actually get this before it expires" on the page where the collector is already looking at the countdown.
- **Effort**: M

## Community Corrections Queue
- **Category**: community
- **What**: A logged-in collector can submit a correction — wrong window date, missing region, broken how-to-earn text — from the badge page; submissions land in a moderation queue that admins resolve, and accepted fixes write a changelog row. Distinct from free-form comments: every entry is an actionable data edit.
- **Plugs into**: profile + badge detail pages + changelog
- **Why it works for a collector**: contributors get credited fixes in the changelog, giving expert collectors a way to improve the catalog itself.
- **Effort**: M

## Collector Fleets
- **Category**: community
- **What**: Small opt-in groups (a "fleet") with a shared aggregate score — combined rarity, total badges owned, member count — and their own ranking beside the existing global leaderboards. Members join from their profile and the fleet page links back to each member's public collection.
- **Plugs into**: leaderboards + profile
- **Why it works for a collector**: a lone collector gets a squad to compare with and a reason to recruit more owners of rare badges.
- **Effort**: L

## Feed Cheers
- **Category**: community
- **What**: Let the existing live XP feed (`/feed`) carry lightweight reactions — a cheer or congrats on another collector's unlock or level-up — reusing the blog's existing reaction storage pattern on a new surface, rate-limited per profile.
- **Plugs into**: profile + live feed + games
- **Why it works for a collector**: an unlock stops being a silent event and becomes a moment other collectors can acknowledge in real time.
- **Effort**: S