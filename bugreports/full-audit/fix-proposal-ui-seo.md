# Fix proposal — public UI, SEO and content

Scope: the CONFIRMED findings in my area as adjudicated in `VERIFIED.md` —
**8, 31, 32, 34–39, 40, 41–47, 54**. Ordering below is by severity, most
user-visible first, so you can stop reading at any point and still have applied
the fixes that matter most.

Nothing was modified: this is a proposal. No database statement was executed —
the only reads were `SELECT`-free HTTP fetches against the live deployment and
reads of `node_modules` source.

**None of your verdicts in this area was wrong** — every item below is real and I
reproduced the user-visible ones against production before writing anything. The
one place I depart from a collector is the *remedy* for item 45: the finding
(an invalid `Product` node) is correct, but adding `offers`/`review` as the
report implies would mean inventing data, so I propose a different type instead
(see "Deliberately not proposed" at the end).

## Method, and what I verified live (not just by reading)

Every claim I quote as "live" below came from one of these, run just now against
`https://twitch-badges-database.vercel.app`:

| Evidence | Result |
|---|---|
| `curl /en/notifications \| grep -o 'href="[^"]*badges[^"]*"'` | `href="/en/en/badges/rematch-blue-lock-v1"`; on `/de/notifications` → `href="/de/en/badges/rematch-blue-lock-v1"` |
| `curl /en/badges/harley-mayhem-v1` | head contains `Expires in` for a badge whose `end_date` is null |
| `curl /en/badges/bits-v100` | label `0 owners` / `0 active users`, value `—` / `—` |
| `curl -I /en/faq` (revalidate 3600) | `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate` |
| `curl /en/games/rps \| grep canonical` | `<link rel="canonical" href="…/en"/>` |
| `curl /api/changelog/rss \| grep '<link>' \| uniq -c` | `101 <link>https://…/en/changelog</link>` |
| `curl /en/badges/rematch-blue-lock-v1 \| grep 'og:'` | only `og:title`, `og:description`, `og:image` |
| `curl /en/blog/drop-rematch-blue-lock-v1 \| grep twitter:` | `twitter:title = "Twitch Badges Database"` while `og:title` is the post title |
| `curl /en/badges?q=zzzzzznope&page=2` | "could not be loaded" |
| `curl /en/active \| grep selected` | Sort control renders `<option value="newest" selected>` |
| `curl /en/badges?sort=bogus` | Sort control has **no** `selected` option |
| `curl /en \| grep 'href="/en/changelog"'` | `<a …><span class="dir-arrow" aria-hidden="true">→</span></a>` |
| `node_modules/next-intl/…/navigation/shared/utils.js` | `applyPathnamePrefix` prefixes the active locale whenever `isLocalizableHref(href)`; `localePrefix.mode === "always"` → unconditional `prefixPathname` |
| `node_modules/next/dist/lib/metadata/resolvers/resolve-opengraph.js:102` | `openGraph.url` is resolved against `metadataBase` |
| `node_modules/next/dist/lib/metadata/resolve-metadata.js:182-184, 620-636` | a page-level `openGraph` **replaces** the parent object; the parent's `twitter.title` survives and suppresses the auto-fill |

Two global constraints that apply to every patch below:

1. **All eleven `messages/*.json` are key-identical today** (1022 keys each,
   verified mechanically). Any key added must be added to all eleven in the same
   commit; a missing key is a silent `MISSING_MESSAGE` per locale, and the build
   still succeeds. Where I introduce a key I give all eleven values.
2. AGENTS.md: every one of these fixes needs its own `npm run log:change` row
   (one paragraph naming what changed and why) and the ritual
   `npm run lint && npm run typecheck && npm run build` before you finish.

---

## 1 — Item 8: every notification link 404s (highest severity: one click, wrong every time)

**Confirmed live** on both the producer and the consumer, exactly as reported:
the stored URL is `/en/badges/rematch-blue-lock-v1`, and the page renders it as
`/en/en/badges/rematch-blue-lock-v1` (`/de/en/…` on the German page).

### 1a. Producer — `src/lib/syncs/global.ts` (lines 390-403, current)

```ts
    // Desktop notification: "new badge is live" — skipped on initial seed.
    if (!isInitialSeed) {
      const first = freshRows[0];
      const url = `/en/badges/${first?.slug ?? ""}`;
      await recordNotification({
        kind: "badge_added",
        title:
          addedTitles.length === 1
            ? `New Twitch badge: ${addedTitles[0]}`
            : `${addedTitles.length} new Twitch badges just went live`,
        body: addedTitles.slice(0, 5).join(", "),
        url,
        tag: "new-badges",
      }).catch((err) => console.warn("[notify] failed:", err));
```

### 1a. Replacement

```ts
    // Desktop notification: "new badge is live" — skipped on initial seed.
    if (!isInitialSeed) {
      // Locale-less on purpose. Two different consumers read this one string:
      // the /notifications page renders it through next-intl's `Link`, which
      // prepends the ACTIVE locale (a stored `/en/…` came out as `/en/en/…`,
      // i.e. every notification link 404'd), and the service worker navigates
      // to it root-relative, where the i18n middleware picks the visitor's
      // locale. `/badges` is also the fallback when the lookup returned no row:
      // `/en/badges/` was itself a 404.
      const first = freshRows[0];
      const url = first ? `/badges/${first.slug}` : "/badges";
      await recordNotification({
        kind: "badge_added",
        title:
          addedTitles.length === 1
            ? `New Twitch badge: ${addedTitles[0]}`
            : `${addedTitles.length} new Twitch badges just went live`,
        body: addedTitles.slice(0, 5).join(", "),
        url,
        tag: "new-badges",
      }).catch((err) => console.warn("[notify] failed:", err));
```

`url` is shared with the `sendPushToAll` call immediately below, so the push
payload becomes `/badges/<slug>` too: `sw.js` does `client.navigate("/badges/x")`
against the current origin and the middleware redirects to `/<locale>/badges/x`.
If `freshRows` is empty while `addedTitles` is not (possible: the block at line
391 sits under `if (addedTitles.length > 0)`, not under `freshRows.length > 0`),
the old code produced `/en/badges/` — a second 404 — and now produces `/badges`.

### 1b. Consumer — `src/app/[locale]/notifications/page.tsx` (lines 1-6, 56-67, current)

```tsx
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { listNotifications } from "@/lib/queries";
```

```tsx
                  <p className="text-sm font-semibold leading-snug">
                    {entry.url ? (
                      <Link href={entry.url} className="hover:text-accent">
                        {entry.title}
                      </Link>
                    ) : (
                      entry.title
                    )}
                  </p>
```

### 1b. Replacement — add a normaliser

Imports (add `routing`):

```tsx
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { listNotifications } from "@/lib/queries";
```

New module-scope helper, placed directly under the imports and above
`export const revalidate` (that line goes away in item 40):

```tsx
// `Link` here is next-intl's, which prepends the active locale to any local
// href (`localePrefix: "always"`) — so a notification stored as `/en/badges/x`
// rendered as `/en/en/badges/x` and every title in the feed 404'd. The sync now
// stores locale-less paths; this strips the prefix that the rows written before
// that fix still carry, and leaves absolute URLs alone.
const LOCALE_PREFIX = new RegExp(`^/(?:${routing.locales.join("|")})(?=/|$)`);

function notificationHref(url: string): string {
  if (!url.startsWith("/")) return url; // absolute or protocol-relative
  return url.replace(LOCALE_PREFIX, "") || "/";
}
```

JSX:

```tsx
                  <p className="text-sm font-semibold leading-snug">
                    {entry.url ? (
                      <Link
                        href={notificationHref(entry.url)}
                        className="hover:text-accent"
                      >
                        {entry.title}
                      </Link>
                    ) : (
                      entry.title
                    )}
                  </p>
```

**Why this is correct.** The double prefix is next-intl's documented behaviour
for a localizable href under `localePrefix: "always"` (verified in the compiled
`applyPathnamePrefix`/`isLocalizableHref`), so the consumer cannot be handed a
locale-prefixed path. Normalising on the consumer side is what makes the fix
retroactive: rows already in the table keep `/en/badges/…` and still resolve.
The regex only matches a whole first segment (`(?=/|$)`) and only for a leading
`/`, so `/badges/x` is untouched, `https://…` passes through, and `/en` alone
becomes `/`.

**Must not break.** (a) The push path: the SW never used the i18n `Link`; a
locale-less URL leaves it with one extra middleware redirect, landing on the
visitor's own locale instead of always English — strictly better. (b) The
newsletter stores `url: "/"` (`src/lib/admin-newsletter.ts:166`); `"/"` has no
locale prefix, the replace is a no-op and `|| "/"` keeps it. (c) No new i18n key.
(d) Do **not** "fix" this by swapping in `next/link`: that would pin every
notification to the stored language and leave the legacy rows broken.

**Risk if wrong.** Worst case a link resolves to the wrong locale or the badge
index instead of a badge page — still a working 200, not a 404. The only way to
make it worse than today is to strip a segment that is not a locale; the regex
is anchored and driven by `routing.locales`.

**Verification.**
- After the sync change, force a notification insert (or just re-run
  `npm run sync:global` on a day with a new badge) and check
  `curl -s $SITE/en/notifications | grep -o 'href="/[a-z-]*/[a-z-]*/badges[^"]*"'`
  → **no match** (nothing has two leading segments).
- `curl -s $SITE/de/notifications | grep -o 'href="/de/badges/[^"]*"'` → the
  legacy row now appears as `/de/badges/rematch-blue-lock-v1` and returns 200.
- Optional DB tidy-up, **not required** because the consumer normalises:
  `update notifications set url = regexp_replace(url, '^/(en|pt|es|fr|de|ru|zh|ar|ja|it|ko)(?=/|$)', '') where url ~ '^/(en|pt|es|fr|de|ru|zh|ar|ja|it|ko)(/|$)';`

---

## 2 — Item 32: reaction buttons cannot represent server state, and the route swallows its dedup error

Two halves, one screen. Both must be fixed together, otherwise the client keeps
inverting the truth.

### 2a. `src/app/api/blog/react/route.ts` (lines 31-50, current)

```ts
  const { data: existing } = await supabase
    .from("blog_reactions")
    .select("id")
    .eq("post_id", post.id)
    .eq("ip_hash", ipHash)
    .eq("emoji", body.emoji)
    .maybeSingle();

  if (existing) {
    await supabase.from("blog_reactions").delete().eq("id", existing.id);
    return Response.json({ ok: true, removed: true });
  }
  const { error } = await supabase.from("blog_reactions").insert({
    post_id: post.id,
    user_id: userId,
    ip_hash: ipHash,
    emoji: body.emoji,
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, added: true });
```

