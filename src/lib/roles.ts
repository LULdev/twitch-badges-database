/**
 * Staff roles.
 *
 * The type and the predicate live outside the component on purpose: `RoleBadge`
 * is a client component (the header account menu is a client component and
 * cannot render an async server component), and a `"use client"` module may
 * only be *rendered* from a server component — calling one of its exports from
 * server code throws at runtime. Keeping the predicate here lets the profile
 * page ask the question server-side.
 */
export type StaffRole = "owner" | "admin" | "moderator";

export function isStaffRole(value: unknown): value is StaffRole {
  return value === "owner" || value === "admin" || value === "moderator";
}
