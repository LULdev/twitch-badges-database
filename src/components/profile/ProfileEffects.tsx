"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Client-side pieces of the profile customization (fp-3). Everything here is
 * decorative: none of it can award coins or change data, and every component
 * renders nothing when its effect is turned off or `prefers-reduced-motion`
 * is set (the CSS handles the latter).
 */

/** Floating accent particles in the banner area (`particles`). */
export function ProfileParticles({
  accent,
  count = 14,
}: {
  accent?: string;
  count?: number;
}) {
  const [seeds, setSeeds] = useState<number[]>([]);
  useEffect(() => {
    // Random values are derived after mount (inside rAF, per the Compiler lint
    // rule) so the server HTML is stable and hydration cannot mismatch.
    const frame = requestAnimationFrame(() => {
      setSeeds(Array.from({ length: count }, () => Math.random()));
    });
    return () => cancelAnimationFrame(frame);
  }, [count]);

  if (seeds.length === 0) return null;
  return (
    <span className="pf-particles" aria-hidden>
      {seeds.map((seed, index) => {
        const size = 3 + seed * 5;
        return (
          <span
            key={index}
            className="pf-particle"
            style={{
              left: `${(seed * 100).toFixed(2)}%`,
              width: size,
              height: size,
              animationDuration: `${7 + seed * 9}s`,
              animationDelay: `${seed * -12}s`,
              background: accent,
            }}
          />
        );
      })}
    </span>
  );
}

/** Pointer-following 3D tilt for the identity card (`tilt3d`). */
export function ProfileTilt({
  children,
  enabled = true,
}: {
  children: React.ReactNode;
  enabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || !enabled) return;
    const onMove = (event: PointerEvent) => {
      const rect = node.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      node.style.transform = `perspective(700px) rotateX(${(-y * 5).toFixed(2)}deg) rotateY(${(x * 7).toFixed(2)}deg)`;
    };
    const onLeave = () => {
      node.style.transform = "";
    };
    node.addEventListener("pointermove", onMove);
    node.addEventListener("pointerleave", onLeave);
    return () => {
      node.removeEventListener("pointermove", onMove);
      node.removeEventListener("pointerleave", onLeave);
    };
  }, [enabled]);

  return (
    <div ref={ref} className="pf-tilt">
      {children}
    </div>
  );
}

/** One falling-coin shower on visit (`coinRainAuto`). Decorative only. */
export function ProfileAutoRain({ accent }: { accent?: string }) {
  const [coins, setCoins] = useState<number[]>([]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setCoins(Array.from({ length: 12 }, () => Math.random()));
    });
    const timer = window.setTimeout(() => setCoins([]), 4200);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, []);

  if (coins.length === 0) return null;
  return (
    <span className="pf-auto-rain" aria-hidden>
      {coins.map((seed, index) => (
        // The fall itself is a keyframe (see .pf-rain-coin), so the coins are
        // visible for their whole duration instead of being set to opacity 0 by
        // script and never recovering.
        <span
          key={index}
          className="pf-rain-coin"
          style={{
            left: `${8 + seed * 84}vw`,
            width: 14 + seed * 8,
            height: 14 + seed * 8,
            animationDuration: `${2.2 + seed * 1.6}s`,
            animationDelay: `${seed * 0.9}s`,
            background: accent,
            borderColor: accent,
          }}
        />
      ))}
    </span>
  );
}
