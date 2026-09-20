import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import TwitchLoginButton from "@/components/TwitchLoginButton";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "login" });
  return { title: t("title") };
}

export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect({ href: "/inventory", locale });

  const t = await getTranslations("login");

  return (
    <div className="mx-auto max-w-xl py-12 text-center">
      <div
        aria-hidden
        className="mx-auto grid size-16 place-items-center rounded-2xl border border-line bg-surface shadow-card"
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="var(--accent)">
          <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
        </svg>
      </div>
      <h1 className="mt-6 text-2xl font-extrabold tracking-tight">{t("title")}</h1>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted">
        {t("subtitle")}
      </p>
      <div className="mt-8">
        <TwitchLoginButton />
      </div>
    </div>
  );
}
