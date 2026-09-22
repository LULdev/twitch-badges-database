"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Animated number that counts up the first time it scrolls into view and then
 * follows later changes. Renders 0 on the server so hydration always matches.
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
  // Whether the reveal already ran, and where the counter currently sits.
  // Without the second ref a later change in `value` was ignored: the reveal
  // guard stayed set and the number froze on its first value.
  const revealedRef = useRef(false);
  const shownRef = useRef(0);
  const rafRef = useRef(0);

  const animateTo = useCallback(
    (target: number) => {
      cancelAnimationFrame(rafRef.current);
      const from = shownRef.current;
      const began = performance.now();
      const step = (now: number) => {
        const progress = Math.min(1, (now - began) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        const next = from + (target - from) * eased;
        shownRef.current = next;
        setDisplay(next);
        if (progress < 1) rafRef.current = requestAnimationFrame(step);
        else {
          shownRef.current = target;
          setDisplay(target);
        }
      };
      rafRef.current = requestAnimationFrame(step);
    },
    [duration],
  );

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        if (revealedRef.current) return;
        revealedRef.current = true;
        animateTo(Number.isFinite(value) ? value : 0);
      },
      { threshold: 0.15 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [animateTo, value]);

  // Once revealed, a changed value animates on from wherever the counter is.
  useEffect(() => {
    if (!revealedRef.current) return;
    animateTo(Number.isFinite(value) ? value : 0);
  }, [animateTo, value]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

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