"use client";

/**
 * The operator-facing result line for an admin panel.
 *
 * Rendered unconditionally so the live region exists BEFORE its text arrives — a
 * region created together with its content is missed by screen readers, which is
 * why the banners under src/components/admin were never announced. Error and
 * notice share one region so the latest outcome replaces the previous one.
 */
export default function AdminStatus({
  error,
  notice,
  className = "text-sm font-semibold",
}: {
  error?: string | null;
  notice?: string | null;
  className?: string;
}) {
  return (
    <p role="status" aria-live="polite" className={className}>
      {error ? <span className="text-danger">{error}</span> : null}
      {notice ? <span className="text-success">{notice}</span> : null}
    </p>
  );
}
