import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import WheelOfFortune from "@/components/WheelOfFortune";
import GameIcon from "@/components/GameIcon";
import { getJackpots } from "@/lib/queries";
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

  // Mega Jackpot pot (0069): the daily spin rolls it, so the page shows the
  // live amount next to the Turbo odds — plus the last hit for the record
  // line. An unreachable table hides both.
  const jackpots = await getJackpots();
  const mega = jackpots.find((j) => j.kind === "mega") ?? null;
  const megaPot = mega?.pot ?? null;
  const megaLast =
    mega?.last_winner && mega.last_won_at
      ? {
          winner: mega.last_winner,
          amount: mega.last_win_amount ?? 0,
          at: mega.last_won_at,
        }
      : null;

  return (
    <div className="mx-auto max-w-2xl space-y-8 py-6">
      <header className="text-center">
        <h1 className="flex items-center justify-center gap-2 text-3xl font-extrabold tracking-tight">
          <GameIcon id="wheel" size={26} className="text-accent" />
          {t("title")}
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted">{t("subtitle")}</p>
      </header>
      <WheelOfFortune megaPot={megaPot} megaLast={megaLast} />
    </div>
  );
}
