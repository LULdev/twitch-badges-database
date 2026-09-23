"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

export default function ShareButtons({ path, title }: { path: string; title: string }) {
  const t = useTranslations("common");
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cancel the pending state update on unmount: React 18 no longer warns about
  // setting state on an unmounted component, so nothing surfaced this.
  useEffect(
    () => () => {
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    },
    [],
  );
  // Computed after mount: deriving it during render produced "" on the server
  // and the real URL on the client, which is a hydration mismatch on every
  // share link's href.
  const [shareUrl, setShareUrl] = useState("");

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setShareUrl(new URL(path, window.location.origin).toString());
    });
    return () => cancelAnimationFrame(frame);
  }, [path]);

  async function copy() {
    const url =
      typeof window === "undefined"
        ? path
        : new URL(path, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const area = document.createElement("textarea");
      area.value = url;
      document.body.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 2500);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button type="button" onClick={copy} className="btn btn-secondary text-xs">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
        {copied ? t("copied") : t("copyLink")}
      </button>
      <a
        href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(shareUrl)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="btn btn-secondary text-xs"
        onClick={(event) => {
          if (!shareUrl) event.preventDefault();
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
        X
      </a>
    </div>
  );
}
