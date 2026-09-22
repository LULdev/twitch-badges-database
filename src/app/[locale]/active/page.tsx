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
      canonical: `/${locale}/active`,
      languages: localeAlternates("/active"),
    }, title: t("activeTitle"), description: t("activeSubtitle") };
}

export default async function ActivePage({
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
      title={t("activeTitle")}
      subtitle={t("activeSubtitle")}
      statusLocked="active"
      defaultSort="ending"
      searchParams={sp}
    />
  );
}
