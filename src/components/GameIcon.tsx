/**
 * Inline SVG icon set for the game hub. Replaces the emoji map the hub used
 * before: AGENTS.md asks for inline SVG instead of emojis, and emoji artwork
 * differs per OS, cannot be themed with `currentColor` and is not affected by
 * the accent tokens.
 */
const PATHS: Record<string, React.ReactNode> = {
  rps: (
    <>
      <rect x="5" y="8.5" width="14" height="11" rx="3" />
      <path d="M9 8.5V6.5M12 8.5V5.5M15 8.5V6.5M5 12.5H3.5M19 12.5h1.5" />
    </>
  ),
  slots: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M9 5v14M15 5v14" />
    </>
  ),
  shoot: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  memory: (
    <>
      <rect x="3.5" y="6.5" width="11" height="14" rx="2" />
      <path d="M8 4.5h10a2 2 0 0 1 2 2v11" />
    </>
  ),
  quiz: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .9-1 1.6v.4" />
      <circle cx="12" cy="16.6" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  coinflip: (
    <>
      <circle cx="9" cy="12" r="5.5" />
      <path d="M14.5 8.2a5.5 5.5 0 0 1 0 7.6M4.5 12H2M19.5 12H22" />
    </>
  ),
  hilo: (
    <>
      <path d="M3.5 19.5h17" />
      <path d="M5 15.5 9.5 10l3 3L20 5" />
      <path d="M20 9.5V5h-4.5" />
    </>
  ),
  roulette: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3" />
    </>
  ),
  blackjack: (
    <>
      <rect x="4" y="4.5" width="11" height="15" rx="2" />
      <path d="M9.5 10.5 14 15M14 10.5 9.5 15" />
      <path d="M17 8a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2" />
    </>
  ),
  vault: (
    <>
      <rect x="4" y="10.5" width="16" height="10" rx="2.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
      <circle cx="12" cy="15.5" r="1.4" />
    </>
  ),
  scratch: (
    <>
      <path d="M3.5 8.5A2 2 0 0 1 5.5 6.5h13a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
      <path d="M8 6.5v11M16 6.5v11" />
    </>
  ),
  tower: (
    <>
      <path d="M12 3.5 18 19.5H6z" />
      <path d="M9.2 12h5.6M7.8 16h8.4" />
    </>
  ),
  catcher: (
    <>
      <path d="M4.5 10.5h15l-1.5 8a2 2 0 0 1-2 1.5H8a2 2 0 0 1-2-1.5z" />
      <path d="M8.5 10.5 10 4.5M15.5 10.5 14 4.5M12 10.5v9.5" />
    </>
  ),
  wheel: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5 12 12l6 6" />
      <path d="M3.5 12h17M12 3.5v17" />
    </>
  ),
  // Neutral stand-in for an id with no icon. Previously the fallback was the
  // shoot crosshair, so a newly added game silently rendered as the wrong game.
  fallback: (
    <>
      <rect x="3.5" y="6" width="17" height="12" rx="3" />
      <path d="M8 12h2.5M9.25 10.75v2.5M15 11.5h.01M17 13.5h.01" />
    </>
  ),
};

export default function GameIcon({
  id,
  size = 30,
  className = "",
}: {
  id: string;
  size?: number;
  className?: string;
}) {
  const path = PATHS[id] ?? PATHS.fallback;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className={className}
    >
      {path}
    </svg>
  );
}