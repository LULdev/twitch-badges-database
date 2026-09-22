# Agent idea 03 — ordinary & utility / quality-of-life ideas

Scope: 12 unglamorous features a badge catalog is *expected* to have. Every
idea uses badge catalog data (owner counts, rarity/TBRI, drop and claim
windows, categories, image UUIDs), a user's inventory, or the existing
XP/BadgesCoins gamification. None of these duplicates the 74 ideas already in
`IMPROVEMENTS.md` (#31 wishlist alerts, #32 filtered public collections, #34
export, #41 rarity slider, etc. are deliberately avoided).

---

## Claimable-now filter with time-remaining sort
- **Category**: ordinary
- **What**: A top-level filter chip on `/badges` that shows only badges whose
  claim window is currently open, sorted by "closes soonest" by default, with
  the remaining time rendered as the existing `.countdown` component on each
  tile. It is a saved preset combination of `start_date <= now <= end_date`
  plus an ascending `end_date` sort, and it is also exposed as a visible
  `/badges?status=claimable` link so the state is shareable.
- **Why it fits**: The catalog already stores `start_date`/`end_date` per badge
  (badgebase sync, `data-reset` parsing) and the countdown component already
  computes remaining time. Visitors currently have to scan a mixed grid to
  answer "what can I get right now", which is the single most common badge
  question.
- **Effort**: S
- **Risk if built badly**: A timezone-naive `now` comparison shows badges as
  claimable hours after they closed, eroding trust in the whole catalog.

## Drop-calendar subscription feed (iCal / Google Calendar)
- **Category**: utility
- **What**: A read-only `.ics` endpoint (and a "Subscribe" button on the drops
  page) that emits one all-day or timed VEVENT per badge claim window, grouped
  by category, plus per-locale titles. Users add the URL to Google/Apple
  Calendar once and never miss a window again; the feed is regenerated from the
  same window columns the site renders.
- **Why it fits**: Drop/claim windows with precise start/end are the catalog's
  core structured datum, and a calendar feed is the standard, unglamorous way
  to consume recurring dated data. It also removes the need to visit the site
  to catch a window.
- **Effort**: M
- **Risk if built badly**: An `.ics` with an unescaped `,`/`;` in a badge title
  corrupts the whole feed for every subscriber at once; also needs cache
  headers so calendar clients polling hourly do not hammer the DB.

## Badge embed / copy toolbar
- **Category**: utility
- **What**: A small toolbar under the badge image on every detail page that
  copies the badge UUID, Twitch set id, canonical image URL, page permalink,
  and a ready-made Markdown / BBCode / HTML `img` snippet. Each copy action
  confirms inline.
- **Why it fits**: Badge IDs and image UUIDs are exactly what wiki editors,
  stream overlays and other tool authors need, and the site already resolves
  set-id-vs-UUID matching internally. It turns the database into something
  other people can actually cite.
- **Effort**: S
- **Risk if built badly**: Copying an internal CDN URL that is not the public
  canonical image (or a 1x asset) spreads broken embeds across the web.

## Unified site search (badges, blog, FAQ)
- **Category**: ordinary
- **What**: One search box in the header (or a Cmd/Ctrl-K command palette) that
  queries badges by name/set id/category, blog posts by title, and FAQ entries,
  and shows a grouped result list with keyboard navigation. Today each surface
  has its own scoped search, so users have to guess where to look.
- **Why it fits**: All three corpora already exist in Postgres with text
  columns; the catalog has `name`, `set_id`, `category`, and the blog/FAQ rows
  are plain text. Cross-surface search is table stakes for a content site of
  this size.
- **Effort**: M
- **Risk if built badly**: Unescaped `%`/`_` in an ILIKE query (a documented
  past incident) silently returns everything, and an unindexed scan over the
  catalog makes the palette laggy on every keystroke — needs debounce + trigram
  index.

## Notification preferences center
- **Category**: utility
- **What**: A settings section listing every push category separately — new
  global badges, badges I own/wishlisted, tournament and game results, weekly
  digest, changelog — with per-category toggles and a quiet-hours window. The
  existing `push_subscriptions` rows get a preference JSON column the send
  helper filters on.
- **Why it fits**: Web push is already implemented and already broadcasts to
  everyone; the moment more than one notification kind exists, all-or-nothing
  is the #1 reason people unsubscribe. The data driving each category is the
  catalog change feed and the gamification events.
- **Effort**: M
- **Risk if built badly**: Filtering done client-side after send (or a payload
  shape change without a migration) means users still receive the pushes they
  switched off, which is worse than having no toggle.

## Economy ledger (XP and BadgesCoins transaction history)
- **Category**: utility
- **What**: A profile sub-page listing every XP and coin movement with a
  timestamp, source (daily login, badge unlocked, wheel, game, heist, coin
  rain), delta and resulting balance, filterable by source and date range, with
  a running-balance small chart. Also a per-source summary ("earned this month
  from games: N").
- **Why it fits**: XP and coins are awarded by at least five subsystems and
  every award already writes an event (the `/feed` shows them for all users).
  Users with an unexplained balance have no way to audit it today; a ledger is
  the expected answer to "where did my coins go".
- **Effort**: M
- **Risk if built badly**: Exposing other users' rows (or unaggregated heist
  victim-data) through a ledger view ignores RLS and leaks the economy graph;
  the page must be strictly self-scoped.

## Data freshness badges and stale-catalog banner
- **Category**: utility
- **What**: Every catalog surface (grid, badge detail, leaderboard, stats)
  shows an unobtrusive "catalog updated X ago · owners X ago" line sourced from
  the newest heartbeat/sync timestamp, and when the newest successful sync is
  older than the expected cadence the header shows a dismissible stale-data
  banner with a link to `/status` or the changelog.
- **Why it fits**: The project already records `system_heartbeats` and prunes
  them after 90 days, and the 15-minute potat cadence means data age is a real,
  user-visible quantity when a cron fails. Silent staleness is exactly the
  failure the heartbeat table was built to expose.
- **Effort**: S
- **Risk if built badly**: Thresholds hard-coded to the dev sync interval make
  the banner fire permanently in production (or never), training users to
  ignore it.

## Manual inventory re-sync with visible status
- **Category**: utility
- **What**: On the profile/inventory page, a "Sync my badges" button with the
  last-synced timestamp, which provider answered (badges.blog vs Twitch GQL
  fallback), and the count found/last run, plus a disabled/cooldown state while
  a sync is in flight. A failed sync states the reason instead of failing
  quietly.
- **Why it fits**: Ownership resolves through a third-party `/api/perfil` with
  a GQL fallback and varies per user; a new badge can be claimed on Twitch
  before the site knows. Giving the user the trigger plus a cooldown is the
  politeness boundary the AGENTS.md ToS note asks for.
- **Effort**: S
- **Risk if built badly**: No cooldown turns the button into a click-loop
  hammering a third-party API and gets the project rate-limited or blocked.

## Recently viewed and remembered filters
- **Category**: ordinary
- **What**: A small "recently viewed" strip on the home/badges page (last ~8
  badge detail pages, stored locally), and filter/sort/view state on `/badges`
  remembered between visits so returning users land on the same list they left.
  Clearing is one click.
- **Why it fits**: The catalog is paginated and filtered by rarity, category
  and status; re-deriving the same view on every visit is pure friction. The
  viewed set can also seed "back to the badge whose window is closing".
- **Effort**: S
- **Risk if built badly**: Persisted filter state that silently excludes new
  badges after a category rename shows an empty page that looks like an outage.

## Report a data problem on a badge
- **Category**: utility
- **What**: A discreet "Report an issue" control on each badge page with a
  fixed reason list (wrong window, missing/wrong image, wrong owner count,
  duplicate entry, wrong category) plus optional free text; submissions land in
  a moderation table visible to `ADMIN_LOGINS` and are auto-acknowledged to the
  reporter.
- **Why it fits**: The catalog is stitched from four external sources (Helix,
  badgebase, potat, perfil) and each has known failure modes; users are the
  only ones who notice a per-badge error before the next 15-minute sweep. It
  routes corrections to the people who can actually edit the row.
- **Effort**: S
- **Risk if built badly**: An unthrottled public write endpoint becomes spam
  storage, and storing free text unescaped turns the admin list into a stored
  XSS for whoever reviews it.

## OBS / browser-source overlay of live drops
- **Category**: utility
- **What**: A minimal, chrome-free route (`?widget=1` on the claimable view)
  designed as an OBS browser source: current claimable badges with countdowns,
  transparent background, auto-refresh on the existing server refresh cadence,
  and query params for scale, theme and max rows.
- **Why it fits**: Twitch badges and streamers are the same audience, and the
  site already renders live countdown tiles and refreshes server data once a
  minute. A creator keeps this up for their whole stream, which is passive,
  continuous distribution.
- **Effort**: L
- **Risk if built badly**: A widget that polls too aggressively (or defeats the
  cache) multiplies the site's own traffic by every concurrent stream and can
  take the catalog down during a big drop.

## New-collector onboarding checklist
- **Category**: ordinary
- **What**: A dismissible checklist card on the dashboard for accounts without
  progress: link Twitch (if not yet), sync your badges, claim the daily login,
  spin the wheel once, set a profile display name, add your first wishlist
  item. Each step deep-links to the surface that completes it and is checked
  off from real state, not from a click.
- **Why it fits**: XP, coins, 125 achievements, 13 games, the wheel and the
  inventory all exist but nothing walks a first-time visitor through them; the
  completion state is derivable from `user_progress`, inventory rows and the
  wishlist, so no new mechanics are needed.
- **Effort**: M
- **Risk if built badly**: Checking steps off optimistically client-side shows
  a completed checklist for work that failed (e.g. inventory sync never ran),
  so the user believes their collection is tracked when it is not.