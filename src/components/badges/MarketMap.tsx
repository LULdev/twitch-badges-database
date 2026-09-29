"use client";

import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import { useChartTheme } from "@/components/stats/useChartTheme";

export interface MarketMapPeer {
  slug: string;
  title: string;
  owners: number | null;
  score: number;
  share: number | null;
}

export interface MarketMapSelf {
  owners: number | null;
  score: number;
  share: number | null;
}

export interface MarketMapLabels {
  title: string;
  subtitle: string;
  x: string;
  y: string;
  you: string;
  quad1: string;
  quad2: string;
  quad3: string;
  quad4: string;
}

/* Same rAF-guarded flag as RarityRadar — see the note there. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(query.matches);
    const frame = requestAnimationFrame(apply);
    query.addEventListener("change", apply);
    return () => {
      cancelAnimationFrame(frame);
      query.removeEventListener("change", apply);
    };
  }, []);
  return reduced;
}

const WIDTH = 480;
const HEIGHT = 280;
const MARGIN = { top: 16, right: 18, bottom: 36, left: 48 };
const PLOT_W = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom;

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

interface Projected {
  x: number;
  y: number;
  r: number;
}

/** owners → log10(owners+1) normalized to [0,1]; score/100 → y. */
function project(
  owners: number,
  score: number,
  share: number | null,
  minLog: number,
  maxLog: number,
): Projected {
  const log = Math.log10(Math.max(0, owners) + 1);
  const norm = maxLog > minLog ? (log - minLog) / (maxLog - minLog) : 0.5;
  return {
    x: MARGIN.left + clamp01(norm) * PLOT_W,
    y: MARGIN.top + (1 - clamp01(score / 100)) * PLOT_H,
    r: 3 + 6 * clamp01(share ?? 0.15),
  };
}

/**
 * Scatter "market map": this badge (tier-colored, pulsing ring via the
 * existing stats-ping keyframe) against peer badges by owner count (log x)
 * and TBRI score (y), split into quadrants by the owner median and the score
 * midpoint. Peers are clickable links (pathBuilder prepends the locale — no
 * i18n import here). The SVG is aria-hidden; a visually-hidden table
 * restates the top 8 peers as real links for assistive tech.
 */
