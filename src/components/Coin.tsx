/**
 * BadgesCoin — the site's premium animated currency token.
 *
 * A 3D gold coin with rotating shine sweep, pulsing glow, embossed "B" and
 * twin sparkles. All animation lives in globals.css (.bcoin) and respects
 * prefers-reduced-motion. Size scales via the `size` prop (pixels).
 */
export default function Coin({
  size = 16,
  className = "",
  title,
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  return (
    <span
      className={`bcoin ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.52 } as React.CSSProperties}
      role="img"
      aria-label={title ?? "BadgesCoin"}
      title={title ?? "BadgesCoin"}
    >
      <span className="bcoin-face">B</span>
      <span className="bcoin-shine" aria-hidden />
      <span className="bcoin-sparkle sparkle-a" aria-hidden />
      <span className="bcoin-sparkle sparkle-b" aria-hidden />
    </span>
  );
}
