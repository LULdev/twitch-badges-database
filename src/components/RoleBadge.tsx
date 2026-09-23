"use client";

import { useTranslations } from "next-intl";
import type { StaffRole } from "@/lib/roles";

/**
 * Role badge for the three staff levels.
 *
 * A client component, not a server one, because the header account menu is a
 * client component and an async server component cannot be rendered inside it —
 * this way one badge serves the profile page and the header.
 *
 * Each level gets its own visual language rather than one badge in three
 * colours, so the role is readable at a glance and at 14px:
 *   - **owner** — a rotating rainbow ring, a crown and a double sparkle;
 *   - **admin** — a gold shield with light sweeping across it;
 *   - **moderator** — an emerald ring with a radar ping.
 *
 * The type lives in lib/roles so server code can use the predicate without
 * importing from this client module.
 *
 * Everything is CSS over the existing tokens, so both themes work, and every
 * animation is disabled under `prefers-reduced-motion` (the overrides live with
 * the rest of the role-badge rules in globals.css).
 */
export default function RoleBadge({
  role,
  size = "md",
  showLabel = true,
}: {
  role: StaffRole;
  /** `sm` is the header chip, `md` the profile identity block. */
  size?: "sm" | "md";
  showLabel?: boolean;
}) {
  const t = useTranslations("roles");
  const px = size === "sm" ? 11 : 14;

  const icon =
    role === "owner" ? (
      <svg viewBox="0 0 24 24" width={px} height={px} fill="currentColor" aria-hidden focusable="false">
        <path d="M3 7l3.5 3L12 4l5.5 6L21 7l-1.6 10.2a1 1 0 0 1-1 .8H5.6a1 1 0 0 1-1-.8L3 7zm2.9 12.2h12.2v1.6H5.9v-1.6z" />
      </svg>
    ) : role === "admin" ? (
      <svg viewBox="0 0 24 24" width={px} height={px} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
        <path d="M12 3l7 3v6c0 4.2-2.9 7.7-7 9-4.1-1.3-7-4.8-7-9V6l7-3z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ) : (
      <svg viewBox="0 0 24 24" width={px} height={px} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden focusable="false">
        <circle cx="12" cy="12" r="2.5" />
        <path d="M12 4.5a7.5 7.5 0 0 1 7.5 7.5M4.5 12A7.5 7.5 0 0 1 12 4.5" />
      </svg>
    );

  return (
    <span
      className={`role-badge role-${role} ${size === "sm" ? "role-sm" : "role-md"}`}
      title={t(`${role}Hint`)}
    >
      <span className="role-ring" aria-hidden />
      <span className="role-sparkle role-sparkle-a" aria-hidden />
      <span className="role-sparkle role-sparkle-b" aria-hidden />
      <span className="role-icon">{icon}</span>
      {showLabel ? <span className="role-label">{t(role)}</span> : null}
    </span>
  );
}