export default function MarketMap({
  self,
  peers,
  pathBuilder,
  labels,
  selfColor,
}: {
  self: MarketMapSelf;
  peers: MarketMapPeer[];
  /**
   * Optional href builder for peer links. The page rendering this component is
   * a SERVER component, and function props cannot cross the server→client
   * boundary — so the default builds the path from the component's own locale:
   * `/${locale}/badges/${slug}` (localePrefix is "always").
   */
  pathBuilder?: (slug: string) => string;
  labels: MarketMapLabels;
  selfColor?: string;
}) {
  const theme = useChartTheme();
  const locale = useLocale();
  const reducedMotion = useReducedMotion();
  const accent = selfColor ?? theme.accent;
  const buildPath = pathBuilder ?? ((slug: string) => `/${locale}/badges/${slug}`);

  const fmt = (value: number) => new Intl.NumberFormat(locale).format(value);

  const plottedPeers = peers.filter(
    (peer): peer is MarketMapPeer & { owners: number } => peer.owners !== null,
  );
  const selfOwners = self.owners;

  const logs: number[] = [];
  if (selfOwners !== null) logs.push(Math.log10(selfOwners + 1));
  for (const peer of plottedPeers) logs.push(Math.log10(peer.owners + 1));
  const minLog = logs.length > 0 ? Math.min(...logs) : 0;
  const maxLog = logs.length > 0 ? Math.max(...logs) : 1;

  const norms: number[] = [];
  if (selfOwners !== null) {
    norms.push(maxLog > minLog ? (Math.log10(selfOwners + 1) - minLog) / (maxLog - minLog) : 0.5);
  }
  for (const peer of plottedPeers) {
    norms.push(maxLog > minLog ? (Math.log10(peer.owners + 1) - minLog) / (maxLog - minLog) : 0.5);
  }
  const sorted = [...norms].sort((a, b) => a - b);
  const medianNorm =
    sorted.length === 0
      ? 0.5
      : sorted.length % 2 === 1
        ? sorted[(sorted.length - 1) / 2]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const medianX = MARGIN.left + clamp01(medianNorm) * PLOT_W;
  const midY = MARGIN.top + PLOT_H / 2;

  const selfDot = selfOwners !== null ? project(selfOwners, self.score, self.share, minLog, maxLog) : null;

  const topPeers = [...plottedPeers].sort((a, b) => b.owners - a.owners).slice(0, 8);

  return (
    <div className="chart-card">
      <div className="chart-head">
        <div>
          <div className="chart-title">{labels.title}</div>
          <div className="chart-sub">{labels.subtitle}</div>
        </div>
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" style={{ display: "block" }} aria-hidden="true">
        <rect
          x={MARGIN.left}
          y={MARGIN.top}
          width={PLOT_W}
          height={PLOT_H}
          fill="none"
          stroke={theme.line}
          strokeWidth={1}
        />
        <line
          x1={medianX}
          y1={MARGIN.top}
          x2={medianX}
          y2={MARGIN.top + PLOT_H}
          stroke={theme.line}
          strokeWidth={1}
          strokeDasharray="4 4"
        />
        <line
          x1={MARGIN.left}
          y1={midY}
          x2={MARGIN.left + PLOT_W}
          y2={midY}
          stroke={theme.line}
          strokeWidth={1}
          strokeDasharray="4 4"
        />
        <g fill={theme.muted} fontSize={9}>
          <text x={MARGIN.left + 6} y={MARGIN.top + 12}>{labels.quad1}</text>
          <text x={MARGIN.left + PLOT_W - 6} y={MARGIN.top + 12} textAnchor="end">{labels.quad2}</text>
          <text x={MARGIN.left + 6} y={MARGIN.top + PLOT_H - 6}>{labels.quad3}</text>
          <text x={MARGIN.left + PLOT_W - 6} y={MARGIN.top + PLOT_H - 6} textAnchor="end">{labels.quad4}</text>
        </g>
        <text x={MARGIN.left + PLOT_W / 2} y={HEIGHT - 8} textAnchor="middle" fill={theme.muted} fontSize={9}>
          {labels.x}
        </text>
        <text
          x={14}
          y={MARGIN.top + PLOT_H / 2}
          textAnchor="middle"
          fill={theme.muted}
          fontSize={9}
          transform={`rotate(-90 14 ${MARGIN.top + PLOT_H / 2})`}
        >
          {labels.y}
        </text>
        {plottedPeers.map((peer) => {
          const dot = project(peer.owners, peer.score, peer.share, minLog, maxLog);
          return (
            <a key={peer.slug} href={buildPath(peer.slug)} tabIndex={-1} style={{ cursor: "pointer" }}>
              <circle
                cx={dot.x}
                cy={dot.y}
                r={dot.r}
                strokeWidth={1}
                stroke={theme.line}
                style={{ fill: "var(--surface-3, #1e1e28)" }}
              >
                <title>{`${peer.title} — ${fmt(peer.owners)} · ${fmt(peer.score)}/100`}</title>
              </circle>
            </a>
          );
        })}
        {selfDot !== null && selfOwners !== null ? (
          <g>
            {!reducedMotion ? (
              <circle
                className="map-self-ping"
                cx={selfDot.x}
                cy={selfDot.y}
                r={selfDot.r + 2}
                fill="none"
                stroke={accent}
                strokeWidth={2}
              />
            ) : null}
            <circle cx={selfDot.x} cy={selfDot.y} r={selfDot.r + 2.5} fill={accent} stroke={theme.foreground} strokeWidth={1.5}>
              <title>{`${labels.you} — ${fmt(selfOwners)} · ${fmt(self.score)}/100`}</title>
            </circle>
          </g>
        ) : null}
      </svg>
      <table className="sr-only">
        <caption>{`${labels.title} — ${labels.subtitle}`}</caption>
        <thead>
          <tr>
            <th scope="col" aria-hidden="true" />
            <th scope="col">{labels.x}</th>
            <th scope="col">{labels.y}</th>
          </tr>
        </thead>
        <tbody>
          {topPeers.map((peer) => (
            <tr key={peer.slug}>
              <th scope="row">
                <a href={buildPath(peer.slug)}>{peer.title}</a>
              </th>
              <td>{fmt(peer.owners)}</td>
              <td>{fmt(peer.score)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
