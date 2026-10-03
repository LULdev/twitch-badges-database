/**
 * BadgesCoin — the site's premium animated currency token.
 *
 * Default look is variant "a" (Mint) — the owner's pick from the premium
 * round (owner decision 2026-10-02): a rotating milled conic edge around an
 * inner radial gold sphere. Variant "b" (Jewel) is the ceremonial coin for
 * the wheel's big-win moment; "c" (Proof) stays wired in CSS for future
 * reuse. All styling and animation lives in globals.css (.bcoin*) and
 * respects prefers-reduced-motion. Size scales via the `size` prop.
 */
export type CoinVariant = "current" | "a" | "b" | "c";

export default function Coin({
  size = 16,
  className = "",
  title,
  variant,
}: {
  size?: number;
  className?: string;
  title?: string;
  variant?: CoinVariant;
}) {
  const v = variant ?? "a";
  return (
    <span
      className={`bcoin ${v === "current" ? "" : `bcoin-${v}`} ${className}`}
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
