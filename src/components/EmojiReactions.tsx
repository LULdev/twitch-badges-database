"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

const EMOJI_OPTIONS: Array<{ key: string; nameKey: string; glyph: string }> = [
  { key: "like", nameKey: "reactions.like", glyph: "👍" },
  { key: "love", nameKey: "reactions.love", glyph: "❤️" },
  { key: "laugh", nameKey: "reactions.laugh", glyph: "😂" },
  { key: "fire", nameKey: "reactions.fire", glyph: "🔥" },
  { key: "wow", nameKey: "reactions.wow", glyph: "😮" },
];

/** Blog post emoji reactions (toggle per IP) + view counter display. */
export default function EmojiReactions({
  slug,
  initial,
  initialActive,
}: {
  slug: string;
  initial: Record<string, number>;
  /** The emojis this visitor already reacted with, resolved server-side. */
  initialActive: string[];
}) {
  const t = useTranslations("blog");
  const [counts, setCounts] = useState<Record<string, number>>(initial);
  // Seeded from the server. Starting empty made the control lie about a
  // reaction that already existed: the visitor's first click hit the route's
  // *delete* branch, the count went down, and the button lit up because it
  // believed it had just added one.
  const [active, setActive] = useState<Set<string>>(
    () => new Set(initialActive),
  );
  const [busy, setBusy] = useState(false);

  async function react(emoji: string) {
    if (busy) return;
    setBusy(true);
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
      // Follow the server's answer instead of guessing from local state: the
      // toggle is decided by the stored row, which the client cannot know.
      setActive((prev) => {
        const next = new Set(prev);
        if (data.removed) next.delete(emoji);
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
          aria-label={`${t("react")}: ${t(option.nameKey)}`}
        >
          <span aria-hidden>{option.glyph}</span>
          <span className="tabular-nums">{counts[option.key] ?? 0}</span>
        </button>
      ))}
    </div>
  );
}
