# Badge detail page + machine-facing surfaces (SEO / structured data / OG / sitemap / RSS)

Audited: `src/app/[locale]/badges/[slug]/page.tsx`, `src/lib/seo.ts`,
`src/lib/jsonld.ts`, `src/lib/markdown.ts`, `src/app/api/og/profile/route.tsx`,
`src/app/sitemap.ts`, `src/app/robots.ts`, `src/app/api/changelog/rss/route.ts`,
`src/app/[locale]/layout.tsx`, `src/app/[locale]/games/[game]/page.tsx`,
`src/app/[locale]/blog/[slug]/page.tsx`, `src/app/[locale]/profile/[username]/page.tsx`,
`src/components/badges/Countdown.tsx`, `src/components/badges/BadgeCard.tsx`,
`src/lib/queries.ts` (badge readers), `src/lib/twitch/potat.ts` (`fetchBadgeLiveStats`),
`src/lib/blog.ts`, `messages/en.json`.

Method: read the files above; compared code against the live deployment with
`curl` (`/en/badges/<slug>`, `/en/badges`, `/en/games/rps`, `/en/profile/shroud`,
`/en/blog/…`, `/sitemap.xml`, `/robots.txt`, `/api/changelog/rss`,
`/api/og/profile`); inspected the built output with `grep`/`node`;
read-only `SELECT` against the live DB via `postgres` with the
`SUPABASE_DB_URL` from `.env.local`:
`select status, count(*) filter (where end_date is null and start_date is not null) from badges group by status`
→ active = 1 of 24 has a start date and no end date (`harley-mayhem-v1`,
`start_date 2026-09-01`, `end_date null`); sitemap = 5830 `<loc>`, 0 exact duplicates.
Could not run: `next build` (free-RAM worker crash documented in AGENTS.md),
so nothing here relies on a build.

Already-settled items deliberately **not** re-reported: seo-1/2/3/4 from
`bugreports/agent-10-seo.md` (canonical inheritance, sitemap hreflang codes,
`new Date()` lastmod, missing static routes — all now implemented), the
`javascript:` markdown href (`acp-bugs/VERIFIED.md` L14 and
`verify-fresh13.md` — admin-authored only, auto-post links are slug-safe), and
the hardcoded `/en/badges/…` link in auto blog posts (`agent-20` pg-7).

## B1 — Active badge with no end date renders a countdown strip that says "Expired"

- **Severity**: medium
- **Confidence**: high (verified by reading + live DB row + live page)
- **Where**: `src/app/[locale]/badges/[slug]/page.tsx:173-191`
- **Code**:
  ```tsx
  {(badge.status === "active" || badge.status === "upcoming") &&
    (badge.end_date || badge.start_date) && (
      <div className="…">
        <span …>{badge.status === "upcoming" && badge.start_date
          ? tcd("startsIn") : tcd("expiresIn")}</span>
        <Countdown
          target={badge.status === "upcoming" && badge.start_date
            ? badge.start_date
            : (badge.end_date ?? badge.start_date!)}
          mode={badge.status === "upcoming" && badge.start_date ? "starts" : "expires"}
        />
      </div>
    )}
  ```
- **Why it is wrong**: the guard only needs `start_date`, but the fallback
  target is `end_date ?? start_date!`. For a badge whose status is `active`
  with a start date and no end date, `status` is not `"upcoming"`, so `mode`
  is `"expires"` and `target` is the **start date, which is in the past**.
  `Countdown` then computes `total = max(0, …) = 0` and, in `"expires"` mode,
  returns the `t("expired")` chip (`src/components/badges/Countdown.tsx:55-59`).
  The page therefore renders `StatusChip` = "Live" and `RarityChip` next to a
  strip labelled "Expires in" whose value is the chip "Expired". Live row:
  `harley-mayhem-v1` (`status=active`, `start_date=2026-09-01T07:00:00Z`,
  `end_date=null`), 1 of the 24 active badges; the listing card does **not**
  have this bug (`src/components/badges/BadgeCard.tsx:87` guards
  `badge.end_date && badge.status === "active"`), so list and detail disagree.
- **How to reproduce**: by inspection of the DB row above; open
  `https://twitch-badges-database.vercel.app/en/badges/harley-mayhem-v1` and
  watch the strip after hydration (`…/badges/harley-mayhem-v1` returns 200).
