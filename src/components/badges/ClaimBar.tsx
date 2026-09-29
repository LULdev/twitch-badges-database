import type { CSSProperties } from "react";

type ClaimState = "open" | "closed" | "upcoming" | "no-end";

/**
 * ClaimBar — the claim-window progress rail shared by the badge detail
 * layout variants.
 *
 * Server component BY DESIGN: the elapsed fraction is computed once per
 * request with Date.now(). That is safe here precisely because there is no
 * client counterpart — nothing hydrates against this markup, so there is no
 * server/client drift to reconcile. (Countdown is the opposite case: it is a
 * client component and renders "—" until its first rAF tick for exactly that
 * reason.) Pages that mount <LiveRefresher /> keep the reading fresh by
 * re-rendering the route.
 *
 * The fill composes the existing .grow-bar-fill class, so the scaleX intro,
 * the sheen sweep and both [dir="rtl"] corrections come from globals.css for
 * free. .claim-elapsed only adds the overflow clip that .grow-bar-track used
 * to perform — on the fill so the .live-dot ping on .claim-now is never cut.
 */
export default function ClaimBar({
  start,
  end,
  releasedAt,
  locale,
  labels,
}: {
  /** ISO timestamp of the claim window start, null when unrecorded. */
  start: string | null;
  /** ISO timestamp of the claim window end, null when open-ended. */
  end: string | null;
  /** ISO release timestamp — the fallback start anchor. */
  releasedAt: string | null;
  locale: string;
  labels: {
    elapsed: string;
    open: string;
    closed: string;
    upcoming: string;
    noEnd: string;
  };
}) {
  // One clock reading per render. Server-side only — see the doc comment.
  // eslint-disable-next-line react-hooks/purity -- server component, no hydration twin
  const nowMs = Date.now();

  // releasedAt is only a fallback: a recorded claim start wins.
  const from = start ?? releasedAt;
  const fromMs = from !== null ? Date.parse(from) : Number.NaN;
  const endMs = end !== null ? Date.parse(end) : Number.NaN;
  const hasFrom = Number.isFinite(fromMs);
  const hasEnd = Number.isFinite(endMs);
  if (!hasFrom && !hasEnd) return null;

  let state: ClaimState;
  if (hasFrom && fromMs > nowMs) {
    state = "upcoming";
  } else if (hasEnd && endMs <= nowMs) {
    state = "closed";
  } else if (!hasEnd) {
    state = "no-end";
  } else {
    state = "open";
  }

  let pct = 0;
  if (state === "closed" || state === "no-end") {
    pct = 100;
  } else if (state === "open" && hasFrom && endMs > fromMs) {
    pct = Math.min(100, Math.max(0, ((nowMs - fromMs) / (endMs - fromMs)) * 100));
  }

  const pctText = String(Math.round(pct * 10) / 10);
  const barColor =
    state === "open" ? "var(--success)" : state === "closed" ? "var(--danger)" : "var(--accent)";

  const chip =
    state === "open"
      ? { className: "chip chip-live pointer-events-none", label: labels.open }
      : state === "closed"
        ? { className: "chip pointer-events-none border-danger/40 text-danger", label: labels.closed }
        : state === "upcoming"
          ? { className: "chip pointer-events-none border-accent/40 text-accent", label: labels.upcoming }
          : { className: "chip pointer-events-none", label: labels.noEnd };

  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const startCaption = hasFrom ? dateFmt.format(fromMs) : "—";
  const endCaption = hasEnd ? dateFmt.format(endMs) : "—";

  const percentText = new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(pct / 100);

  const valueText = state === "open" ? `${labels.open} · ${percentText}` : chip.label;

  return (
    <div className="claim-bar">
      <div
        className="claim-track"
        role="progressbar"
        aria-label={labels.elapsed}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-valuetext={valueText}
      >
        <div
          className="claim-elapsed grow-bar-fill"
          style={{ width: `${pctText}%`, "--bar-color": barColor } as CSSProperties}
        />
        {state === "open" && (
          <span className="claim-now" style={{ insetInlineStart: `${pctText}%` }}>
            <span className="live-dot" aria-hidden="true" />
          </span>
        )}
      </div>
      <div className="claim-captions">
        <span className="claim-caption font-mono">{startCaption}</span>
        <span className={chip.className}>{chip.label}</span>
        <span className="claim-caption claim-caption-end font-mono">{endCaption}</span>
      </div>
    </div>
  );
}
