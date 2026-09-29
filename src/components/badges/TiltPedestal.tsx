"use client";

import { useEffect, useRef } from "react";

/**
 * Pointer-driven 3D tilt for the badge pedestal (layout variant A).
 * Decorative only: disabled on coarse pointers (touch), when hover is
 * unavailable, and under prefers-reduced-motion — the same contract as the
 * pf-* profile effects. The transform is written here; the transition and
 * preserve-3d come from the existing .pf-tilt class in globals.css.
 */
export default function TiltPedestal({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!fine.matches || motion.matches) return;

    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const rect = node.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      node.style.transform = `perspective(700px) rotateX(${(-y * 8).toFixed(2)}deg) rotateY(${(x * 8).toFixed(2)}deg)`;
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
  }, []);

  return (
    <div ref={ref} className={`pf-tilt ${className}`}>
      {children}
    </div>
  );
}
