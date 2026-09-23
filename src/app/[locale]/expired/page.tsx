import { getTranslations, setRequestLocale } from "next-intl/server";
import { type Metadata } from "next";
import BadgeExplorer, {
  type ExplorerSearchParams,
} from "@/components/badges/BadgeExplorer";
import { localeAlternates } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "badges" });
  return {
    alternates: {
      canonical: `/${locale}/expired`,
      languages: localeAlternates("/expired"),
    }, title: t("expiredTitle"), description: t("expiredSubtitle") };
}

export default async function ExpiredPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<ExplorerSearchParams>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [sp, t] = await Promise.all([
    searchParams,
    getTranslations("badges"),
  ]);
  return (
    <BadgeExplorer
      title={t("expiredTitle")}
      subtitle={t("expiredSubtitle")}
      statusLocked="expired"
      defaultSort="newest"
      searchParams={sp}
    />
  );
}
