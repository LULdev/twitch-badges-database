"use client";

import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import CountUp from "@/components/stats/CountUp";
import { useChartTheme } from "@/components/stats/useChartTheme";

export type RadarAxisKey =
  | "scarcity"
  | "wear"
  | "obtainability"
  | "age"
  | "momentum"
  | "brevity";

export type RarityRadarComponents = {
  [axis in RadarAxisKey]: number; // 0..1
};

export type RarityRadarLabels = { title: string } & {
  [axis in RadarAxisKey]: string;
};

/*
 * Reduced-motion flag. First read rides a requestAnimationFrame (the React
 * Compiler lint rules forbid a synchronous setState in an effect body — same
 * pattern as useChartTheme), the change listener keeps it live. Server and
 * first client frame render with `false`, so hydration always matches.
 */
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

const SIZE = 240;
const CENTER = SIZE / 2;
const RADIUS = 86;
const LABEL_RADIUS = RADIUS + 14;

/** Hexagon vertices: scarcity on top, then clockwise. Screen y grows down. */
const AXES: ReadonlyArray<{
  key: RadarAxisKey;
  angle: number;
  anchor: "start" | "middle" | "end";
  dx: number;
  dy: number;
}> = [
  { key: "scarcity", angle: -90, anchor: "middle", dx: 0, dy: -3 },
  { key: "wear", angle: -30, anchor: "start", dx: 5, dy: 3 },
  { key: "obtainability", angle: 30, anchor: "start", dx: 5, dy: 8 },
  { key: "age", angle: 90, anchor: "middle", dx: 0, dy: 11 },
  { key: "momentum", angle: 150, anchor: "end", dx: -5, dy: 8 },
  { key: "brevity", angle: 210, anchor: "end", dx: -5, dy: 3 },
];

const HEX_ANGLES = AXES.map((axis) => axis.angle);

function axisPoint(angleDeg: number, radius: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CENTER + radius * Math.cos(rad), y: CENTER + radius * Math.sin(rad) };
}

function hexPoints(radius: number): string {
  return HEX_ANGLES.map((angle) => {
    const point = axisPoint(angle, radius);
    return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
  }).join(" ");
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/**
 * Hexagon rarity radar for the badge detail page. Six TBRI component axes,
 * three grid rings, tier-colored data polygon with an intro scale-in
 * (.radar-in in globals.css; suppressed under reduced motion) and the
 * overall score counting up in the center.
 */
export default function RarityRadar({
  components,
  score,
  tierColor,
  labels,
}: {
  components: RarityRadarComponents;
  score: number;
  tierColor: string;
  labels: RarityRadarLabels;
}) {
  const theme = useChartTheme();
  const locale = useLocale();
  const reducedMotion = useReducedMotion();

  const dataPoints = AXES.map((axis) => axisPoint(axis.angle, RADIUS * clamp01(components[axis.key])));
  const dataPolygon = dataPoints.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");

  return (
    <div className="chart-card">
      <div className="chart-head">
        <div>
          <div className="chart-title">{labels.title}</div>
        </div>
      </div>
      <div className="relative mx-auto w-full" style={{ maxWidth: 300 }}>
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          width="100%"
          style={{ maxHeight: 260, display: "block" }}
          role="img"
          aria-label={labels.title}
        >
          {[RADIUS / 3, (2 * RADIUS) / 3, RADIUS].map((ring) => (
            <polygon key={ring} points={hexPoints(ring)} fill="none" stroke={theme.line} strokeWidth={1} />
          ))}
          {AXES.map((axis) => {
            const point = axisPoint(axis.angle, RADIUS);
            return (
              <line
                key={axis.key}
                x1={CENTER}
                y1={CENTER}
                x2={point.x}
                y2={point.y}
                stroke={theme.line}
                strokeWidth={1}
                opacity={0.5}
              />
            );
          })}
          <g className={reducedMotion ? undefined : "radar-in"}>
            <polygon
              points={dataPolygon}
              fill={tierColor}
              fillOpacity={0.18}
              stroke={tierColor}
              strokeWidth={2}
              strokeLinejoin="round"
            />
            {dataPoints.map((point, index) => (
              <circle key={AXES[index].key} cx={point.x} cy={point.y} r={3} fill={tierColor} />
            ))}
          </g>
          {AXES.map((axis) => {
            const point = axisPoint(axis.angle, LABEL_RADIUS);
            return (
              <text
                key={axis.key}
                x={point.x + axis.dx}
                y={point.y + axis.dy}
                textAnchor={axis.anchor}
                fill={theme.muted}
                fontSize={9}
                style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}
              >
                {labels[axis.key]}
              </text>
            );
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
          <CountUp value={score} locale={locale} className="gauge-value" />
        </div>
      </div>
    </div>
  );
}
