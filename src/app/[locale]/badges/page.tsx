import { getTranslations, setRequestLocale } from "next-intl/server";
import { type Metadata } from "next";
import BadgeExplorer, {
  type ExplorerSearchParams,
} from "@/components/badges/BadgeExplorer";
import { localeAlternates } from "@/lib/seo";

export const revalidate = 120;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "badges" });
  return {
    alternates: {
      canonical: `/${locale}/badges`,
      languages: localeAlternates("/badges"),
    }, title: t("title"), description: t("subtitle") };
}

export default async function BadgesPage({
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
      title={t("title")}
      subtitle={t("subtitle")}
      searchParams={sp}
    />
  );
}
