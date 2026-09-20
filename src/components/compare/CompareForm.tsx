"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export default function CompareForm({
  initialA = "",
  initialB = "",
}: {
  initialA?: string;
  initialB?: string;
}) {
  const t = useTranslations("compare");
  const router = useRouter();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const a = String(data.get("a") ?? "").trim().toLowerCase();
    const b = String(data.get("b") ?? "").trim().toLowerCase();
    if (!a || !b) return;
    router.push(`?users=${encodeURIComponent(a)},${encodeURIComponent(b)}`);
  }

  return (
    <form onSubmit={onSubmit} className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
      <label className="flex-1">
        <span className="mb-1.5 block text-xs font-semibold text-muted">{t("userA")}</span>
        <input name="a" defaultValue={initialA} required minLength={3} maxLength={25}
          pattern="[A-Za-z0-9_]+" className="input" placeholder="ninja" />
      </label>
      <span className="hidden pb-2.5 text-sm font-bold text-muted sm:inline" aria-hidden>vs</span>
      <label className="flex-1">
        <span className="mb-1.5 block text-xs font-semibold text-muted">{t("userB")}</span>
        <input name="b" defaultValue={initialB} required minLength={3} maxLength={25}
          pattern="[A-Za-z0-9_]+" className="input" placeholder="xqc" />
      </label>
      <button type="submit" className="btn btn-primary sm:mb-px">
        {t("compare")}
      </button>
    </form>
  );
}
