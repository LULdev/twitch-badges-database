"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/browser";

export default function TwitchLoginButton({
  label,
  className = "btn btn-primary px-8 py-3 text-sm font-semibold",
}: {
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const t = useTranslations("login");
  const text = label ?? t("button");

  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        const supabase = createClient();
        const { error } = await supabase.auth.signInWithOAuth({
          provider: "twitch",
          options: {
            redirectTo: `${window.location.origin}/auth/callback`,
          },
        });
        if (error) alert(error.message);
        else router.refresh();
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
      </svg>
      {text}
    </button>
  );
}
