import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import FeedList, { type FeedEvent } from "@/components/FeedList";
import LiveRefresher from "@/components/LiveRefresher";
import { localeAlternates } from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "feed" });
  return {
    title: t("title"),
    description: t("subtitle"),
    alternates: {
      canonical: `/${locale}/feed`,
      languages: localeAlternates("/feed"),
    },
  };
}

export default async function FeedPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("feed");

  let initialEvents: FeedEvent[] = [];
  try {
    // The feed is public-read via RLS; the RLS bypass belongs to the write
    // paths only. `user_id` is dropped for the same reason as in /api/feed:
    // the UI never needs the internal id.
    const supabase = await createClient();
    const { data } = await supabase
      .from("activity_events")
      .select("id,username,avatar_url,kind,title,body,xp_amount,coins_amount,created_at")
      .order("id", { ascending: false })
      .limit(30);
    initialEvents = (data ?? []) as FeedEvent[];
  } catch {
    // empty feed is fine
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <LiveRefresher intervalMs={15000} />
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("subtitle")}</p>
      </header>
      <FeedList initialEvents={initialEvents} />
    </div>
  );
}
