import { getTranslations, setRequestLocale } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getInventory } from "@/lib/queries";
import AccountSettings from "@/components/account/AccountSettings";
import ProfileCustomizer from "@/components/account/ProfileCustomizer";
import PushToggle from "@/components/PushToggle";
import TwitchLoginButton from "@/components/TwitchLoginButton";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "account" });
  return { title: t("title"), robots: { index: false } };
}

export default async function AccountPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("account");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <h1 className="text-2xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="mt-3 text-sm text-muted">{t("loginRequired")}</p>
        <div className="mt-8">
          <TwitchLoginButton />
        </div>
      </div>
    );
  }

  const [{ data: profile }, inventory] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "username, display_name, bio, banner_url, color, inventory_public, showcase_slots, customization, mood, steal_enabled, steal_price, steal_max",
      )
      .eq("id", user.id)
      .maybeSingle(),
    getInventory(user.id).catch(() => []),
  ]);

  const ownedBadges = inventory
    .map((item) => item.badge)
    .filter(Boolean)
    .map((badge) => ({
      slug: badge!.slug,
      title: badge!.title,
      image_url_1x: badge!.image_url_1x,
      image_url_2x: badge!.image_url_2x,
      image_url_4x: badge!.image_url_4x,
    }));

  const slots = profile?.showcase_slots;

  const steal = {
    enabled: (profile?.steal_enabled as boolean | null) ?? true,
    price: (profile?.steal_price as number | null) ?? 100,
    max: (profile?.steal_max as number | null) ?? 250,
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("subtitle")}</p>
      </header>

      <AccountSettings
        profile={{
          displayName: (profile?.display_name as string | null) ?? null,
          bio: (profile?.bio as string | null) ?? null,
          bannerUrl: (profile?.banner_url as string | null) ?? null,
          color: (profile?.color as string | null) ?? null,
          inventoryPublic: (profile?.inventory_public as boolean | null) ?? true,
          showcaseSlots: Array.isArray(slots) ? (slots as string[]) : [],
        }}
        ownedBadges={ownedBadges}
      />

      <ProfileCustomizer
        initial={((profile?.customization as Record<string, unknown> | null) ?? {})}
        initialMood={(profile?.mood as string | null) ?? ""}
        steal={steal}
      />

      <section className="card space-y-3 p-6">
        <h2 className="text-sm font-bold uppercase tracking-[0.08em] text-muted">
          {t("notificationsSection")}
        </h2>
        <PushToggle />
      </section>
    </div>
  );
}
