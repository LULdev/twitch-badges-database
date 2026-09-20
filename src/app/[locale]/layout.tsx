import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { routing, isRtl, localeHtmlLang } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { siteUrl, localeAlternates } from "@/lib/seo";
import Header, { type HeaderUser } from "@/components/Header";
import Footer from "@/components/Footer";
import ThemeScript from "@/components/ThemeScript";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
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

  let user: HeaderUser | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    if (authUser) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("username, avatar_url")
        .eq("id", authUser.id)
        .maybeSingle();
      if (profile) {
        user = {
          username: profile.username as string,
          avatarUrl: (profile.avatar_url as string | null) ?? null,
        };
      }
    }
  } catch {
    // DB not migrated yet — render the site logged-out.
  }

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
            <Header user={user} />
            <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
              {children}
            </main>
            <Footer />
          </div>
        </NextIntlClientProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
