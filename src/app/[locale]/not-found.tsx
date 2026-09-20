import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export default function NotFound() {
  const t = useTranslations("common");

  return (
    <div className="mx-auto max-w-xl py-24 text-center">
      <p className="text-6xl font-extrabold tracking-tight text-accent">404</p>
      <h1 className="mt-4 text-2xl font-bold tracking-tight">{t("notFound")}</h1>
      <Link href="/" className="btn btn-primary mt-8">
        {t("backHome")}
      </Link>
    </div>
  );
}
