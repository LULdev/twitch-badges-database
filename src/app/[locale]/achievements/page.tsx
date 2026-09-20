import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ACHIEVEMENTS } from "@/lib/gamification/achievements";
import { createAdminClient } from "@/lib/supabase/admin";
import { authUserId } from "@/lib/gamification/session";
import { getProgress } from "@/lib/gamification/xp";
import AchievementBadge from "@/components/AchievementBadge";
import TwitchLoginButton from "@/components/TwitchLoginButton";
import { localeAlternates } from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "achievements" });
  return {
    title: t("title"),
    description: t("subtitle"),
    alternates: {
      canonical: `/${locale}/achievements`,
      languages: localeAlternates("/achievements"),
    },
  };
}

export default async function AchievementsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("achievements");
  const tc = await getTranslations("common");

  const userId = await authUserId();
  let unlocked = new Set<string>();
  let points = 0;
  if (userId) {
    const supabase = createAdminClient();
    const [{ data: rows }, progress] = await Promise.all([
      supabase.from("user_achievements").select("achievement_id").eq("user_id", userId),
      getProgress(userId).catch(() => null),
    ]);
    unlocked = new Set(
      ((rows ?? []) as Array<{ achievement_id: string }>).map((r) => r.achievement_id),
    );
    points = progress?.achievements_points ?? 0;
  }

  const categories: Array<"common" | "creative" | "special"> = ["common", "creative", "special"];

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted">{t("subtitle")}</p>
        </div>
        {userId ? (
          <div className="flex gap-3">
            <div className="card stat-tile py-3">
              <dd className="stat-value">{unlocked.size}</dd>
              <dt className="stat-label">{t("unlocked")}</dt>
            </div>
            <div className="card stat-tile py-3">
              <dd className="stat-value">{points.toLocaleString("en")}</dd>
              <dt className="stat-label">{t("points")}</dt>
            </div>
          </div>
        ) : null}
      </header>

      {!userId && (
        <div className="card flex flex-col items-center gap-3 p-6 text-center">
          <p className="text-sm text-muted">{t("loginHint")}</p>
          <TwitchLoginButton />
        </div>
      )}

      {categories.map((category) => {
        const list = ACHIEVEMENTS.filter((a) => a.category === category);
        const unlockedCount = list.filter((a) => unlocked.has(a.id)).length;
        return (
          <section key={category} className="space-y-3">
            <div className="section-title">
              <h2>
                {t(category)}{" "}
                <span className="text-sm font-normal text-muted">
                  ({unlockedCount}/{list.length})
                </span>
              </h2>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((achievement) => {
                const isUnlocked = unlocked.has(achievement.id);
                return (
                  <div
                    key={achievement.id}
                    className={`card flex items-center gap-3 p-4 ${isUnlocked ? "" : "opacity-60"}`}
                  >
                    {isUnlocked ? (
                      <AchievementBadge title={achievement.title} category={category} size={44} />
                    ) : (
                      <span className="grid size-11 shrink-0 place-items-center rounded-full border-2 border-dashed border-line text-muted">
                        ?
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">{achievement.title}</p>
                      <p className="line-clamp-2 text-xs text-muted">{achievement.description}</p>
                      <p className="mt-1 text-[0.625rem] font-bold text-accent">
                        +{achievement.xp} XP · +{achievement.coins} 🪙 · {achievement.points} {t("points")}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
