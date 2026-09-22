"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

const EMOJI_OPTIONS: Array<{ key: string; glyph: string }> = [
  { key: "like", glyph: "👍" },
  { key: "love", glyph: "❤️" },
  { key: "laugh", glyph: "😂" },
  { key: "fire", glyph: "🔥" },
  { key: "wow", glyph: "😮" },
];

/** Blog post emoji reactions (toggle per IP) + view counter display. */
export default function EmojiReactions({
  slug,
  initial,
}: {
  slug: string;
  initial: Record<string, number>;
}) {
  const t = useTranslations("blog");
  const [counts, setCounts] = useState<Record<string, number>>(initial);
  const [active, setActive] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  async function react(emoji: string) {
    if (busy) return;
    setBusy(true);
    const wasActive = active.has(emoji);
    try {
      const res = await fetch("/api/blog/react", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, emoji }),
      });
      // A failed request returns an error body, which used to be treated as a
      // removal: the count dropped by one and the button flipped state even
      // though nothing changed server-side.
      if (!res.ok) return;
      const data = (await res.json()) as { added?: boolean; removed?: boolean };
      if (!data.added && !data.removed) return;
      setCounts((prev) => ({
        ...prev,
        [emoji]: Math.max(0, (prev[emoji] ?? 0) + (data.added ? 1 : -1)),
      }));
      setActive((prev) => {
        const next = new Set(prev);
        if (wasActive) next.delete(emoji);
        else next.add(emoji);
        return next;
      });
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {EMOJI_OPTIONS.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => react(option.key)}
          className={`chip ${active.has(option.key) ? "chip-active" : ""}`}
          aria-label={`${t("react")}: ${option.key}`}
        >
          <span aria-hidden>{option.glyph}</span>
          <span className="tabular-nums">{counts[option.key] ?? 0}</span>
        </button>
      ))}
    </div>
  );
}
