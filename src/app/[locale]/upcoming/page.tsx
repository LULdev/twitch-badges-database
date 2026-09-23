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
      canonical: `/${locale}/upcoming`,
      languages: localeAlternates("/upcoming"),
    }, title: t("upcomingTitle"), description: t("upcomingSubtitle") };
}

export default async function UpcomingPage({
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
      title={t("upcomingTitle")}
      subtitle={t("upcomingSubtitle")}
      statusLocked="upcoming"
      defaultSort="releasing"
      searchParams={sp}
    />
  );
}
