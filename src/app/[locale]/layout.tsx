import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { headers } from "next/headers";
import { routing, isRtl, localeHtmlLang, localeNames, type Locale } from "@/i18n/routing";
import { COUNTRY_TO_LOCALE } from "@/i18n/geo";
import { createClient } from "@/lib/supabase/server";
import { siteUrl, localeAlternates } from "@/lib/seo";
import { getFeatures } from "@/lib/settings";
import Header, { type HeaderUser } from "@/components/Header";
import Footer from "@/components/Footer";
import ThemeScript from "@/components/ThemeScript";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import AnalyticsBeacon from "@/components/AnalyticsBeacon";
import LanguageHint from "@/components/LanguageHint";
import "../globals.css";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });

  return {
    metadataBase: new URL(siteUrl()),
    title: {
      default: t("siteTitle"),
      template: `%s · ${t("siteTitle")}`,
    },
    description: t("siteDescription"),
    alternates: {
      canonical: `/${locale}`,
      languages: localeAlternates("/"),
    },
    openGraph: {
      type: "website",
      siteName: t("siteTitle"),
      // NO `title` here on purpose: Next only falls back to the page's own title
      // when openGraph.title is unset, so setting it here froze every page that
      // does not define its own openGraph — thirteen routes emitted the site name
      // as their og:title. The page title serves as the og:title instead.
      description: t("siteDescription"),
      // summary_large_image cards need an image; without one the card renders
      // empty for every page that does not declare its own.
      images: ["/icon-512.png"],
    },
    twitter: {
      card: "summary_large_image",
      // Same fallback rule: without twitter.title, X reads og:title — which is the
      // page's own title now that openGraph.title is unset above.
      description: t("siteDescription"),
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  // This layout reads the session (`cookies()` below), which makes every page in
  // this segment render dynamically — so a page-level `export const revalidate`
  // here has no effect and the fourteen that used to exist were removed rather
  // than left looking load-bearing. Freshness comes from the data clients, which
  // pass their own `next: { revalidate }`. `src/app/sitemap.ts` and the OG route
  // do keep theirs; those really are cached.
  let user: HeaderUser | null = null;
  try {
    const supabase = await createClient();
    // getSession() decodes the JWT locally — zero network. The proxy already
    // validated/refreshed the session authoritatively on this very request, so
    // a second blocking auth round trip here only added latency to every
    // navigation (getUser() calls the auth server on every invocation).
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const authUser = session?.user ?? null;
    if (authUser) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("username, avatar_url, role")
        .eq("id", authUser.id)
        .maybeSingle();
      if (profile) {
        const role = profile.role as string | null;
        user = {
          username: profile.username as string,
          avatarUrl: (profile.avatar_url as string | null) ?? null,
          isAdmin: role === "admin" || role === "owner",
          role,
        };
      }
    }
  } catch {
    // DB not migrated yet — render the site logged-out.
  }

  const features = await getFeatures();
  const t = await getTranslations("meta");

  // Country-of-origin language hint: when the visitor's country maps to a
  // catalog locale that differs from the one being served, offer it. A
  // German visitor whose browser prefers English lands on /en and is offered
  // Deutsch; a visitor whose origin and page agree sees nothing. The geo
  // header is set by Vercel's edge; locally (and on any host that omits it)
  // the hint simply never fires.
  let hintTarget: Locale | null = null;
  try {
    const country = (await headers()).get("x-vercel-ip-country")?.toUpperCase();
    const geoLocale = country ? COUNTRY_TO_LOCALE[country] : undefined;
    if (geoLocale && geoLocale !== locale) hintTarget = geoLocale;
  } catch {
    hintTarget = null;
  }

  // Ship ONLY the namespaces client components actually read. Without a
  // messages prop the provider serializes the entire catalog (58–86 KB per
  // locale) into every RSC payload — on every navigation and router.refresh().
  // Server components are unaffected: they read via getTranslations on the
  // server. Keeping this list in sync is enforced by `npm run i18n:check`
  // (scripts/i18n-check.ts), which fails the build when a client component
  // asks for a namespace this subset does not ship — next-intl then renders
  // raw key paths and only console.errors, so nothing else warns.
  const allMessages = (await getMessages()) as Record<string, unknown>;
  const CLIENT_NAMESPACES = [
    "nav", "common", "footer", "login", "errors", "account", "profile",
    "customizer", "inventory", "notifications", "feed", "blog", "compare",
    "countdown", "rarity", "roles", "stats", "wheel", "steal", "games",
    "admin", "badges",
  ];
  const clientMessages = Object.fromEntries(
    CLIENT_NAMESPACES.filter((ns) => ns in allMessages).map((ns) => [ns, allMessages[ns]]),
  );

  return (
    <html
      lang={localeHtmlLang[locale as keyof typeof localeHtmlLang] ?? locale}
      dir={isRtl(locale) ? "rtl" : "ltr"}
      suppressHydrationWarning
    >
      <body className="min-h-dvh antialiased">
        <ThemeScript />
        <NextIntlClientProvider messages={clientMessages}>
          <div className="flex min-h-dvh flex-col">
            <Header user={user} features={features} />
            <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
              {children}
            </main>
            <Footer />
          </div>
          {/* Inside the provider on purpose: the beacon uses the i18n-aware
              usePathname, which throws without a locale context — that broke
              the prerender of every locale page. The hint chip needs the same
              context for its locale-switching Link, and a Suspense boundary
              because it reads search params (useSearchParams prerender rule). */}
          <AnalyticsBeacon locale={locale} />
          {hintTarget && (
            <Suspense fallback={null}>
              <LanguageHint
                target={hintTarget}
                langName={localeNames[hintTarget]}
                hint={t("langHint", { lang: localeNames[hintTarget] })}
                dismissLabel={t("langHintDismiss")}
              />
            </Suspense>
          )}
        </NextIntlClientProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}