### 2a. Replacement

```ts
  const { data: existing, error: lookupError } = await supabase
    .from("blog_reactions")
    .select("id")
    .eq("post_id", post.id)
    .eq("ip_hash", ipHash)
    .eq("emoji", body.emoji)
    .maybeSingle();

  // Destructuring only `data` meant a failed lookup fell through to the INSERT,
  // where the (post_id, ip_hash, emoji) unique constraint turned the race into a
  // 500 carrying the raw Postgres message.
  if (lookupError) {
    return Response.json({ error: "lookup failed" }, { status: 500 });
  }

  if (existing) {
    await supabase.from("blog_reactions").delete().eq("id", existing.id);
    return Response.json({ ok: true, removed: true });
  }
  const { error } = await supabase.from("blog_reactions").insert({
    post_id: post.id,
    user_id: userId,
    ip_hash: ipHash,
    emoji: body.emoji,
  });
  if (error) {
    // Lost a race with a concurrent identical reaction. The row is there, which
    // is what the caller asked for — report it as added rather than 500 on it.
    if (error.code !== "23505") {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }
  return Response.json({ ok: true, added: true });
```

### 2b. `src/components/EmojiReactions.tsx` (lines 15-58, current)

```tsx
export default function EmojiReactions({
  slug,
  initial,
}: {
  slug: string;
  initial: Record<string, number>;
}) {
  const t = useTranslations("blog");
  const [counts, setCounts] = useState<Record<string, number>>(initial);
  const [active, setActive] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  async function react(emoji: string) {
    if (busy) return;
    setBusy(true);
    const wasActive = active.has(emoji);
    try {
      const res = await fetch("/api/blog/react", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, emoji }),
      });
      // A failed request returns an error body, which used to be treated as a
      // removal: the count dropped by one and the button flipped state even
      // though nothing changed server-side.
      if (!res.ok) return;
      const data = (await res.json()) as { added?: boolean; removed?: boolean };
      if (!data.added && !data.removed) return;
      setCounts((prev) => ({
        ...prev,
        [emoji]: Math.max(0, (prev[emoji] ?? 0) + (data.added ? 1 : -1)),
      }));
      setActive((prev) => {
        const next = new Set(prev);
        if (wasActive) next.delete(emoji);
        else next.add(emoji);
        return next;
      });
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  }
```

### 2b. Replacement

```tsx
export default function EmojiReactions({
  slug,
  initial,
  initialActive,
}: {
  slug: string;
  initial: Record<string, number>;
  /** The emojis this visitor already reacted with, resolved server-side. */
  initialActive: string[];
}) {
  const t = useTranslations("blog");
  const [counts, setCounts] = useState<Record<string, number>>(initial);
  // Seeded from the server. Starting empty made the control lie about a
  // reaction that already existed: the visitor's first click hit the route's
  // *delete* branch, the count went down, and the button lit up because it
  // believed it had just added one.
  const [active, setActive] = useState<Set<string>>(
    () => new Set(initialActive),
  );
  const [busy, setBusy] = useState(false);

  async function react(emoji: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/blog/react", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, emoji }),
      });
      // A failed request returns an error body, which used to be treated as a
      // removal: the count dropped by one and the button flipped state even
      // though nothing changed server-side.
      if (!res.ok) return;
      const data = (await res.json()) as { added?: boolean; removed?: boolean };
      if (!data.added && !data.removed) return;
      setCounts((prev) => ({
        ...prev,
        [emoji]: Math.max(0, (prev[emoji] ?? 0) + (data.added ? 1 : -1)),
      }));
      // Follow the server's answer instead of guessing from local state: the
      // toggle is decided by the stored row, which the client cannot know.
      setActive((prev) => {
        const next = new Set(prev);
        if (data.removed) next.delete(emoji);
        else next.add(emoji);
        return next;
      });
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  }
```

### 2c. `src/app/[locale]/blog/[slug]/page.tsx` — supply the server state

First add the missing import (the file currently imports `createClient` only):

```tsx
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
```

Current (lines 54-77):

```tsx
  // View counter (5-minute per-IP dedup) + emoji reactions.
  let viewCount = 0;
  const reactions: Record<string, number> = {};
  try {
    const ipHash = await visitorIpHash();
    await recordBlogView(post.id, ipHash);
    // Reads go through the anon server client: migration 0011 gave both tables
    // a public-read policy with column-level grants, so no RLS bypass is needed
    // here (and `ip_hash` stays unreachable). recordBlogView above is a write
    // and keeps its own service-role path.
    const supabase = await createClient();
    const [viewsRes, reactionsRes] = await Promise.all([
      supabase.from("blog_views").select("post_id", { count: "exact", head: true }).eq("post_id", post.id),
      // Without the post filter this counted every reaction on the whole blog,
      // so all posts displayed identical totals.
      supabase.from("blog_reactions").select("emoji").eq("post_id", post.id),
    ]);
    viewCount = viewsRes.count ?? 0;
    for (const row of (reactionsRes.data ?? []) as Array<{ emoji: string }>) {
      reactions[row.emoji] = (reactions[row.emoji] ?? 0) + 1;
    }
  } catch {
    // counters are best-effort
  }
```

Replacement:

```tsx
  // View counter (5-minute per-IP dedup) + emoji reactions.
  let viewCount = 0;
  const reactions: Record<string, number> = {};
  // Which of these reactions are the visitor's own. `ip_hash` is deliberately
  // not readable with the anon key (migration 0011 grants only post_id, emoji,
  // created_at), so this one lookup uses the service-role client — server
  // component, emoji keys only, never a hash. The page is dynamic regardless:
  // visitorIpHash() below reads request headers.
  let myReactions: string[] = [];
  try {
    const ipHash = await visitorIpHash();
    await recordBlogView(post.id, ipHash);
    // Reads go through the anon server client: migration 0011 gave both tables
    // a public-read policy with column-level grants, so no RLS bypass is needed
    // here (and `ip_hash` stays unreachable). recordBlogView above is a write
    // and keeps its own service-role path.
    const supabase = await createClient();
    const [viewsRes, reactionsRes] = await Promise.all([
      supabase.from("blog_views").select("post_id", { count: "exact", head: true }).eq("post_id", post.id),
      // Without the post filter this counted every reaction on the whole blog,
      // so all posts displayed identical totals.
      supabase.from("blog_reactions").select("emoji").eq("post_id", post.id),
    ]);
    viewCount = viewsRes.count ?? 0;
    for (const row of (reactionsRes.data ?? []) as Array<{ emoji: string }>) {
      reactions[row.emoji] = (reactions[row.emoji] ?? 0) + 1;
    }
    const { data: mine } = await createAdminClient()
      .from("blog_reactions")
      .select("emoji")
      .eq("post_id", post.id)
      .eq("ip_hash", ipHash);
    myReactions = [
      ...new Set((mine ?? []).map((row) => (row as { emoji: string }).emoji)),
    ];
  } catch {
    // counters are best-effort
  }
```

and the component call (line 151):

```tsx
        <EmojiReactions
          slug={post.slug}
          initial={reactions}
          initialActive={myReactions}
        />
```

`createAdminClient` is already imported in `src/app/[locale]/profile/[username]/page.tsx:31`,
so a server page using it is precedented; if you would rather keep the rule
literal, the alternative is a `GET` on the react route returning `{ mine }` and a
fetch-on-mount in `EmojiReactions` — I do not recommend it, because the button is
then wrong for the first ~200 ms of every visit, which is the bug.

**Why this is correct.** The toggle is decided by a row keyed
`(post_id, ip_hash, emoji)`. Only the server can evaluate that key; the client
must be told the answer, and after a toggle it must take its new state from the
response (`added`/`removed` are mutually exclusive) rather than from a local
guess. The route now also distinguishes "the row exists" from "the lookup
failed", and treats a duplicate insert as success.

**Must not break.** The unique constraint `(post_id, ip_hash, emoji)`
(`0003_gamification.sql:127`) is unchanged; the anon column grants from 0011 are
unchanged, so `ip_hash` stays unreachable from the browser. No new i18n key: the
aria-label uses the existing `blog.react`. Personal reactions are never cached
because the page is dynamic; if anyone later makes this route static, the admin
read would poison the cache — leave a comment if you ever add `unstable_cache`
here.

**Risk if wrong.** The worst case is a wrong highlight for a visitor whose IP
changed since their reaction (a new `ip_hash`, so the server genuinely no longer
matches their row — the client then correctly shows "not reacted" and clicking
inserts a new row). No data loss: the route only deletes the row it matched.

**Verification.**
- React to a post, reload: the button is **highlighted** on load (server state).
- Click it: count decreases by one and it un-highlights (previously: count
  decreased and it lit up).
- `POST /api/blog/react` twice in the same second from two shells for the same
  IP+emoji and confirm no 500 with `duplicate key value`.
- Assert the page's initial state matches the DB:
  `select emoji from blog_reactions where post_id = $1 and ip_hash = $2` — that
  set is exactly the set of highlighted chips on load.

---

## 3 — Item 41: an active badge with no end date renders "Expires in / Expired" beside a "Live" chip

Live on `harley-mayhem-v1` (active, `start_date 2026-09-01`, `end_date null`):
the head contains `Expires in`. Label and value contradict the status chip, and
the listing card does not have the bug (`BadgeCard.tsx:87` requires `end_date`).

### `src/app/[locale]/badges/[slug]/page.tsx`

Insert after `relatedBadges` (line 102) and before the `jsonLd` object:

```tsx
  // The strip can only count down to a date that exists. Falling back to
  // `end_date ?? start_date` made an active badge with no end date count down to
  // its own (past) start date, so the strip read "Expires in / Expired" next to
  // a "Live" status chip — the contradiction the listing card avoids by
  // requiring an end date. A live badge with no announced end says so instead.
  const startsIn = badge.status === "upcoming" && Boolean(badge.start_date);
  const countdownTarget = startsIn ? badge.start_date : badge.end_date;
  const noExpiry =
    badge.status === "active" && !badge.end_date && Boolean(badge.start_date);
```

Replace the strip (lines 172-191, current):

```tsx
        {/* Countdown strip */}
        {(badge.status === "active" || badge.status === "upcoming") &&
          (badge.end_date || badge.start_date) && (
            <div className="flex flex-col items-center gap-2 border-t border-line bg-surface-2 px-6 py-4 sm:flex-row sm:justify-between">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                {badge.status === "upcoming" && badge.start_date
                  ? tcd("startsIn")
                  : tcd("expiresIn")}
              </span>
              <Countdown
                size="lg"
                target={
                  badge.status === "upcoming" && badge.start_date
                    ? badge.start_date
                    : (badge.end_date ?? badge.start_date!)
                }
                mode={badge.status === "upcoming" && badge.start_date ? "starts" : "expires"}
              />
            </div>
          )}
```

