import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import WheelOfFortune from "@/components/WheelOfFortune";
import { localeAlternates } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "wheel" });
  return {
    title: t("title"),
    description: t("subtitle"),
    alternates: {
      canonical: `/${locale}/wheel`,
      languages: localeAlternates("/wheel"),
    },
  };
}

export default async function WheelPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("wheel");

  return (
    <div className="mx-auto max-w-2xl space-y-8 py-6">
      <header className="text-center">
        <h1 className="text-3xl font-extrabold tracking-tight">🎡 {t("title")}</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted">{t("subtitle")}</p>
      </header>
      <WheelOfFortune />
    </div>
  );
}
