"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/browser";

export default function TwitchLoginButton({
  label,
  className = "btn btn-primary px-8 py-3 text-sm font-semibold",
}: {
  label?: string;
  className?: string;
}) {
  const t = useTranslations("login");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const text = label ?? t("button");

  async function startLogin() {
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      const supabase = createClient();
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "twitch",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (oauthError) {
        // On success the browser navigates to Twitch and this component
        // unloads — reaching this point means the flow failed visibly.
        setError(oauthError.message);
        setPending(false);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setPending(false);
    }
  }

  return (
    <div className="inline-flex flex-col items-center gap-3">
      <button
        type="button"
        className={className}
        onClick={() => void startLogin()}
        disabled={pending}
        aria-busy={pending}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
        </svg>
        {pending ? t("redirecting") : text}
      </button>
      {error ? (
        <p className="max-w-sm text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