with:

```tsx
        {/* Countdown strip — and only for a date that exists */}
        {(countdownTarget || noExpiry) && (
          <div className="flex flex-col items-center gap-2 border-t border-line bg-surface-2 px-6 py-4 sm:flex-row sm:justify-between">
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
              {noExpiry
                ? tcd("permanent")
                : startsIn
                  ? tcd("startsIn")
                  : tcd("expiresIn")}
            </span>
            {countdownTarget ? (
              <Countdown
                size="lg"
                target={countdownTarget}
                mode={startsIn ? "starts" : "expires"}
              />
            ) : (
              <span className="chip chip-live pointer-events-none">
                <span className="live-dot" aria-hidden />
                {tcd("live")}
              </span>
            )}
          </div>
        )}
```

**Why this is correct.** `countdownTarget` is null exactly when there is no date
to count to, and the `Countdown` render is then replaced by a statement of fact.
Both keys already exist and are currently unused — `countdown.permanent`
("No expiry": pt `Sem expiração`, de `Ohne Ablauf`, ja `期限なし`, …) and
`countdown.live` ("Live now": de `Jetzt live`, …) — present and identical in all
eleven files, so **no message edit is needed**. Behaviour for every other case is
unchanged: upcoming-with-start keeps the "starts" countdown, active-with-end
keeps "expires", an upcoming badge with only an end date keeps today's
`expiresIn`/`expires` pair, and an expired badge still renders no strip. The
non-null assertion `badge.start_date!` also disappears.

**Must not break.** `Countdown`'s contract (`target: string`) — the ternary
narrows `countdownTarget` to `string`. Do not reuse `chip-live` classes for the
label; they are the status-chip classes.

**Risk if wrong.** If you decide instead to render *nothing* for this case, that
is also honest (less informative); what must not survive is a countdown aiming at
a past date in `"expires"` mode, which always prints "Expired".

**Verification.**
- `curl -s $SITE/en/badges/harley-mayhem-v1 | grep -c 'Expires in'` → `0`, and
  `grep -o 'No expiry\|Live now'` → both present.
- `curl -s $SITE/en/badges/rematch-blue-lock-v1 | grep -o 'Expires in'` → still
  present (a badge that really has an end date).
- `/en/upcoming` first card → `curl` its detail page, still `Starts in`.

---

## 4 — Item 42: 143 game URLs canonicalise to the locale home page

Live: `/en/games/rps` emits `canonical = …/en` while `/sitemap.xml` lists
`/en/games/rps` with hreflang alternates. Google folds the pages into the
homepage as duplicates.

### `src/app/[locale]/games/[game]/page.tsx` (lines 29-38, current)

```tsx
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, game } = await params;
  if (!GAMES.some((g) => g.id === game)) return {
    alternates: {
      canonical: `/${locale}/games/${game}`,
      languages: localeAlternates(`/games/${game}`),
    },};
  const t = await getTranslations({ locale, namespace: "games" });
  return { title: t(`${game}Title`), description: t(`${game}Desc`) };
}
```

### Replacement

```tsx
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, game } = await params;
  if (!GAMES.some((g) => g.id === game)) return {
    alternates: {
      canonical: `/${locale}/games/${game}`,
      languages: localeAlternates(`/games/${game}`),
    },};
  const t = await getTranslations({ locale, namespace: "games" });
  return {
    title: t(`${game}Title`),
    description: t(`${game}Desc`),
    // The valid-game branch had no `alternates`, so the route inherited the
    // locale layout's `canonical: /${locale}`: all 13 games × 11 locales
    // canonicalised to the locale homepage while the sitemap advertised each
    // game URL with hreflang. Self-referential canonical + the same locale map
    // the sitemap emits makes the two signals agree.
    alternates: {
      canonical: `/${locale}/games/${game}`,
      languages: localeAlternates(`/games/${game}`),
    },
  };
}
```

**Why this is correct.** `localeAlternates` is the exact helper the sitemap uses
for these paths, so canonical, hreflang and sitemap become one consistent set;
this is the same fix already applied to the unknown-game branch. The pages are
`dynamic = "force-dynamic"` and require login to *play*, but they render a public
title/description (200, no redirect), which is what the sitemap has been
asserting since the games were added there — this restores that intent.

**Must not break.** Canonical correctness: each locale page canonicalises to
*itself* and `languages` is unchanged in shape, so no page canonicalises to a
different locale. Do **not** "fix" this by removing the games from the sitemap
unless you actually want them out of the index — that is the other defensible
answer (login-gated pages), and it is a deliberate product decision, not a bug
fix.

**Risk if wrong.** A wrong `locale` in the canonical would deindex a locale's
game page; the value comes from `params`, same as every other page.

**Verification.**
- `curl -s $SITE/en/games/rps | grep -o '<link rel="canonical"[^>]*>'` →
  `…/en/games/rps`; repeat for `/de/games/rps`.
- `curl -s $SITE/sitemap.xml | grep -A2 'games/rps'` → same URLs in the
  `alternates`.
- Search Console → URL Inspection on `/en/games/rps` → "Page is not indexed:
  Duplicate, Google chose different canonical" should clear after recrawl.

---

## 5 — Items 35 and 36: an empty filter past page 1 shows the load-error card, and the retry can loop

Item 35 is live: `/en/badges?q=zzzzzznope&page=2` renders "The catalog could not
be loaded right now." while the same filter on page 1 correctly renders "No
badges match these filters.". Item 36 (the unbounded retry) is the same code
path, so both are one patch; the `id` tiebreak belongs in the same function.

### `src/lib/queries.ts` — replace `listBadges` (lines 150-254, current)

```ts
export async function listBadges(
  filters: ListFilters,
): Promise<ListResult<BadgeRow>> {
  const supabase = await createClient();
  const perPage = Math.min(Math.max(filters.perPage ?? 48, 12), 96);
  const page = Math.max(filters.page ?? 1, 1);

  let query = supabase
    .from("badges")
    .select("*", { count: "exact", head: false });

  const q = filters.q ? sanitizeQuery(filters.q) : "";
  if (q) {
    query = query.or(
      `title.ilike.%${q}%,set_id.ilike.%${q}%,slug.ilike.%${q}%`,
    );
  }
  if (filters.status && filters.status !== "all") {
    query = query.eq("status", filters.status);
  }
  if (filters.price === "free") query = query.eq("is_paid", false);
  if (filters.price === "paid") query = query.eq("is_paid", true);
  if (filters.category && filters.category !== "all") {
    query = query.eq("category", filters.category);
  }
  if (filters.rarity && filters.rarity !== "all") {
    query = query.eq("rarity_tier", filters.rarity);
  }

  const sort: SortKey = (filters.sort as SortKey) ?? "newest";
  switch (sort) {
    case "oldest":
      query = query.order("first_seen_at", { ascending: true });
      break;
    case "rarity":
      query = query.order("rarity_score", { ascending: false });
      break;
    case "owners":
      query = query.order("owner_count", {
        ascending: false,
        nullsFirst: false,
      });
      break;
    case "ending":
      // A sort must never decide WHICH rows appear. The previous
      // `.not("end_date", "is", null)` silently dropped every badge without an
      // end date — on /active, whose default sort is "ending", that hid live
      // badges from the page entirely. Rows without a date now simply sort last.
      query = query.order("end_date", { ascending: true, nullsFirst: false });
      break;
    case "releasing":
      query = query.order("start_date", { ascending: true, nullsFirst: false });
      break;
    case "name":
      query = query.order("title", { ascending: true });
      break;
    default:
      query = query.order("first_seen_at", { ascending: false });
  }

  query = query.range((page - 1) * perPage, page * perPage - 1);

  const { data, error, count } = await query;

  if (error) {
    // PostgREST rejects a window that starts past the end of the result set
    // (416 / PGRST103) rather than returning an empty page. That is what made a
    // stale `?page=` a hard failure — previously swallowed into the "catalog is
    // empty" hint. Treat it as "past the end" and serve the last real page.
    if (page > 1) {
      const first = await listBadges({ ...filters, page: 1 });
      if (first.total > 0) {
        return listBadges({ ...filters, page: Math.min(page, first.pages) });
      }
    }
    throw error;
  }

  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / perPage));

  // A stale or hand-edited `?page=` beyond the range used to render an empty
  // page with no pagination at all — a dead end with no way back. Clamp to the
  // last page instead (the recursive call cannot loop: pages <= page then).
  if (page > pages && total > 0) {
    // The window is beyond the filtered set: serve the last real page instead
    // of a dead end (the recursion terminates because pages <= page there).
    return listBadges({ ...filters, page: pages });
  }
  if (page > 1 && (data ?? []).length === 0) {
    // PostgREST can report a zero count for a window beyond the data, so an
    // empty page needs one cheap first-page query to tell "past the end" from
    // "these filters match nothing".
    const first = await listBadges({ ...filters, page: 1 });
    if (first.total > 0) return listBadges({ ...filters, page: first.pages });
  }

  return {
    items: (data ?? []) as BadgeRow[],
    total,
    page,
    perPage,
    pages: Math.max(1, Math.ceil(total / perPage)),
  };
}
```

### Replacement

