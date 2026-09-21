"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/browser";

function CallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const code = searchParams.get("code");
  const [error, setError] = useState<string | null>(null);
  // Guard against double exchange: StrictMode re-runs the effect, and a second
  // exchangeCodeForSession call with the same code would fail.
  const startedRef = useRef(false);

  useEffect(() => {
    if (!code || startedRef.current) return;
    startedRef.current = true;

    const supabase = createClient();
    const exchange = async () => {
      const { error: exchangeError } =
        await supabase.auth.exchangeCodeForSession(code);
      if (exchangeError) {
        // A session may already exist despite the error (e.g. retry after a
        // network hiccup) — continue instead of showing a dead end.
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData.session) {
          // refresh() drops the cached pre-login layout so the header shows
          // the account instead of the login link until a manual reload.
          router.refresh();
          router.replace("/inventory");
          return;
        }
        setError(exchangeError.message);
        return;
      }
      router.refresh();
      router.replace("/inventory");
    };
    void exchange();
  }, [code, router]);

  const t = useTranslations("login");

  if (!code) {
    return (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="text-2xl font-bold tracking-tight">{t("failed")}</h1>
        <p className="mt-3 text-sm text-muted">{t("noCode")}</p>
        <Link href="/login" className="btn btn-primary mt-6">
          {t("retry")}
        </Link>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="text-2xl font-bold tracking-tight">{t("failed")}</h1>
        <p className="mt-3 text-sm text-muted">{error}</p>
        <Link href="/login" className="btn btn-primary mt-6">
          {t("retry")}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <div className="mx-auto size-10 animate-spin rounded-full border-2 border-line border-t-accent" />
      <h1 className="mt-6 text-2xl font-bold tracking-tight">{t("redirecting")}</h1>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-xl px-4 py-24 text-center">
          <div className="mx-auto size-10 animate-spin rounded-full border-2 border-line border-t-accent" />
        </div>
      }
    >
      <CallbackInner />
    </Suspense>
  );
}
