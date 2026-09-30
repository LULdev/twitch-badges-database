"use client";

import { useEffect, useState } from "react";

/**
 * Thin reading-progress rail pinned over the site header. CSS owns the
 * look (grow-bar aesthetics); rAF-coalesced scroll listeners drive a
 * width percentage on the fill element.
 */
export default function ReadingProgress() {
  const [pct, setPct] = useState(0);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - doc.clientHeight;
      const value = scrollable > 0
        ? Math.min(100, Math.max(0, (doc.scrollTop / scrollable) * 100))
        : 0;
      setPct(value);
    };
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };
    // First measurement goes through rAF too — synchronous setState in the
    // effect body is banned by the repo's react-hooks/set-state-in-effect rule.
    frame = requestAnimationFrame(measure);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="read-progress" aria-hidden="true">
      <div className="read-progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}