```ts
export async function listBadges(
  filters: ListFilters,
): Promise<ListResult<BadgeRow>> {
  const supabase = await createClient();
  const perPage = Math.min(Math.max(filters.perPage ?? 48, 12), 96);
  const page = Math.max(filters.page ?? 1, 1);

  let query = supabase
    .from("badges")
    .select("*", { count: "exact", head: false });

  const q = filters.q ? sanitizeQuery(filters.q) : "";
  if (q) {
    query = query.or(
      `title.ilike.%${q}%,set_id.ilike.%${q}%,slug.ilike.%${q}%`,
    );
  }
  if (filters.status && filters.status !== "all") {
    query = query.eq("status", filters.status);
  }
  if (filters.price === "free") query = query.eq("is_paid", false);
  if (filters.price === "paid") query = query.eq("is_paid", true);
  if (filters.category && filters.category !== "all") {
    query = query.eq("category", filters.category);
  }
  if (filters.rarity && filters.rarity !== "all") {
    query = query.eq("rarity_tier", filters.rarity);
  }

  // No sort key here is unique — 471 of 476 rows share one `first_seen_at`,
  // 437 share one `end_date`, 163 share one `rarity_score` — so Postgres is
  // free to order equal keys differently between two requests, and an offset
  // window then repeats rows already served and drops others. Every sort gets
  // an `id` tiebreak, the same guard `getCatalogKeys` already carries.
  const sort: SortKey = (filters.sort as SortKey) ?? "newest";
  switch (sort) {
    case "oldest":
      query = query.order("first_seen_at", { ascending: true }).order("id");
      break;
    case "rarity":
      query = query.order("rarity_score", { ascending: false }).order("id");
      break;
    case "owners":
      query = query
        .order("owner_count", { ascending: false, nullsFirst: false })
        .order("id");
      break;
    case "ending":
      // A sort must never decide WHICH rows appear. The previous
      // `.not("end_date", "is", null)` silently dropped every badge without an
      // end date — on /active, whose default sort is "ending", that hid live
      // badges from the page entirely. Rows without a date now simply sort last.
      query = query
        .order("end_date", { ascending: true, nullsFirst: false })
        .order("id");
      break;
    case "releasing":
      query = query
        .order("start_date", { ascending: true, nullsFirst: false })
        .order("id");
      break;
    case "name":
      query = query.order("title", { ascending: true }).order("id");
      break;
    default:
      query = query.order("first_seen_at", { ascending: false }).order("id");
  }

  query = query.range((page - 1) * perPage, page * perPage - 1);

  const { data, error, count } = await query;

  if (error) {
    // PostgREST rejects a window that starts past the end of the result set
    // (416 / PGRST103) rather than returning an empty page. Decide from the
    // real total instead of assuming every error is that one:
    //   * a filtered set with no rows at all is an empty page, not a failure —
    //     it used to re-throw, so `/badges?q=zzzzzznope&page=2` rendered the
    //     load-error card for a URL that was merely empty;
    //   * a stale `?page=` is served the last real page instead of a dead end;
    //   * anything else (a pooler hiccup, a statement timeout at that offset)
    //     is re-thrown as-is, because the old `Math.min(page, first.pages)`
    //     re-issued the *identical* failing request whenever `page` was already
    //     in range — an unbounded loop, not a retry.
    if (page > 1) {
      const first = await listBadges({ ...filters, page: 1 });
      if (first.total === 0) {
        return { items: [], total: 0, page: 1, perPage, pages: 1 };
      }
      if (page > first.pages) {
        return listBadges({ ...filters, page: first.pages });
      }
    }
    throw error;
  }

  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / perPage));

  // A stale or hand-edited `?page=` beyond the range used to render an empty
  // page with no pagination at all — a dead end with no way back. Clamp to the
  // last page instead (the recursive call cannot loop: pages <= page then).
  if (page > pages && total > 0) {
    // The window is beyond the filtered set: serve the last real page instead
    // of a dead end (the recursion terminates because pages <= page there).
    return listBadges({ ...filters, page: pages });
  }
  if (page > 1 && (data ?? []).length === 0) {
    // PostgREST can report a zero count for a window beyond the data, so an
    // empty page needs one cheap first-page query to tell "past the end" from
    // "these filters match nothing". `first.pages !== page` keeps that retry
    // from re-issuing the identical request when the window really is empty.
    const first = await listBadges({ ...filters, page: 1 });
    if (first.total > 0 && first.pages !== page) {
      return listBadges({ ...filters, page: first.pages });
    }
  }

  return {
    items: (data ?? []) as BadgeRow[],
    total,
    page,
    perPage,
    pages: Math.max(1, Math.ceil(total / perPage)),
  };
}
```

**Why this is correct.** Three separate guarantees now hold, all by reading the
*total*:

1. `page > 1` + error + `total === 0` → a legitimate empty result (the UI shows
   `badges.empty`, exactly as page 1 does).
2. `page > 1` + error + `page > first.pages` → the last real page, as before.
3. `page > 1` + error + `page <= first.pages` → the error propagates. Recursion
   is finite in every branch: the fallback calls are always `page: 1` or
   `page: first.pages < page`, and page 1 never recurses.
4. Every sort is total-ordered, so the tie groups can no longer reshuffle
   between requests.

**Must not break.** `perPage` clamping, the `price`/`status`/`category`/`rarity`
filter semantics and the returned shape are untouched. `SortKey` stays the
parameter type; the `id` tiebreak never changes *which* rows appear, only the
order inside a tie. `getCatalogKeys`, `getHomeData` and the stats queries are
unaffected (different functions).

**Risk if wrong.** The dangerous half is the early `return { items: [], … }`: if
`first.total` were 0 for a *failing* page-1 request it would render an empty
catalog instead of an error card — but a failed page-1 request throws out of
`listBadges({...filters, page: 1})` before that line, so it cannot be reached
with a failed count. The tiebreak cannot regress the visible order because the
primary keys are unchanged.

**Verification.**
- `curl -s "$SITE/en/badges?q=zzzzzznope&page=2" | grep -o 'No badges match'` →
  present; `grep -o 'could not be loaded'` → absent.
- `curl -s "$SITE/en/badges?status=bogus&page=3"` → same.
- Control: `curl -s "$SITE/en/upcoming?page=9"` still serves the last real page.
- Window stability: for `p` in 1..10 fetch `/en/badges?page=$p&sort=ending`, take
  the set of badge slugs per page and assert the 10 sets are pairwise disjoint
  and their union equals the total (471 rows share one `first_seen_at`, so
  before the tiebreak this is where duplicates would appear).

---

## 6 — Item 31: `createFeaturePost` writes a changelog row on every call

Live evidence in the report: 139 `changelog` rows of kind `blog` for 24 distinct
titles. The post write is idempotent (`ignoreDuplicates`), the changelog write
is not — and the changelog page and its RSS feed are generated straight from
that table.

### `src/lib/blog.ts` (lines 74-100, current)

```ts
/**
 * Auto-publish a blog post for a shipped feature, game or special event
 * (turbo jackpot, …). Idempotent by slug.
 */
export async function createFeaturePost(post: FeaturePostInput): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from("blog_posts").upsert(
    {
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      content: post.content,
      cover_url: post.cover ?? null,
      status: "published",
      is_auto: true,
      tags: ["feature", ...(post.tags ?? [])],
    },
    { onConflict: "slug", ignoreDuplicates: true },
  );
  if (error) throw error;
  await supabase.from("changelog").insert({
    kind: "blog",
    title: `Blog post published: ${post.title}`,
    body: post.excerpt,
    payload: { slug: post.slug },
  }).then(() => undefined, () => undefined);
}
```

### Replacement

```ts
/**
 * Auto-publish a blog post for a shipped feature, game or special event
 * (turbo jackpot, …). Idempotent by slug — including its changelog row, which
 * is only written by the call that actually creates the post.
 */
export async function createFeaturePost(post: FeaturePostInput): Promise<void> {
  const supabase = createAdminClient();
  // Plain insert, not upsert: `blog_posts.slug` is unique, so 23505 is the
  // database's own "this post already exists" answer and it arrives atomically.
  // `ignoreDuplicates` skipped the duplicate post but still ran the changelog
  // insert below on every call, and the seed scripts call this in a loop — the
  // changelog claimed the same publication six times over (139 `blog` rows for
  // 24 distinct titles) and the changelog page and its RSS feed are generated
  // from that table.
  const { error } = await supabase.from("blog_posts").insert({
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    content: post.content,
    cover_url: post.cover ?? null,
    status: "published",
    is_auto: true,
    tags: ["feature", ...(post.tags ?? [])],
  });
  if (error) {
    if (error.code === "23505") return; // already published, and already logged
    throw error;
  }
  await supabase.from("changelog").insert({
    kind: "blog",
    title: `Blog post published: ${post.title}`,
    body: post.excerpt,
    payload: { slug: post.slug },
  }).then(() => undefined, () => undefined);
}
```

**Why this is correct.** `ignoreDuplicates: true` means "skip on conflict", not
"update on conflict", so the insert is behaviourally identical for the post and
gives a *signal* the upsert hid. The unique constraint on `blog_posts.slug`
exists (`0001_init.sql:227`), which is what `onConflict: "slug"` relied on. The
changelog row is now written exactly once per slug, by the winner of the insert.

**Must not break.** Callers (`scripts/seed-gamification-blog.ts:188`,
`scripts/seed-xp-research.ts:65`, `wheel.ts:90`) expect a no-op on a repeat — they
still get one, silently. The `logChange`-style swallow (`.then(ok, noop)`) is
preserved. Do not switch to `upsert(..., { onConflict: "slug" })` (no
`ignoreDuplicates`): that *updates* the row and still returns no error, so the
changelog row would be skipped for a genuine re-publication. No i18n impact (the
title is admin/data text, not a UI string).

**Risk if wrong.** If `23505` were somehow raised for a different constraint
(e.g. a future unique column), a real insert would be silently skipped — the
guard is on the error code only, so scope it to this post's insert if more unique
columns are ever added.

**Verification.**
- After the fix, in a scratch script: call `createFeaturePost` twice with the same
  slug, then
  `select count(*) from changelog where kind = 'blog' and payload->>'slug' = '<slug>'`
  → **1**.
- Existing duplication cleanup is a **separate, optional** decision (not needed
  for the fix; the rows are historical): to collapse them you would keep the
  earliest per title and delete the rest — do that only if you want the public
  changelog to read clean, and log it as a `bugfix` entry itself.
- `curl -s $SITE/api/changelog/rss | grep -c 'Blog post published'` → no longer
  grows after a re-run of a seed script.

---

## 7 — Items 34 and 39: the sort control reports a sort the query is not using, and unknown params blank the selects

Item 34 live: `/en/active` renders `<option value="newest" selected>` while the
grid is ordered by `end_date`. Item 39 live: `?sort=bogus` leaves no option
selected at all. Both are in one file, so this is one paste; the label says which
part of the patch covers which item.

### `src/components/badges/FilterBar.tsx` — full replacement

