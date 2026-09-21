"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Animated number that counts up from 0 the first time it scrolls into view.
 * Renders 0 on the server so hydration always matches.
 */
export default function CountUp({
  value,
  duration = 1200,
  decimals = 0,
  locale = "en",
  suffix = "",
  prefix = "",
  className = "",
}: {
  value: number;
  duration?: number;
  decimals?: number;
  locale?: string;
  suffix?: string;
  prefix?: string;
  className?: string;
}) {
  const [display, setDisplay] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let raf = 0;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || startedRef.current) continue;
          startedRef.current = true;
          observer.disconnect();
          const target = Number.isFinite(value) ? value : 0;
          const began = performance.now();
          const step = (now: number) => {
            const progress = Math.min(1, (now - began) / duration);
            const eased = 1 - Math.pow(1 - progress, 3);
            setDisplay(target * eased);
            if (progress < 1) raf = requestAnimationFrame(step);
            else setDisplay(target);
          };
          raf = requestAnimationFrame(step);
        }
      },
      { threshold: 0.15 },
    );

    observer.observe(node);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value, duration]);

  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(display);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}
