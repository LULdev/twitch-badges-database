import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { routing, isRtl, localeHtmlLang } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { siteUrl, localeAlternates } from "@/lib/seo";
import { getFeatures } from "@/lib/settings";
import Header, { type HeaderUser } from "@/components/Header";
import Footer from "@/components/Footer";
import ThemeScript from "@/components/ThemeScript";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import AnalyticsBeacon from "@/components/AnalyticsBeacon";
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
      title: t("siteTitle"),
      description: t("siteDescription"),
    },
    twitter: {
      card: "summary_large_image",
      title: t("siteTitle"),
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
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
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

  return (
    <html
      lang={localeHtmlLang[locale as keyof typeof localeHtmlLang] ?? locale}
      dir={isRtl(locale) ? "rtl" : "ltr"}
      suppressHydrationWarning
    >
      <body className="min-h-dvh antialiased">
        <ThemeScript />
        <NextIntlClientProvider>
          <div className="flex min-h-dvh flex-col">
            <Header user={user} features={features} />
            <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
              {children}
            </main>
            <Footer />
          </div>
          {/* Inside the provider on purpose: the beacon uses the i18n-aware
              usePathname, which throws without a locale context — that broke
              the prerender of every locale page. */}
          <AnalyticsBeacon locale={locale} />
        </NextIntlClientProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}

