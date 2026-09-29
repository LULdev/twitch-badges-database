/**
 * Navigation skeleton. Every route in this segment renders dynamically, and
 * without a loading boundary Link prefetch had nothing to prefetch — a click
 * waited out the full server chain (auth + layout data + page queries) on the
 * OLD page with zero feedback. This boundary makes the swap instant and lets
 * the router stream the real page in behind it.
 */
export default function Loading() {
  return (
    <div className="space-y-12" role="status" aria-label="…">
      {/* Hero-shaped placeholder */}
      <div className="relative overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface px-6 py-14 shadow-card sm:px-10">
        <div className="mx-auto h-8 w-2/3 max-w-2xl animate-pulse rounded-lg bg-surface-2" />
        <div className="mx-auto mt-4 h-4 w-1/2 max-w-xl animate-pulse rounded-lg bg-surface-2" />
        <div className="mt-8 flex items-center justify-center gap-3">
          <div className="h-11 w-36 animate-pulse rounded-lg bg-surface-2" />
          <div className="h-11 w-36 animate-pulse rounded-lg bg-surface-2" />
        </div>
        <div className="mx-auto mt-10 grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card stat-tile">
              <dd className="stat-value h-6 w-12 animate-pulse rounded bg-surface-2" />
              <dt className="stat-label mt-1 h-3 w-16 animate-pulse rounded bg-surface-2" />
            </div>
          ))}
        </div>
      </div>

      {/* Card-grid placeholder */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div key={i} className="card flex flex-col gap-3 p-4">
            <div className="size-14 animate-pulse rounded-lg bg-surface-2" />
            <div className="h-4 w-3/4 animate-pulse rounded bg-surface-2" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-surface-2" />
          </div>
        ))}
      </div>
    </div>
  );
}
