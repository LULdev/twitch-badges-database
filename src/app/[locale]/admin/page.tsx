import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import AdminGate from "@/components/admin/AdminGate";
import AdminShell from "@/components/admin/AdminShell";
import { bootstrapAvailable, isBootstrapSession, requireAdmin, viewerRole } from "@/lib/admin";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin" });
  return {
    title: t("title"),
    // The control panel is never indexed — in any state.
    robots: { index: false, follow: false },
  };
}

export default async function AdminPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "admin" });

  const role = await viewerRole();
  const open = await bootstrapAvailable();

  let body: React.ReactNode;
  if (role) {
    // The shell needs the display name for its "signed in as" line; requireAdmin
    // is the same gate the API routes use, so the name comes from one place.
    const ctx = await requireAdmin();
    body = <AdminShell role={ctx.role} actor={ctx.actor} locale={locale} />;
  } else if (open) {
    body = <AdminGate stage={(await isBootstrapSession()) ? "setup" : "passcode"} />;
  } else {
    body = (
      <div className="card p-6">
        <h1 className="text-lg font-bold">{t("forbidden.title")}</h1>
        <p className="mt-2 text-sm text-muted">{t("forbidden.body")}</p>
      </div>
    );
  }

  return <div className={role ? "mx-auto max-w-6xl" : "mx-auto max-w-2xl"}>{body}</div>;
}