- **Suspected cause**: the condition accepts `start_date` for active badges and
  then falls back to it as the expiry target.

## B2 — Sitemap advertises `/{locale}/games/{id}` pages that canonicalise to `/{locale}`

- **Severity**: medium
- **Confidence**: high (verified live)
- **Where**: `src/app/sitemap.ts:91-101`, `src/app/[locale]/games/[game]/page.tsx:34-42`
- **Code**:
  ```tsx
  // sitemap.ts
  for (const game of GAMES) for (const locale of routing.locales) {
    entries.push({ url: `${base}/${locale}/games/${game.id}`, …,
      alternates: { languages: localeAlternates(`/games/${game.id}`) } });
  }
  // games/[game]/page.tsx — generateMetadata
  if (!GAMES.some((g) => g.id === game)) return { alternates: {
    canonical: `/${locale}/games/${game}`, languages: localeAlternates(`/games/${game}`) }, };
  const t = await getTranslations({ locale, namespace: "games" });
  return { title: t(`${game}Title`), description: t(`${game}Desc`) };  // ← no alternates
  ```
- **Why it is wrong**: for a **valid** game the metadata object has no
  `alternates`, so Next keeps the parent layout's
  `canonical: /${locale}` (`src/app/[locale]/layout.tsx:33-36`). Live:
  `curl -s …/en/games/rps | grep canonical` →
  `<link rel="canonical" href="https://twitch-badges-database.vercel.app/en"/>`
  while `/sitemap.xml` lists that URL with `hreflang` alternates pointing at
  `/en/games/rps`, `/de/games/rps`, … The sitemap's own annotation therefore
  contradicts the page's canonical, and Google will fold all 13×11 = 143 game
  URLs into the locale homepage as duplicates instead of indexing them. This is
  the same class as seo-1 (reported), but that entry is still live for this
  route — the fix only covered the *unknown*-game branch.
- **How to reproduce**: `curl -s https://twitch-badges-database.vercel.app/en/games/rps | grep -o '<link rel="canonical"[^>]*>'`
  and compare with `curl -s https://twitch-badges-database.vercel.app/sitemap.xml | grep 'games/rps'`.
- **Suspected cause**: the valid-game metadata branch omits `alternates`.

## B3 — Badge detail Open Graph loses `og:type`, `og:url` and `og:site_name`

- **Severity**: low
- **Confidence**: high (verified live)
- **Where**: `src/app/[locale]/badges/[slug]/page.tsx:40-53`
- **Code**:
  ```tsx
  return { title, description,
    alternates: { canonical: `/${locale}/badges/${badge.slug}`, languages: localeAlternates(`/badges/${badge.slug}`) },
    openGraph: { title, description, images: image ? [{ url: image }] : undefined },
    twitter: { card: "summary", title, description } };
  ```
- **Why it is wrong**: Next replaces the whole `openGraph` object when a page
  defines one (`node_modules/next/dist/lib/metadata/resolve-metadata.js:182-184`
  — `newResolvedMetadata.openGraph = resolveOpenGraph(metadata.openGraph, …)`),
  so the layout's `type: "website"` and `siteName` do not survive. Live head of
  `/en/badges/rematch-blue-lock-v1` contains only `og:title`, `og:description`,
  `og:image` — no `og:type` (required by the Open Graph protocol) and no
  `og:url`; `/en/blog/…` and `/en/profile/…` do emit `og:type`. Consumers that
  require `og:type` fall back to "website" here, and the missing `og:url`
  removes the canonical hint for aggregators.
- **How to reproduce**: `curl -s https://twitch-badges-database.vercel.app/en/badges/rematch-blue-lock-v1 | grep -o '<meta property="og:[^>]*>'`.
- **Suspected cause**: page-level `openGraph` is not merged with the layout's.

## B4 — Every changelog RSS item points at the same `<link>`

- **Severity**: low
- **Confidence**: high (verified live)
- **Where**: `src/app/api/changelog/rss/route.ts:19-21`
- **Code**:
  ```ts
  const url = `${siteUrl()}/en/changelog`;
  return `    <item>
    <title>${escapeXml(entry.title)}</title>
    <link>${url}</link>
    <guid isPermaLink="false">changelog-${entry.id}</guid> …`;
  ```