```tsx
"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { RARITY_TIERS } from "@/lib/rarity";

interface FilterBarProps {
  categories: string[];
  statusLocked?: string;
  showStatus?: boolean;
  /** The sort the page's query falls back to when no ?sort= is set. */
  defaultSort?: string;
}

function buildHref(
  pathname: string,
  params: URLSearchParams,
  updates: Record<string, string | null>,
): string {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === "" || value === "all") {
      next.delete(key);
    } else {
      next.set(key, value);
    }
  }
  next.delete("page");
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export default function FilterBar({
  categories,
  statusLocked,
  showStatus = true,
  defaultSort = "newest",
}: FilterBarProps) {
  const t = useTranslations("common");
  const tr = useTranslations("rarity");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const priceOptions = [
    { value: "all", label: t("all") },
    { value: "free", label: t("free") },
    { value: "paid", label: t("paid") },
  ];
  const statusOptions = [
    { value: "all", label: t("all") },
    { value: "active", label: t("active") },
    { value: "upcoming", label: t("upcoming") },
    { value: "expired", label: t("expired") },
  ];
  const sortOptions = [
    { value: "newest", label: t("newest") },
    { value: "oldest", label: t("oldest") },
    { value: "rarity", label: t("rarest") },
    { value: "owners", label: t("mostOwned") },
    { value: "ending", label: t("endingSoon") },
    { value: "releasing", label: t("releasingSoon") },
    { value: "name", label: t("name") },
  ];

  // Every controlled value is now validated against the option list it is
  // rendered from, and defaults to the page's own default.
  //  * An unknown `?sort=`/`?category=`/`?rarity=` used to be handed straight
  //    to `value=`, which left the <select> with no matching <option> — React
  //    ends with selectedIndex -1 and the control renders blank — while the
  //    query silently fell back to "newest".
  //  * The sort control hardcoded "newest" as its fallback even on /active and
  //    /upcoming, whose queries default to "ending"/"releasing", so it labelled
  //    the grid with a sort it was not using.
  const current = {
    q: params.get("q") ?? "",
    status:
      statusLocked ??
      statusOptions.find((option) => option.value === params.get("status"))
        ?.value ??
      "all",
    price:
      priceOptions.find((option) => option.value === params.get("price"))
        ?.value ?? "all",
    category: categories.includes(params.get("category") ?? "")
      ? (params.get("category") as string)
      : "all",
    rarity: (RARITY_TIERS as readonly string[]).includes(
      params.get("rarity") ?? "",
    )
      ? (params.get("rarity") as string)
      : "all",
    sort:
      sortOptions.find((option) => option.value === params.get("sort"))?.value ??
      sortOptions.find((option) => option.value === defaultSort)?.value ??
      "newest",
  };

  function navigate(updates: Record<string, string | null>) {
    startTransition(() => {
      router.push(buildHref(pathname, params, updates), { scroll: false });
    });
  }

  function onSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("q");
    navigate({ q: String(value ?? "") });
  }

  return (
    <div className={`card p-4 transition-opacity ${isPending ? "opacity-60" : ""}`}>
      <form onSubmit={onSearch} className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="pointer-events-none absolute inset-y-0 start-3 my-auto text-muted"
            aria-hidden
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="search"
            name="q"
            // Uncontrolled on purpose (the form submits a plain GET), but keyed
            // on the active query so clearing the filter actually empties the
            // field instead of leaving the old text in place.
            key={current.q}
            defaultValue={current.q}
            placeholder={t("search")}
            className="input ps-9"
            aria-label={t("search")}
          />
        </div>

        {showStatus && !statusLocked && (
          <div className="flex gap-1" role="group" aria-label={t("filterStatus")}>
            {statusOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={current.status === option.value}
                className={`chip ${current.status === option.value ? "chip-active" : ""}`}
                onClick={() => navigate({ status: option.value })}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-1" role="group" aria-label={t("filterPrice")}>
          {priceOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={current.price === option.value}
              className={`chip ${current.price === option.value ? "chip-active" : ""}`}
              onClick={() => navigate({ price: option.value })}
            >
              {option.label}
            </button>
          ))}
        </div>
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          className="input w-auto py-2 text-xs"
          value={current.category}
          onChange={(e) => navigate({ category: e.target.value })}
          aria-label={t("category")}
        >
          <option value="all">
            {t("category")}: {t("all")}
          </option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>

        <select
          className="input w-auto py-2 text-xs"
          value={current.rarity}
          onChange={(e) => navigate({ rarity: e.target.value })}
          aria-label={t("rarity")}
        >
          <option value="all">
            {t("rarity")}: {t("all")}
          </option>
          {RARITY_TIERS.map((tier) => (
            <option key={tier} value={tier}>
              {tr(tier)}
            </option>
          ))}
        </select>

        <select
          className="input w-auto py-2 text-xs"
          value={current.sort}
          onChange={(e) => navigate({ sort: e.target.value })}
          aria-label={t("sort")}
        >
          {sortOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        {(current.q || params.get("price") || params.get("category") || params.get("rarity") || (!statusLocked && params.get("status"))) && (
          <button
            type="button"
            className="btn btn-ghost text-xs"
            onClick={() =>
              navigate({ q: null, price: null, category: null, rarity: null, status: null })
            }
          >
            {t("clear")}
          </button>
        )}
      </div>
    </div>
  );
}
```

**Why this is correct.** The option lists are the single source of truth for
both rendering and validation, so a value can never render a blank `<select>`;
`defaultSort` (already computed by `/active` and `/upcoming`) is what the page's
query actually falls back to, so the label and the data agree. Category is
validated against the list the component was *given*, so a stale
`?category=bits` from a renamed category degrades to "All" instead of 0 results.

**Must not break.** `FilterBar` gains one optional prop with a default, so
`BadgeExplorer` (the only caller) can pass it or not. `params.get()` returns the
*first* value of a repeated param, so this file was already array-safe. Selection
markup, `buildHref`'s page reset and the "clear" condition are unchanged. Do not
remove the "all" entry from `statusOptions`: `current.status` uses it as its
default, unlike the chips which never send "all".

**Risk if wrong.** If `defaultSort` were forwarded with a value that the query
does not honour, the control would lie in the opposite direction — so keep the
two lists in step with `queries.ts`'s `SortKey` (seven values, same strings).

**Verification.**
- `curl -s $SITE/en/active | grep -o '<option value="ending" selected'` → present.
- `curl -s $SITE/en/upcoming | grep -o '<option value="releasing" selected'` →
  present.
- `curl -s $SITE/en/badges | grep -o '<option value="newest" selected'` → present.
- `curl -s "$SITE/en/badges?sort=bogus" | grep -c 'selected'` → 3 (category,
  rarity, sort all carry a selection again).
- `curl -s "$SITE/en/badges?category=bogus" | grep -o '<option value="all" selected'`
  → present.

---

## 8 — Item 38: `getCategories()` truncates at 1000 rows and its failure blanks the catalogue

### 8a. `src/lib/queries.ts` (lines 383-391, current)

```ts
export async function getCategories(): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("badges")
    .select("category")
    .order("category");
  const set = new Set((data ?? []).map((row) => row.category as string));
  return [...set].sort();
}
```

### Replacement

```ts
export async function getCategories(): Promise<string[]> {
  const supabase = await createClient();
  // PostgREST caps a single response at 1000 rows and the old select had no
  // range, so this returned the categories of only the first 1000 badges in
  // `category` order — once the catalog passed 1000 rows, every
  // alphabetically-late category silently disappeared from the dropdown, with
  // no error anywhere. Page with `.range()` and the same `id` tiebreak
  // `getCatalogKeys` uses. A query failure is thrown, not swallowed: the caller
  // treats the category list as decoration and renders the grid regardless.
  const pageSize = 1000;
  const set = new Set<string>();
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("badges")
      .select("category")
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const batch = (data ?? []) as Array<{ category: string }>;
    for (const row of batch) if (row.category) set.add(row.category);
    if (batch.length < pageSize) break;
  }
  return [...set].sort();
}
```

### 8b. `src/components/badges/BadgeExplorer.tsx` — separate the two calls

Current (lines 46-59):

```tsx
  let result = null;
  let categories: string[] = [];
  let loadFailed = false;
  try {
    [result, categories] = await Promise.all([
      listBadges(filters),
      getCategories(),
    ]);
  } catch (error) {
    // This used to be swallowed: a real database error rendered the
    // "catalog is empty" setup hint, which reads as "there are no badges".
    loadFailed = true;
    console.warn("[badges] catalog load failed:", error);
  }
```

Replacement:

```tsx
  let result = null;
  let loadFailed = false;
  try {
    result = await listBadges(filters);
  } catch (error) {
    // This used to be swallowed: a real database error rendered the
    // "catalog is empty" setup hint, which reads as "there are no badges".
    loadFailed = true;
    console.warn("[badges] catalog load failed:", error);
  }
  // The category list only fills a dropdown, and it used to share one
  // Promise.all with the badge query: a failure on the categories alone
  // discarded a perfectly good result set and showed the load-error card over
  // it. It is decoration — a failure leaves the dropdown with just "All".
  const categories = await getCategories().catch(() => []);
```

**Why this is correct.** Both halves remove a silent failure: truncation
disappears with paging, and a decorative query can no longer take down the page.
The `catch` on the categories call is the honest, narrow version of the old
shared catch.

**Must not break.** `getCategories` has exactly one caller (verified), so the new
`throw` cannot reach an unguarded call site. The first page costs one request for
the current 476 rows; a 5,000-row catalog costs five sequential requests, all
inside the same render (the page is dynamic).

**Risk if wrong.** If the DB ever returns fewer rows than requested in the middle
of a paged sweep (a transient empty page), the loop would stop early and the
dropdown would be short — the same failure mode as today, so no regression, and
the fix removes it for the normal case.

**Verification.**
- Current catalogue fits in one page, so assert parity:
  `curl -s $SITE/en/badges | grep -o '<option value="[^"]*"' | wc -l` is
  unchanged before/after.
- Simulate: temporarily lower `pageSize` to 100, load `/en/badges`, and confirm
  the dropdown still lists every category (i.e. the loop paged) — then restore.
- Perf: no new PostgREST calls in the log for a catalog under 1000 rows.

---

## 9 — Item 45: every RSS item points at the same `<link>`

Live: 101 `<link>` values, all `https://…/en/changelog`. The changelog page has
no per-entry anchor, so the fix needs both files. (`<guid>` was already
per-entry, which is why readers can still de-duplicate the items — but `<link>`
is the item permalink.)

### 9a. `src/app/[locale]/changelog/page.tsx` (line 126, current)

```tsx
                  <li key={entry.id} className="card flex gap-3 p-4">
```

### 9a. Replacement

```tsx
                  <li
                    key={entry.id}
                    id={`changelog-${entry.id}`}
                    className="card flex gap-3 p-4 scroll-mt-24"
                  >
```

`scroll-mt-24` matches the convention the stats page already uses
(`stats/page.tsx:179` etc.) so an anchor jump is not hidden under the `sticky
top-0` header. `changelog-${entry.id}` is the same string the feed already uses
as its `guid`.

### 9b. `src/app/api/changelog/rss/route.ts` (lines 18-30, current)

