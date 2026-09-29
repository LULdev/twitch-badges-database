/**
 * MomentumReadout — the 24 h owner-growth chip shared by the badge detail
 * layout variants.
 *
 * Server component: everything derives from the growth24h prop, so there is
 * nothing to hydrate and zero client JS — the arrow is inline SVG and the
 * tint is a CSS class pair (.momentum-up / .momentum-down).
 *
 * The arrow glyph sits inside .dir-arrow so the existing [dir="rtl"] rule in
 * globals.css mirrors it for Arabic. That mirror is direction-preserving for
 * a trend: scaleX(-1) flips east↔west but keeps the vertical component, so
 * "up" still reads as up.
 */
export default function MomentumReadout({
  growth24h,
  locale,
  labels,
}: {
  /** Absolute active-user growth over the last ~24 h (negative = decline). */
  growth24h: number | null;
  locale: string;
  labels: { up: string; down: string; flat: string };
}) {
  // null and non-finite mean "no 24 h reading", not "zero growth".
  const growth = growth24h !== null && Number.isFinite(growth24h) ? growth24h : null;

  const direction =
    growth === null || Math.round(growth) === 0
      ? ("flat" as const)
      : growth > 0
        ? ("up" as const)
        : ("down" as const);

  const ARROW_PATH: Record<"up" | "down" | "flat", string> = {
    up: "M4 12.5 L12 4.5 M7.5 4.5 H12 V9",
    down: "M4 3.5 L12 11.5 M7.5 11.5 H12 V7",
    flat: "M3 8 H13 M9.75 4.75 L13 8 L9.75 11.25",
  };

  const value =
    growth === null
      ? "—"
      : new Intl.NumberFormat(locale, { signDisplay: "exceptZero" }).format(growth);

  const tint = direction === "up" ? "momentum-up" : direction === "down" ? "momentum-down" : "";

  return (
    <span className={tint ? `metric-chip ${tint}` : "metric-chip"}>
      <span className="dir-arrow" aria-hidden="true">
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={ARROW_PATH[direction]} />
        </svg>
      </span>
      <b>{value}</b>
      <span>{labels[direction]}</span>
    </span>
  );
}
