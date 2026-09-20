import type { BadgeRow } from "@/lib/queries";

export interface BadgeImageSource {
  title: string;
  image_url_1x?: string | null;
  image_url_2x?: string | null;
  image_url_4x?: string | null;
}

export function BadgeImage({
  badge,
  size = 56,
  className = "",
}: {
  badge: BadgeImageSource | BadgeRow;
  size?: number;
  className?: string;
}) {
  const src =
    badge.image_url_4x ?? badge.image_url_2x ?? badge.image_url_1x ?? null;
  if (!src) {
    return (
      <span
        aria-hidden
        className={`grid place-items-center rounded-lg border border-dashed border-line-strong text-muted ${className}`}
        style={{ width: size, height: size }}
      >
        <svg width={size * 0.4} height={size * 0.4} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="8" r="6" />
          <path d="M15.5 13 17 22l-5-3-5 3 1.5-9" />
        </svg>
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={badge.title}
      width={size}
      height={size}
      loading="lazy"
      className={className}
      style={{ imageRendering: "auto" }}
    />
  );
}