```ts
  const items = entries
    .map((entry) => {
      const url = `${siteUrl()}/en/changelog`;
      return `    <item>
      <title>${escapeXml(entry.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="false">changelog-${entry.id}</guid>
      <pubDate>${new Date(entry.created_at).toUTCString()}</pubDate>
      <category>${escapeXml(entry.kind)}</category>
      <description>${escapeXml(entry.body ?? entry.title)}</description>
    </item>`;
    })
    .join("\n");
```

### 9b. Replacement

```ts
  const items = entries
    .map((entry) => {
      // Per-item permalink. This was one shared `/en/changelog` for all 100
      // items, so every "read more" opened the same page and readers collapsed
      // the feed into a single URL; `<guid>` was already per-item but `<link>`
      // is the item permalink per RSS 2.0. The changelog page carries a matching
      // `id="changelog-<id>"` on each row.
      const url = `${siteUrl()}/en/changelog#changelog-${entry.id}`;
      return `    <item>
      <title>${escapeXml(entry.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="false">changelog-${entry.id}</guid>
      <pubDate>${new Date(entry.created_at).toUTCString()}</pubDate>
      <category>${escapeXml(entry.kind)}</category>
      <description>${escapeXml(entry.body ?? entry.title)}</description>
    </item>`;
    })
    .join("\n");
```

Anchors rather than a per-entry page: the changelog is one page by design
(grouped by day, with kind filters), and the 100-item feed is always inside the
page's 150-row window, so every anchor resolves.

**Must not break.** The channel-level `<link>`, `<guid isPermaLink="false">` and
`<language>en</language>` stay; feed XML is still valid (the `#` needs no
escaping). `{kind}` filters do not change the ids. Google's RSS discovery is
unaffected.

**Risk if wrong.** A wrong anchor id would make a link land at the top of the
changelog instead of the entry — a cosmetic miss, not a 404. Keep the two
`changelog-${entry.id}` strings in step; if you ever paginate the changelog below
100 entries, old feed items would land at the page top.

**Verification.**
- `curl -s $SITE/api/changelog/rss | grep -o '<link>[^<]*</link>' | sort -u | wc -l`
  → `101` (1 channel + 100 distinct items), not `1`.
- `curl -s $SITE/api/changelog/rss | grep -o '<link>[^<]*</link>' | head -2` then
  load one of them and confirm the browser jumps to that entry.
- `curl -s $SITE/en/changelog | grep -c 'id="changelog-'` → equals the number of
  rows rendered.

---

## 10 — Item 43: the badge detail page loses `og:type`, `og:url` and `og:site_name`

Live: only `og:title`, `og:description`, `og:image`. The page sets `openGraph`,
which replaces the layout's object, and Next's twitter auto-fill cannot restore
it (`resolve-metadata.js:182-184`).

### `src/app/[locale]/badges/[slug]/page.tsx` (lines 40-53, current)

```tsx
  return {
    title,
    description,
    alternates: {
      canonical: `/${locale}/badges/${badge.slug}`,
      languages: localeAlternates(`/badges/${badge.slug}`),
    },
    openGraph: {
      title,
      description,
      images: image ? [{ url: image }] : undefined,
    },
    twitter: { card: "summary", title, description },
  };
```

### Replacement

```tsx
  return {
    title,
    description,
    alternates: {
      canonical: `/${locale}/badges/${badge.slug}`,
      languages: localeAlternates(`/badges/${badge.slug}`),
    },
    // A page-level `openGraph` REPLACES the layout's rather than merging with
    // it, so the layout's `type`/`siteName` never reached the head — the live
    // page emitted only og:title/og:description/og:image, i.e. no og:type (which
    // the Open Graph protocol requires) and no og:url. `url` is resolved against
    // the layout's metadataBase. "website" is the correct generic type here:
    // "article" would declare a news post and imply article:* properties a
    // catalog entry does not have.
    openGraph: {
      type: "website",
      siteName: t("siteTitle"),
      url: `/${locale}/badges/${badge.slug}`,
      title,
      description,
      images: image ? [{ url: image }] : undefined,
    },
    twitter: { card: "summary", title, description },
  };
```

`t` is the `meta` namespace translator already fetched at the top of
`generateMetadata`, so `t("siteTitle")` exists in all eleven locales (the layout
uses the same key).

