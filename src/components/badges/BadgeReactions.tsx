"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

const REACTION_OPTIONS: Array<{ key: string; file: string }> = [
  { key: "like", file: "like.gif" },
  { key: "love", file: "love.gif" },
  { key: "fire", file: "fire.gif" },
  { key: "poop", file: "poop.gif" },
  { key: "sad", file: "sad.gif" },
  { key: "dislike", file: "dislike.gif" },
];

/** Badge hero GIF reactions (toggle per IP) — the blog's EmojiReactions with
 *  the uploaded sticker GIFs instead of emoji glyphs. */
export default function BadgeReactions({
  slug,
  initial,
  initialActive,
}: {
  slug: string;
  initial: Record<string, number>;
  /** The reactions this visitor already used, resolved server-side. */
  initialActive: string[];
}) {
  const t = useTranslations("badges");
  const [counts, setCounts] = useState<Record<string, number>>(initial);
  // Seeded from the server: an empty start made the first click hit the
  // route's delete branch — the count dropped and the button still lit up.
  const [active, setActive] = useState<Set<string>>(() => new Set(initialActive));
  const [busy, setBusy] = useState(false);

  async function react(reaction: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/badges/react", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, reaction }),
      });
      // An error body is not a removal: never move the count on !res.ok.
      if (!res.ok) return;
      const data = (await res.json()) as { added?: boolean; removed?: boolean };
      if (!data.added && !data.removed) return;
      setCounts((prev) => ({
        ...prev,
        [reaction]: Math.max(0, (prev[reaction] ?? 0) + (data.added ? 1 : -1)),
      }));
      // Follow the server's answer — the stored row decides the toggle, and
      // the client cannot know it.
      setActive((prev) => {
        const next = new Set(prev);
        if (data.removed) next.delete(reaction);
        else next.add(reaction);
        return next;
      });
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="badge-reactions" role="group" aria-label={t("react")}>
      {REACTION_OPTIONS.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => react(option.key)}
          className={`badge-reaction ${active.has(option.key) ? "badge-reaction-active" : ""}`}
          aria-pressed={active.has(option.key)}
          aria-label={`${t("react")}: ${t(`reactions.${option.key}`)}`}
        >
          {/* The GIFs are square stickers on black; the circular crop is the
              chip look. ~4 MB across six files, so they stay lazy. Raw <img>:
              the image optimizer would re-encode away the animation. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/reactions/${option.file}`}
            alt=""
            width={40}
            height={40}
            loading="lazy"
            decoding="async"
            draggable={false}
          />
          <span className="badge-reaction-count tabular-nums">
            {counts[option.key] ?? 0}
          </span>
        </button>
      ))}
    </div>
  );
}