- **Why it is wrong**: `url` is computed once and emitted for all 100 items, so
  the item `<link>` (the item's own URL per RSS 2.0) is identical for every
  entry — live feed: 100 `<item>` and exactly one distinct `<link>` value
  (`https://…/en/changelog`), repeated 101 times. Feed readers and aggregators
  use `<link>` as the item permalink; with one shared value they collapse or
  de-duplicate the entries and every "read more" opens the same page. The
  changelog page also has no per-entry `id`/anchor, so there is currently no
  deep link to point at.
- **How to reproduce**: `curl -s https://twitch-badges-database.vercel.app/api/changelog/rss | grep -o '<link>[^<]*</link>' | sort | uniq -c`.
- **Suspected cause**: the item URL is built outside the per-entry map even
  though `entry.id` is already used as the `guid`.

## B5 — `Product` JSON-LD has no `offers`/`review`, so it is not a valid Product rich result

- **Severity**: low
- **Confidence**: high (code; absent by construction)
- **Where**: `src/app/[locale]/badges/[slug]/page.tsx:104-111`
- **Code**:
  ```tsx
  const jsonLd = { "@context": "https://schema.org", "@type": "Product",
    name: badge.title,
    description: badge.description ?? badge.how_to_earn ?? badge.title,
    image: badge.image_url_4x ?? badge.image_url_2x ?? undefined,
    category: badge.category };
  ```
- **Why it is wrong**: a `Product` node is only eligible for a rich result when
  it carries `offers`, `review` or `aggregateRating`; none is emitted for any
  badge. Search Console will report the markup as invalid (missing field) for
  every badge page, i.e. the structured data currently earns nothing. The page
  does render the values that would be needed (rarity, owner counts, claim
  window), so the omission is real, not a data limitation. (No
  *contradiction* with the rendered page was found — `category` and the
  description text match what is displayed.)
- **How to reproduce**: `curl -s https://twitch-badges-database.vercel.app/en/badges/rematch-blue-lock-v1 | grep -o '<script type="application/ld+json">[^<]*</script>'`
  and feed it to the Rich Results Test.
- **Suspected cause**: the JSON-LD object was written with `Product` but
  without the offer/review properties Product validation requires.

## B6 — Owner/active labels print "0 owners" while the value shows "—"

- **Severity**: low
- **Confidence**: high (code + message)
- **Where**: `src/app/[locale]/badges/[slug]/page.tsx:224, 232`
- **Code**:
  ```tsx
  <dt …>{t("ownerCount", { count: badge.owner_count ?? 0 })}</dt>
  <dd …>{badge.owner_count !== null ? new Intl.NumberFormat(locale).format(badge.owner_count) : "—"}</dd>
  …
  <dt …>{t("activeCount", { count: badge.active_count ?? 0 })}</dt>
  <dd …>{badge.active_count !== null ? … : "—"}</dd>
  ```
  `messages/en.json`: `badges.ownerCount = "{count, plural, one {# owner} other {# owners}}"`.
- **Why it is wrong**: the value column deliberately renders "—" for an
  unknown count, but the label substitutes `0` for the same unknown, so a badge
  with `owner_count = null` renders the contradiction "0 owners —" (and
  "0 active users —"). Both the label and the value should reflect "unknown".
- **How to reproduce**: by inspection; any badge with a null count.
- **Suspected cause**: `?? 0` used only to satisfy the ICU plural, not to
  display.

## B7 — OG card font coverage is missing several scripts → blank boxes for those display names

- **Severity**: low
- **Confidence**: medium (code-level; tofu not reproduced without rendering)
- **Where**: `src/app/api/og/profile/route.tsx:17-33`
- **Code**:
  ```ts
  const SCRIPT_FAMILIES: Array<[RegExp, string]> = [
    [/[\p{Script=Hiragana}\p{Script=Katakana}]/u, "Noto+Sans+JP"],
    [/\p{Script=Hangul}/u, "Noto+Sans+KR"],
    [/\p{Script=Han}/u, "Noto+Sans+SC"],
    [/\p{Script=Arabic}/u, "Noto+Sans+Arabic"],
    [/\p{Script=Hebrew}/u, "Noto+Sans+Hebrew"],
    [/\p{Script=Thai}/u, "Noto+Sans+Thai"],
    [/\p{Script=Devanagari}/u, "Noto+Sans+Devanagari"],
    [/\p{Script=Cyrillic}/u, "Noto+Sans"],
  ];
  ```
- **Why it is wrong**: the comment states the bundled font has no
  non-Latin glyphs and that a subset is loaded "matching the script of the text
  that will be drawn". The list covers only 9 script groups, so a Twitch
  display name in, for example, Tamil, Bengali, Telugu, Georgian, Armenian,
  Ethiopic, Khmer, Lao, Myanmar, Sinhala or Tibetan matches nothing,
  `familyForText` returns `null`, no extra font is registered, and the name
  renders as tofu on the shared profile card (`/api/og/profile?u=…`) — the exact
  failure the subset loader was added to prevent. The mismatch is silent
  because the loader only runs when a family is selected.
- **How to reproduce**: by inspection of the `\p{Script=…}` list; a card for a
  user named in one of the unlisted scripts would be needed to see the boxes.
- **Suspected cause**: the gate covers the scripts the author thought of rather
  than the set Twitch allows.

## B8 — Pages that set `openGraph` but not `twitter` inherit the layout's site title for the card (affects blog and profile, not the badge page)

- **Severity**: low
- **Confidence**: high (verified live)
- **Where**: `src/app/[locale]/blog/[slug]/page.tsx:34-41`,
  `src/app/[locale]/profile/[username]/page.tsx:53-62`,
  root cause `src/app/[locale]/layout.tsx:44-48`
- **Code**:
  ```tsx
  // blog/[slug] — openGraph set, twitter absent; layout supplies:
  twitter: { card: "summary_large_image", title: t("siteTitle"), description: t("siteDescription") }
  ```
- **Why it is wrong**: like `openGraph`, the parent `twitter` object survives
  when a page does not define one, and Twitter/X prefers `twitter:title` over
  `og:title`. Live: `/en/blog/drop-rematch-blue-lock-v1` emits
  `og:title = "New badge drop: Rematch Blue Lock — Twitch Badges Blog"` but
  `twitter:title = "Twitch Badges Database"` and
  `twitter:description = "Track every global Twitch badge in real time: …"`;
  `/en/profile/shroud` behaves identically (card headline is the site name, not
  the profile). The badge **detail** page is unaffected because it sets
  `twitter` explicitly (`page.tsx:52`) — reported here only because it is the
  same layout contract and was verified live.
- **How to reproduce**: `curl -s https://twitch-badges-database.vercel.app/en/blog/drop-rematch-blue-lock-v1 | grep -o '<meta name="twitter:[^>]*>'`.
- **Suspected cause**: page metadata declares `openGraph` only; the layout's
  `twitter.title` is not page-aware.

## Checked, no defect found

- `src/lib/jsonld.ts` — escapes `< > &` and U+2028/U+2029 before embedding;
  live JSON-LD for a badge parses and contains no `</script>` break.
- `src/lib/markdown.ts` — escapes `& < > "` before inline formatting; the
  link-URL scheme is unchecked but only admin-authored content and slug-only
  auto-post links reach it (already-tracked low item, not re-reported).
- Badge detail canonical/hreflang — live: canonical
  `…/en/badges/rematch-blue-lock-v1`, 11 `hreflang` links plus `x-default`,
  matching the sitemap's codes; `metadataBase` from the locale layout resolves
  the relative canonical correctly.
- Sitemap — 5830 `<loc>`, no duplicate URLs, no malformed locale prefixes,
  `x-default` on every entry, badge/post pagination via `.range()` reaches all
  rows (476 badges, 26 posts), `updated_at` exists on `badges` (migration 0016).
- `robots.ts` — `Allow: /`, disallows `/api/`, `/*/account`, `/*/inventory`,
  `/*/auth/`, correct absolute `Sitemap:` line.
- `/api/changelog/rss` — valid XML (no control characters below 0x20), correct
  `Content-Type`, correct `guid`/`pubDate` formats, 100 items under the cap.
  Missing `<atom:link rel="self">`/`<lastBuildDate>` are recommendations, not
  validity errors.
- `/api/og/profile` — returns `200 image/png` (120 KB), 1200×630; the
  Google-Fonts `css2?text=` subset really does come back as
  `format('truetype')` when fetched without a browser UA, so the truetype
  regex matches and the mechanism works for the scripts it covers.
- Badge detail `generateMetadata` returns `{}` for a missing slug (404 path),
  and `getBadgeBySlug` is intentionally un-caught so a DB error is not turned
  into a 404.
