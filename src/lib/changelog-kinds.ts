/**
 * Pure changelog metadata — safe to import from client components (unlike
 * src/lib/changelog.ts, which pulls the service-role admin client).
 */

/** Dot/accent color per changelog kind, shared by the /changelog page, the
 *  homepage card and the status incidents feed. Values are CSS
 *  custom-property references resolved by the active theme. */
export const KIND_COLORS: Record<string, string> = {
  badge_added: "var(--success)",
  badge_updated: "var(--info)",
  badge_removed: "var(--danger)",
  data_sync: "var(--muted)",
  feature: "var(--accent)",
  bugfix: "var(--warning)",
  blog: "var(--accent)",
  push: "var(--info)",
};