**Must not break.** `alternates` is untouched, so canonical/hreflang are
unchanged; `metadataBase` from `[locale]/layout.tsx:29` makes the relative
`og:url` absolute (verified in Next's `resolve-opengraph.js:102`). The existing
`twitter` object already overrides the layout's, so its card type stays
`summary` (do not silently upgrade it to `summary_large_image` in this patch —
that is a separate, arguable change).

**Risk if wrong.** A malformed `url` would emit a wrong `og:url`, which
aggregators treat as the canonical hint — that is why it is built from the same
`${locale}` string as the (already correct) canonical.

**Verification.**
- `curl -s $SITE/en/badges/rematch-blue-lock-v1 | grep -o '<meta property="og:[^>]*>'`
  → `og:type`, `og:url`, `og:site_name` all present, `og:url` equal to the
  canonical.
- `curl -s $SITE/de/badges/rematch-blue-lock-v1 | grep -o 'og:url[^>]*'` →
  `…/de/badges/rematch-blue-lock-v1`.
- Open Graph debugger (`developers.facebook.com/tools/debug`) → scrape → type
  `website`, no warnings.

---

## 11 — Item 44: blog and profile Twitter cards carry the *site* title

Live: `/en/blog/drop-rematch-blue-lock-v1` has `og:title` = post title but
`twitter:title` = "Twitch Badges Database". Cause: those pages declare
`openGraph` but not `twitter`, so the layout's `twitter` object survives; because
`twitter.title` is already present by the time Next could auto-fill from
`openGraph`, the auto-fill is suppressed (`resolve-metadata.js:620-636`) — the
image *is* auto-filled, which is why only title/description are wrong.

### 11a. `src/app/[locale]/blog/[slug]/page.tsx` (lines 27-41, current)

```tsx
  return {
    title,
    description: post.excerpt ?? post.title,
    alternates: {
      canonical: `/${locale}/blog/${post.slug}`,
      languages: localeAlternates(`/blog/${post.slug}`),
    },
    openGraph: {
      type: "article",
      title,
      description: post.excerpt ?? post.title,
      publishedTime: post.published_at,
      images: post.cover_url ? [{ url: post.cover_url }] : undefined,
    },
  };
```

### 11a. Replacement

```tsx
  return {
    title,
    description: post.excerpt ?? post.title,
    alternates: {
      canonical: `/${locale}/blog/${post.slug}`,
      languages: localeAlternates(`/blog/${post.slug}`),
    },
    openGraph: {
      type: "article",
      title,
      description: post.excerpt ?? post.title,
      publishedTime: post.published_at,
      images: post.cover_url ? [{ url: post.cover_url }] : undefined,
    },
    // Not optional: the layout's `twitter` block survives when a page omits it,
    // and X prefers twitter:title over og:title — every blog card showed the
    // site name while og:title was the post title. twitter:image still
    // auto-fills from openGraph.images.
    twitter: {
      card: "summary_large_image",
      title,
      description: post.excerpt ?? post.title,
    },
  };
```

### 11b. `src/app/[locale]/profile/[username]/page.tsx` (lines 46-63, current)

```tsx
  return {
    title,
    description,
    alternates: {
      canonical: `/${locale}/profile/${username}`,
      languages: localeAlternates(`/profile/${username}`),
    },
    openGraph: {
      type: "profile",
      title,
      description,
      images: [
        {
          url: `/api/og/profile?u=${encodeURIComponent(username)}&locale=${locale}`,
        },
      ],
    },
  };
```

### 11b. Replacement

```tsx
  return {
    title,
    description,
    alternates: {
      canonical: `/${locale}/profile/${username}`,
      languages: localeAlternates(`/profile/${username}`),
    },
    openGraph: {
      type: "profile",
      title,
      description,
      images: [
        {
          url: `/api/og/profile?u=${encodeURIComponent(username)}&locale=${locale}`,
        },
      ],
    },
    // Same layout contract as the blog page: without an explicit `twitter`
    // object the card headline is the site title, not the profile.
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
```

**Why this is correct.** Fixing it per page (2 files) rather than in the layout:
the layout cannot know the page's title, and its generic title is *correct* for
every page that has no metadata of its own. `summary_large_image` matches the
existing layout card type and the fact that both pages do emit a large image.

**Must not break.** `title`/`description` are the exact strings the `openGraph`
object uses, so card and preview can no longer disagree. `twitter:image` keeps
coming from the auto-fill; adding `images` here is unnecessary and would risk
duplicating it.

**Risk if wrong.** Only the social card headline; no indexing effect. Do not
"fix" it in the layout — that would put the site title on pages whose
`og:title` is page-specific in the opposite direction (badge pages already set
their own).

**Verification.**
- `curl -s $SITE/en/blog/drop-rematch-blue-lock-v1 | grep -o '<meta name="twitter:title"[^>]*>'`
  → the post title, identical to `og:title`.
- `curl -s $SITE/en/profile/shroud | grep -o '<meta name="twitter:title"[^>]*>'`
  → the profile title.
- Card preview via X's validator, or inspect that `twitter:image` is still the
  post cover / OG profile image.

---

## 12 — Item 46: a null owner count renders the contradictory "0 owners —"

Live on `/en/badges/bits-v100`: `<dt>0 owners</dt><dd>—</dd>` and
`<dt>0 active users</dt><dd>—</dd>`. The `?? 0` exists only to satisfy the ICU
plural; the value column was already honest.

### `src/app/[locale]/badges/[slug]/page.tsx` (lines 222-238, current)

```tsx
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">{t("ownerCount", { count: badge.owner_count ?? 0 })}</dt>
              <dd className="font-semibold tabular-nums">
                {badge.owner_count !== null
                  ? new Intl.NumberFormat(locale).format(badge.owner_count)
                  : "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">{t("activeCount", { count: badge.active_count ?? 0 })}</dt>
              <dd className="font-semibold tabular-nums">
                {badge.active_count !== null
                  ? new Intl.NumberFormat(locale).format(badge.active_count)
                  : "—"}
              </dd>
            </div>
```

### Replacement

```tsx
          <dl className="space-y-3 text-sm">
            {/* A row is only rendered when the count is known. `?? 0` existed to
                satisfy the ICU plural, so a badge nobody has polled rendered the
                contradiction "0 owners" beside the value "—" (live:
                /en/badges/bits-v100). The listing card already omits the line
                entirely when the count is null (BadgeCard.tsx), and a real 0 now
                reads "0 owners / 0" — label and value always agree. */}
            {badge.owner_count !== null && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted">
                  {t("ownerCount", { count: badge.owner_count })}
                </dt>
                <dd className="font-semibold tabular-nums">
                  {new Intl.NumberFormat(locale).format(badge.owner_count)}
                </dd>
              </div>
            )}
            {badge.active_count !== null && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted">
                  {t("activeCount", { count: badge.active_count })}
                </dt>
                <dd className="font-semibold tabular-nums">
                  {new Intl.NumberFormat(locale).format(badge.active_count)}
                </dd>
              </div>
            )}
```

**Why this is correct.** Each row states a fact or is absent; nothing claims a
number the page does not know. It also removes the `—` branch (unreachable once
the null case is excluded) and matches the listing card's treatment of the same
data.

**Must not break.** No new key: `badges.ownerCount`/`badges.activeCount` keep
their ICU plurals and are now only called with a real number, so no locale can
hit plural branch 0 with a placeholder mismatch. The `liveCount`,
`percentageOfUsers` and rarity rows are untouched. The section still renders
(the "Owners" heading stays even if both rows are absent — consider that
acceptable; if you would rather hide the whole `<dl>`, that is a taste call, not
a correctness one).

*Alternative if you prefer to signal "unknown" explicitly:* add
`badges.countUnknown` to all eleven files and render it as the `dt` for a null
count. I did not propose it because it costs eleven translations for the same
information the absence already conveys.

**Risk if wrong.** Only layout height on unpolled badges. Do not swap the value
to `0` to "match" the label — that is the current bug.

**Verification.**
- `curl -s $SITE/en/badges/bits-v100 | grep -c '0 owners'` → `0`; and
  `grep -o '<dt class="text-muted">[^<]*</dt>'` lists only known counts.
- `curl -s $SITE/en/badges/harley-mayhem-v1 | grep -o '1,830 owners'` → still
  present (non-null case unchanged).
- A badge with a genuine zero still reads "0 owners" with value `0`.

---

## 13 — Item 47: the OG font gate covers only nine script groups

`src/app/api/og/profile/route.tsx:17-26` — a display name in Tamil, Bengali,
Telugu, Georgian, Armenian, Ethiopic, Khmer, Lao, Myanmar, Sinhala, Tibetan (…)
matches nothing, `familyForText` returns `null` and the name renders as tofu on
`/api/og/profile`, which is the exact failure the loader was added for.

### Current (lines 17-26)

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

### Replacement

```ts
// Every entry is a Google Fonts family name (the css2 endpoint 400s on an
// unknown one, which just leaves the name as tofu — the same outcome as no
// gate, so adding coverage is safe). Order matters: the first match wins, so
// kana precedes Han and the more specific Indic families precede nothing
// generic. Latin needs no entry (Geist covers it).
const SCRIPT_FAMILIES: Array<[RegExp, string]> = [
  [/[\p{Script=Hiragana}\p{Script=Katakana}]/u, "Noto+Sans+JP"],
  [/\p{Script=Hangul}/u, "Noto+Sans+KR"],
  [/\p{Script=Han}/u, "Noto+Sans+SC"],
  [/\p{Script=Arabic}/u, "Noto+Sans+Arabic"],
  [/\p{Script=Hebrew}/u, "Noto+Sans+Hebrew"],
  [/\p{Script=Thai}/u, "Noto+Sans+Thai"],
  [/\p{Script=Devanagari}/u, "Noto+Sans+Devanagari"],
  [/\p{Script=Bengali}/u, "Noto+Sans+Bengali"],
  [/\p{Script=Tamil}/u, "Noto+Sans+Tamil"],
  [/\p{Script=Telugu}/u, "Noto+Sans+Telugu"],
  [/\p{Script=Kannada}/u, "Noto+Sans+Kannada"],
  [/\p{Script=Malayalam}/u, "Noto+Sans+Malayalam"],
  [/\p{Script=Gujarati}/u, "Noto+Sans+Gujarati"],
  [/\p{Script=Gurmukhi}/u, "Noto+Sans+Gurmukhi"],
  [/\p{Script=Oriya}/u, "Noto+Sans+Oriya"],
  [/\p{Script=Sinhala}/u, "Noto+Sans+Sinhala"],
  [/\p{Script=Tibetan}/u, "Noto+Sans+Tibetan"],
  [/\p{Script=Myanmar}/u, "Noto+Sans+Myanmar"],
  [/\p{Script=Khmer}/u, "Noto+Sans+Khmer"],
  [/\p{Script=Lao}/u, "Noto+Sans+Lao"],
  [/\p{Script=Ethiopic}/u, "Noto+Sans+Ethiopic"],
  [/\p{Script=Georgian}/u, "Noto+Sans+Georgian"],
  [/\p{Script=Armenian}/u, "Noto+Sans+Armenian"],
  [/\p{Script=Thaana}/u, "Noto+Sans+Thaana"],
  [/\p{Script=Cyrillic}/u, "Noto+Sans"],
];
```

**Why this is correct.** The list is the only mechanism that can select a font
(`familyForText` returns `null` otherwise and the card draws with Geist), so
coverage has to be enumerated — there is no runtime "which script is this" API in
Node without a list. The order is preserved (specific before generic) and the
existing nine entries are untouched, so nothing that works today changes.

**Must not break.** A wrong family name is not a regression: `loadSubsetFont`
returns `null` on a non-OK CSS response and the render falls back to today's
behaviour. The 6 s timeouts, the cache key and `FONT_CACHE_MAX` are untouched.
Note the comment in the function still holds: once a non-Latin font is
registered it replaces Geist for the whole image, which is why `fontText` (not
just the display name) is the subset requested.

**Risk if wrong.** Additional latency only for names in the newly covered
scripts (one CSS + one font fetch, cached per family+name). Still-uncovered
scripts degrade exactly as today; Twitch display names are the practical ceiling,
not a documented character set — if you want zero gaps, the only complete answer
is to ship a font with full coverage instead of subsets, which is out of scope
for this bug.

**Verification.**
- The live mechanism already works for the covered scripts; for a new one, pick a
  display name and check the response is not tofu:
  `curl -s -o /tmp/og.png -w "%{http_code} %{size_download}\n" "$SITE/api/og/profile?u=<a user with a Tamil display name>"`.
- Unit-level: temporarily log `familyForText` for a name in each newly added
  script and assert it returns the intended family (a snippet against
  `\p{Script=Tamil}` etc. is enough):
  `node -e "console.log(/\p{Script=Tamil}/u.test('அ'))"` → true.
- Assert the nine original scripts still resolve to the same families (the array
  order is unchanged).

---

## 14 — Item 37: the home page's two extra "view all" links have no accessible name

Live: `<a … href="/en/changelog"><span class="dir-arrow" aria-hidden="true">→</span></a>`
— the only child is `aria-hidden`, so the link announces as just "link". The four
sibling sections include `{tc("viewAll")}`.

### `src/app/[locale]/page.tsx` (lines 130-132, current)

```tsx
                <Link href="/changelog" className="text-xs font-semibold text-accent hover:underline">
                  <span className="dir-arrow" aria-hidden>→</span>
                </Link>
```

### Replacement

```tsx
                <Link href="/changelog" className="text-xs font-semibold text-accent hover:underline">
                  {tc("viewAll")} <span className="dir-arrow" aria-hidden>→</span>
                </Link>
```

### `src/app/[locale]/page.tsx` (lines 153-155, current)

```tsx
                <Link href="/blog" className="text-xs font-semibold text-accent hover:underline">
                  <span className="dir-arrow" aria-hidden>→</span>
                </Link>
```

### Replacement

```tsx
                <Link href="/blog" className="text-xs font-semibold text-accent hover:underline">
                  {tc("viewAll")} <span className="dir-arrow" aria-hidden>→</span>
                </Link>
```

**Why this is correct.** These two were the only pair of the six "view all"
links missing the label; `common.viewAll` exists in all eleven locales (the other
four use it) and the markup then matches them exactly, including the space before
the arrow. WCAG 2.4.4/4.1.2.

**Must not break.** No layout change: the arrow span stays `aria-hidden`, the
class list is untouched, and the added text is the same length class the sibling
links use. No new key.

**Risk if wrong.** None beyond a slightly wider header row in some locales; the
sibling rows already carry the identical structure and wrap the same way.

**Verification.**
- `curl -s $SITE/en | grep -oP '<a[^>]*href="/en/changelog"[^>]*>.{0,60}'` →
  contains the translated "View all" (and the same for `/en/blog`).
- `curl -s $SITE/ar | grep -A1 'href="/ar/blog"'` → Arabic label present.
- Accessibility tree: the links now have names (VoiceOver/NVDA, or
  `npx axe` on the homepage).

---

## 15 — Item 40: every `revalidate` on a `[locale]` page is inert

**Plain answer: the honest fix is to remove the declarations. Do not restructure
the rendering for this.** Reasoning, and why I am confident:

- Every `[locale]/*` route is rendered dynamically because
  `src/app/[locale]/layout.tsx` awaits `createClient()`, which awaits `cookies()`
  (`src/lib/supabase/server.ts:6`) — a dynamic API anywhere in a route's
  render (page **or** layout) opts the whole route out of static/ISR rendering.
- Verified live, not inferred: `/en/faq` declares `revalidate = 3600` and still
  answers `Cache-Control: private, no-cache, no-store, max-age=0,
  must-revalidate` with `X-Vercel-Cache: MISS` — the dynamic signature. An ISR
  route would answer `s-maxage=3600` and cache hits. Same for `/en`,
  `/en/badges`, `/en/leaderboards`, `/en/stats`.
- The fourteen declarations are therefore documentation that lies. They are also
  not load-bearing for freshness: the upstream clients pass their own
  `next: { revalidate }` (`perfil.ts:70`, `potat.ts:39/237/294`), and
  `LiveRefresher` handles the client side.

**Recommendation (and it needs no justification beyond the above): delete the
`export const revalidate = N;` line from these fourteen files.**

| File | Line | Value |
|---|---|---|
| `src/app/[locale]/page.tsx` | 9 | 120 |
| `src/app/[locale]/active/page.tsx` | 8 | 120 |
| `src/app/[locale]/badges/page.tsx` | 8 | 120 |
| `src/app/[locale]/badges/[slug]/page.tsx` | 22 | 120 |
| `src/app/[locale]/blog/page.tsx` | 7 | 300 |
| `src/app/[locale]/blog/[slug]/page.tsx` | 15 | 300 |
| `src/app/[locale]/changelog/page.tsx` | 7 | 60 |
| `src/app/[locale]/expired/page.tsx` | 8 | 600 |
| `src/app/[locale]/faq/page.tsx` | 7 | 3600 |
| `src/app/[locale]/leaderboards/page.tsx` | 18 | 3600 |
| `src/app/[locale]/notifications/page.tsx` | 8 | 60 |
| `src/app/[locale]/profile/[username]/page.tsx` | 35 | 300 |
| `src/app/[locale]/stats/page.tsx` | 31 | 300 |
| `src/app/[locale]/upcoming/page.tsx` | 8 | 300 |

**Keep** `src/app/sitemap.ts:7` and `src/app/api/og/profile/route.tsx:4`: neither
is under the `[locale]` layout, both are genuinely cached, and both are load
bearing (the sitemap is expensive; the OG image is fetched by every social
crawler). Removing those would be the mistake this item is warning about.

To leave the finding documented for the next reader, add one comment where the
cause is, in `src/app/[locale]/layout.tsx` just above the `createClient()` call:

```tsx
  // Reading cookies here makes every route under [locale] dynamically rendered,
  // which is why no page in this segment can use `export const revalidate`
  // (removed — it was inert, see bugreports/full-audit/VERIFIED.md item 40).
  // Upstream fetch caching is configured per request in src/lib/twitch/*.
```

**Why not restructure.** To make those declarations effective the layout would
have to stop reading cookies, i.e. the auth-dependent header would have to move
out of the layout into something resolved per request anyway — a new API
endpoint plus a client-side fetch, which buys a static shell at the cost of a
logged-out flash in the header on every navigation, and a new public surface. The
pages that gained the most (home, badges, faq) are the ones whose *data* also
changes on every sync, and the DB reads are the render's cost, not the shell.
That is a performance project with its own design and verification, not a
bug-fix rider; if you want it, do it deliberately and re-add `revalidate` only
for the routes the new architecture actually makes static.

**Must not break.** Deleting a segment config that has no effect cannot change
behaviour; the risk is the opposite — that some future reader mistakes the
removal for "we lost caching". The layout comment covers that. If you ever move
the auth read out of the layout, re-add the values deliberately.

**Risk if wrong.** If I am wrong about the dynamic opt-out, the pages would
become statically cached with a 120 s window and visitors could see a stale
catalog. That is testable in one command (below) before you trust it; the header
evidence above is that test.

**Verification.**
- Before/after, identical:
  `for p in /en /en/faq /en/badges; do curl -s -o /dev/null -D - $SITE$p | grep -i '^cache-control'; done`
  → `private, no-cache, no-store…` both times.
- `npx next build` → the route table lists the `/[locale]/…` routes with `ƒ`
  (Dynamic) and no `○`/`●`; nothing should move between the before and after
  builds except the absent `Revalidate` column value.
- Unit sanity: `/en/faq` content is unchanged after a deploy (no visual diff).

---

## 16 — Item 54: the compare chip counts rows while at most 48 tiles are drawn

`src/app/[locale]/compare/page.tsx:191` prints `column.rows.length`;
`:195` renders `column.rows.slice(0, 48)`; `:87-88` passes `120` to
`fetchUserBadges(a, 120)`, whose second parameter is `revalidate`, not a limit
(`src/lib/twitch/perfil.ts:112-121`) — so the count and the render are unrelated
above 48. Verified in code; the whole diff can be up to the catalog size (476).

### 16a. New message key — `compare.truncated` in all eleven files

Add to the `compare` namespace of each `messages/<locale>.json` (position inside
the namespace does not matter; keep the file valid JSON):

| File | Value |
|---|---|
| `messages/en.json` | `"truncated": "Showing the first {shown} of {total}."` |
| `messages/pt.json` | `"truncated": "Mostrando os primeiros {shown} de {total}."` |
| `messages/es.json` | `"truncated": "Mostrando los primeros {shown} de {total}."` |
| `messages/fr.json` | `"truncated": "Affichage des {shown} premiers sur {total}."` |
| `messages/de.json` | `"truncated": "Es werden die ersten {shown} von {total} angezeigt."` |
| `messages/ru.json` | `"truncated": "Показаны первые {shown} из {total}."` |
| `messages/zh.json` | `"truncated": "显示前 {shown} 个，共 {total} 个。"` |
| `messages/ar.json` | `"truncated": "عرض أول {shown} من {total}."` |
| `messages/ja.json` | `"truncated": "最初の {shown} 件を表示中（全 {total} 件）。"` |
| `messages/it.json` | `"truncated": "Mostrati i primi {shown} di {total}."` |
| `messages/ko.json` | `"truncated": "총 {total}개 중 처음 {shown}개를 표시합니다."` |

(Only en/pt/es/fr/de/ru/zh/ar/ja/it/ko exist; all eleven must get the key or
next-intl throws `MISSING_MESSAGE` for the locales that lack it. Ask a native
speaker to review the phrasing if you want it canonical.)

### 16b. `src/app/[locale]/compare/page.tsx` — the cap becomes explicit

Add near the top of the module (above `resolveOwned`):

```tsx
/** How many badges one diff column renders before it is truncated. */
const RENDER_CAP = 48;
```

Current (lines 193-212):

```tsx
          {column.rows.length > 0 ? (
            <div className="grid grid-cols-3 gap-2 p-4 sm:grid-cols-6 md:grid-cols-8">
              {column.rows.slice(0, 48).map((row) => (
                <Link
                  key={row.id}
                  href={`/badges/${row.slug}`}
                  className="badge-tile card-interactive rounded-[var(--radius-input)]"
                  title={row.title}
                >
                  <BadgeImage badge={row} size={36} alt="" />
                  <p className="line-clamp-2 text-[0.625rem] font-semibold leading-tight">
                    {row.title}
                  </p>
                  <RarityChip tier={row.rarity_tier} compact />
                </Link>
              ))}
            </div>
          ) : (
            <p className="p-6 text-center text-sm text-muted">—</p>
          )}
```

Replacement:

```tsx
          {column.rows.length > 0 ? (
            <>
              <div className="grid grid-cols-3 gap-2 p-4 sm:grid-cols-6 md:grid-cols-8">
                {column.rows.slice(0, RENDER_CAP).map((row) => (
                  <Link
                    key={row.id}
                    href={`/badges/${row.slug}`}
                    className="badge-tile card-interactive rounded-[var(--radius-input)]"
                    title={row.title}
                  >
                    <BadgeImage badge={row} size={36} alt="" />
                    <p className="line-clamp-2 text-[0.625rem] font-semibold leading-tight">
                      {row.title}
                    </p>
                    <RarityChip tier={row.rarity_tier} compact />
                  </Link>
                ))}
              </div>
              {/* The header chip counts the whole diff while only RENDER_CAP
                  tiles are drawn, so without this the page stated a number it
                  did not show (a perfil result is unbounded — the second argument
                  to fetchUserBadges is a cache window, not a limit). */}
              {column.rows.length > RENDER_CAP && (
                <p className="border-t border-line px-5 py-2 text-xs text-muted">
                  {t("truncated", { shown: RENDER_CAP, total: column.rows.length })}
                </p>
              )}
            </>
          ) : (
            <p className="p-6 text-center text-sm text-muted">—</p>
          )}
```

**Why this is correct.** The chip keeps reporting the true diff size (useful),
and the reader learns that the grid is a prefix of it — instead of a silent
truncation. The cap stays a cap (a 476-row pair is not worth 1,428 image
requests), and the number in the notice is computed, not hardcoded.

**Must not break.** The chip stays `column.rows.length`. The three columns,
their headings, the `—` empty state and the head-to-head cards are untouched.
The notice lives inside the column `<section>`, under the `.card` border, so it
reads as part of that column. If you would rather not touch eleven message files,
the only zero-i18n alternative is to drop the `.slice()` cap entirely — honest
but it renders up to the whole catalog per column; I do not recommend it at this
size, which is why I proposed the key.

**Risk if wrong.** A key missing from one locale throws `MISSING_MESSAGE` on
`/compare` for that locale only, and the build still succeeds (AGENTS.md covers
this). Check the build log for `MISSING_MESSAGE` after adding the eleven lines.

**Verification.**
- Small pair (no truncation): `curl -s "$SITE/en/compare?users=ninja,xqc" | grep -o 'Showing the first'`
  → no match, and the tile count equals the sum of the three chips
  (`grep -o 'badge-tile card-interactive' | wc -l` counts both the HTML and the
  RSC payload, so expect 2× the number of tiles).
- Big pair: find two collectors whose diff exceeds 48 and assert
  `grep -c 'Showing the first 48 of'` → 1 per truncated column, and the rendered
  tiles for that column are exactly 48.
- `npm run lint && npm run typecheck && npm run build`, then
  `grep -c MISSING_MESSAGE <build log>` → 0.

---

## Application order (each with its own `log:change` row)

1. Item 8 (both files) — the only finding a normal visitor can hit by clicking.
2. Item 32 (route + component + page) — same surface, and the halves depend on
   each other.
3. Item 41, then 43/44 (two files each), then 42 — all SEO/OG, no shared code.
4. Item 35/36 (`queries.ts::listBadges`), then 38 (`getCategories` +
   `BadgeExplorer`), then 34/39 (`FilterBar` + the `defaultSort` forward in
   `BadgeExplorer`) — these three touch the same two files, so apply them in one
   sitting and re-run `typecheck` between edits.
5. Item 31 (`blog.ts`) and 45 (changelog + RSS) — content.
6. Item 46 (badge detail page) and 47 (OG route) — small, independent.
7. Item 54 (eleven message files + compare page) — do the JSON edits with a
   script or a careful diff; key-parity is the whole risk.
8. Item 40 (delete fourteen lines + one layout comment) — last, because every
   other patch above touches the same files and this one is mechanical.

## Deliberately not proposed

- **Rewriting `Product` into a valid rich-result node** (item 45's implied
  remedy). The report is right that the node is invalid, but the two ways to fix
  it are both worse than removing it: `offers` needs a price (a paid badge costs
  whatever the underlying sub/ticket costs — a number this site does not have, so
  any value would be invented), and `review`/`aggregateRating` would be
  fabricated review data, which is the one thing Search Console penalises
  manually. I proposed changing `@type` to `CreativeWork`, which describes the
  page's real subject (name, description, image, category, URL) and validates
  without inventing commercial data; no rich result is lost, because none is
  currently eligible. If you want a badge product snippet later, the honest route
  is to add a real price source first.
- **Making the sitemap drop the 143 game URLs** instead of fixing their
  canonical. Both are defensible; the sitemap entry was added deliberately
  ("Every playable game has its own page and was absent from the sitemap"), so I
  restored that intent rather than reversing it. If you would rather keep
  login-gated pages out of the index, the change is to delete the game loop in
  `sitemap.ts:91-101` and keep the unknown-game canonical — say so and I will
  write that variant instead.
- **A `GET`-based alternative for item 32b** and the **per-page `twitter` object
  in the layout** for item 44 — both described above and both rejected for the
  reasons given.
- **Any cleanup of data already written**: the 139 duplicate `blog` changelog
  rows, the legacy `/en/...` notification URLs, and the historical
  `revalidate`-era freshness are left alone. The first two are handled by the
  code changes above (the consumer normalises; new rows are correct); the
  duplicate changelog rows are a cosmetic, historical decision that deserves its
  own changelog entry rather than being smuggled into a fix.
