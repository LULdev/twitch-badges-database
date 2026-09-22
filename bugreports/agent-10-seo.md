# Agent 10 — SEO audit

## seo-1: Pages without their own `alternates` inherit the layout canonical → canonicalise to the homepage
- **Severity**: critical
- **Side**: server
- **File**: src/app/[locale]/layout.tsx:33-36 (root cause) + affected pages: src/app/[locale]/badges/page.tsx, active/page.tsx, blog/page.tsx, changelog/page.tsx, compare/page.tsx, expired/page.tsx, stats/page.tsx, leaderboards/page.tsx, upcoming/page.tsx, notifications/page.tsx, login/page.tsx, games/[game]/page.tsx
- **Evidence**: `curl -s https://twitch-badges-database.vercel.app/en/badges | grep canonical` →
  `<link rel="canonical" href="https://twitch-badges-database.vercel.app/en"/>` (200, page title is "All badges · Twitch Badges Database").
  Same for /en/active, /en/stats, /en/leaderboards, /en/upcoming, /en/blog, /en/changelog, /en/compare, /en/expired, /en/games/wheel, /en/notifications, /en/login (all canonical = /en).
  The layout sets `alternates: { canonical: \`/${locale}\`, languages: localeAlternates("/") }` and Next inherits parent metadata for pages that return a `Metadata` object without an `alternates` key.
- **Why it is a bug**: /en/badges, /en/stats, /en/compare, /en/leaderboards, … each declare the homepage as their canonical URL. Google will treat them as duplicates of the homepage and drop them from the index; the hreflang set they emit also points at the homepage in every locale (curl shows alternates /en, /pt-BR, … /pt, not /badges).
- **Confidence**: confirmed
- **Fix direction**: add `alternates: { canonical: \`/${locale}/<path>\`, languages: localeAlternates("/<path>") }` to every page's `generateMetadata`, or drop `canonical`/`languages` from the layout and set them per page.

## seo-2: Sitemap hreflang codes disagree with the page-level hreflang codes
- **Severity**: medium
- **Side**: server
- **File**: src/app/sitemap.ts:32-34
- **Evidence**: sitemap emits `<xhtml:link rel="alternate" hreflang="pt" href="…/pt" />` and `hreflang="zh"`, while the pages emit `hrefLang="pt-BR"` and `hrefLang="zh-Hans"` (curl sitemap.xml vs /en/badges), and the sitemap static entries have **no** `x-default` while pages do. Sitemap maps `routing.locales.map((alt) => [alt, …])` (raw codes); pages use `localeHtmlLang`.
- **Why it is a bug**: Google requires hreflang annotations in the sitemap and on the page to agree; conflicting values (`pt` vs `pt-BR`, `zh` vs `zh-Hans`) can cause the whole alternate cluster to be ignored.
- **Confidence**: confirmed
- **Fix direction**: build the sitemap languages map from `localeHtmlLang` (as `localeAlternates` does) and add `x-default`.

## seo-3: Sitemap static `lastModified` is `new Date()` — changes on every regeneration
- **Severity**: low
- **Side**: server
- **File**: src/app/sitemap.ts:28
- **Evidence**: `<lastmod>2026-09-22T05:41:15.311Z</lastmod>` on static entries; `export const revalidate = 3600` regenerates hourly so the timestamp advances each hour.
- **Why it is a bug**: a `lastmod` that always equals "now" is ignored by crawlers as unreliable, so real content updates lose their freshness signal.
- **Confidence**: confirmed
- **Fix direction**: omit `lastModified` for static routes or derive it from a stable value (e.g. deploy time / newest catalog row).

## seo-4: Sitemap omits several canonicalised, indexable routes
- **Severity**: low
- **Side**: server
- **File**: src/app/sitemap.ts:10-21
- **Evidence**: `staticPaths` = ["", "/badges", "/active", "/upcoming", "/expired", "/leaderboards", "/stats", "/compare", "/blog", "/changelog"]; no entries for /faq, /games, /games/[game], /achievements, /wheel, /feed, /profile/[username], which all render and set canonicals. Curl: 5610 `<loc>` entries, none matching `/faq`, `/games/`, `/achievements`, `/wheel`, `/feed`.
- **Why it is a bug**: those pages are never discovered via the sitemap even though they are intended to be indexed.
- **Confidence**: confirmed
- **Fix direction**: add the missing static routes (and a bounded set of game/profile URLs) to `staticPaths`.

## Checked, no defect found
- OG endpoint edge cases via curl: emoji `u=emojiuser😀` → 400 (regex rejects, expected), 25-char `u=www…` → 200 PNG, non-existent users `zzz…`/`qqq…` → 200 PNG.
- robots.txt rules, manifest icons (/icon-192.png, /icon-512.png → 200), badge-detail canonical + description (130 chars), RSS guid/pubDate format.