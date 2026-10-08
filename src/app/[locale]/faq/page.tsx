import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { localeAlternates } from "@/lib/seo";
import { jsonLdScript } from "@/lib/jsonld";
import { ACTIVE_ACHIEVEMENTS } from "@/lib/gamification/achievements";
import { getEconomy } from "@/lib/settings";

const FAQ_KEYS = [
  "what",
  "xp",
  "levels",
  "coins",
  "daily",
  "wheel",
  "turbo",
  "jackpot",
  "badges",
  "games",
  "pingu",
  "fair",
  "streakFreeze",
  "achievements",
  "steal",
  "stealCost",
  "feed",
  "profile",
  "visitors",
  "rain",
  "blog",
  "free",
  "data",
];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "faq" });
  return {
    title: t("title"),
    description: t("subtitle"),
    alternates: {
      canonical: `/${locale}/faq`,
      languages: localeAlternates("/faq"),
    },
  };
}

export default async function FaqPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("faq");

  // The achievement counts are templated so the copy cannot drift from the
  // catalog (it claimed 125 after two entries were retired). Answers are looked
  // up through a dynamic key list, so the values have to be supplied per key
  // here instead of at one call site. The jackpot answer follows the same
  // doctrine: the rates and odds are admin-tunable economy settings, so they
  // are read live instead of hardcoded (unlike the wheel's fixed 1:1e8).
  const achievementCounts = {
    total: ACTIVE_ACHIEVEMENTS.length,
    common: ACTIVE_ACHIEVEMENTS.filter((a) => a.category === "common").length,
    creative: ACTIVE_ACHIEVEMENTS.filter((a) => a.category === "creative").length,
    special: ACTIVE_ACHIEVEMENTS.filter((a) => a.category === "special").length,
  };
  const economy = await getEconomy();
  const jackpotValues = {
    gameRate: economy.jackpotGameRate,
    megaRate: economy.jackpotMegaRate,
    gameOdds: economy.jackpotGameOdds.toLocaleString(locale),
    megaOdds: economy.jackpotMegaOdds.toLocaleString(locale),
  };
  const answerFor = (key: string) =>
    key === "achievements"
      ? t(`${key}A`, achievementCounts)
      : key === "jackpot"
        ? t(`${key}A`, jackpotValues)
        : t(`${key}A`);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ_KEYS.map((key) => ({
      "@type": "Question",
      name: t(`${key}Q`),
      acceptedAnswer: { "@type": "Answer", text: answerFor(key) },
    })),
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }}
      />
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("subtitle")}</p>
      </header>

      <div className="space-y-2">
        {FAQ_KEYS.map((key) => (
          <details key={key} className="card group p-0">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm font-bold [&::-webkit-details-marker]:hidden">
              {t(`${key}Q`)}
              <span
                aria-hidden
                className="text-muted transition-transform duration-200 group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <p className="px-5 pb-4 text-sm leading-relaxed text-muted">{answerFor(key)}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
