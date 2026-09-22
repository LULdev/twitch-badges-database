# agent-08 — stats / uptime audit

## stats-1: Growth charts always read zero — view column names never match the reader
- **Severity**: high
- **Side**: shared
- **File**: `src/lib/stats.ts:418-425`, `supabase/migrations/0004_stats_uptime.sql:262,272`, `src/app/[locale]/stats/page.tsx:211-219,1129-1151`
- **Evidence**: view column is `count(*)::bigint as signups` (0004:262) and `count(*)::bigint as badges` (0004:272), but `stats.ts` maps `count: num(row.count)`, and `DailyCountRow` is `{ day; count }`. Grep confirms no later migration re-aliases (`grep -rn "signups" supabase/migrations/` → only 0004).
- **Why it is a bug**: `row.count` is `undefined` → `Number(undefined ?? 0)` → `0`. `userTrend` (page:211) and `badgeTrend` (page:216) are therefore all-zero, so "New users / New badges" render flat empty lines even when profiles and badges are being created daily. Data exists; the page shows a false zero.
- **Confidence**: confirmed
- **Fix direction**: alias the views to the shape the reader expects (`as count`) or map `signups`/`badges` in `stats.ts` (`count: num(row.signups)`, `count: num(row.badges)`).

## stats-2: Uptime-sources table headers do not line up with the cells
- **Severity**: medium
- **Side**: client
- **File**: `src/app/[locale]/stats/page.tsx:964-1028`
- **Evidence**: `<thead>` columns are `source | lastRun | lastStatus | Ø ms | 24h | 7d | 30d`; the row emits `source | last_at | status | avg_ms_24h | checks_24h | rate24h | rate7d`.
- **Why it is a bug**: the column labelled **24h** renders a raw check *count* (`checks_24h`), the column labelled **7d** renders the *24-hour* success rate (`rate24h`), and the column labelled **30d** renders the *7-day* rate (`rate7d`). No 30-day rate is computed at all (`stats.ts` never builds `rate30d`). Every rate is displayed under the wrong heading.
- **Confidence**: confirmed
- **Fix direction**: restore one column per metric (24h count, 24h %, 7d %, 30d %) and add a `rate30d` derived from `checks_30d`/`ok_30d`.

## stats-3: Hero availability KPI reports 0.00% when there is no data
- **Severity**: medium
- **Side**: server
- **File**: `src/app/[locale]/stats/page.tsx:458-468`
- **Evidence**: `value={uptime.availabilityAll ?? 0}` with `decimals={2}`.
- **Why it is a bug**: `availability()` deliberately returns `null` when there are zero checks (drops a fresh/un-migrated probe), but the KPI coerces it to `0`, so the headline tile claims "0.00% availability" instead of "—". This directly violates the "no data must render —, not 0/100%" rule. `UptimeGauge` handles the same null correctly ("—"), so the two disagree on the same page.
- **Confidence**: confirmed
- **Fix direction**: give `Kpi` an optional `null` value path (render "—") and pass `uptime.availabilityAll` un-coerced.

## stats-4: Uptime calendar day labels are timezone-shifted
- **Severity**: low
- **Side**: server
- **File**: `src/components/stats/UptimeCalendar.tsx:34-49`
- **Evidence**: `new Intl.DateTimeFormat(locale, { day:"2-digit", month:"short" })` (no `timeZone`) formatting `new Date(`${cell.day}T00:00:00Z`)`.
- **Why it is a bug**: `cell.day` is UTC midnight; `formatDay` formats in the runtime's local zone, so in any negative-offset zone the tooltip shows the *previous* day for every cell. Deterministic on a UTC server, wrong on a non-UTC runtime/locale preview.
- **Confidence**: likely
- **Fix direction**: add `timeZone: "UTC"` to the formatter, matching the UTC keys built in `calendarCells`.

## stats-5: OwnersChart passes `var()` as SVG presentation attributes
- **Severity**: low
- **Side**: client
- **File**: `src/components/charts/OwnersChart.tsx:29,30,39,50`
- **Evidence**: `stroke="var(--line)"`, `stroke="var(--line-strong)"`, `border: "1px solid var(--line-strong)"` — every other chart in the set resolves tokens via `useChartTheme` precisely because "SVG presentation attributes cannot resolve var()" (`useChartTheme.ts:31-34`).
- **Why it is a bug**: `var()` is not valid in SVG presentation attributes, so grid/axis strokes fall back to the initial value (typically none/black) rather than the theme line colour, and the theme is neither tracked nor followed on theme switch.
- **Confidence**: unconfirmed
- **Fix direction**: use `useChartTheme()` like `TrendChart.tsx` and pass resolved hex colours.

## Clean / checked
- `CountUp` seeds `display = 0` and animates in `useEffect`; server and client first paint both render `0` → no hydration mismatch; observer + rAF are cleaned up.
- `LiveStatus` poll: `setInterval`/`setTimeout` both cleared, `mountedRef` guards late `setState`; first probe deferred via `setTimeout(0)` per the compiler rule.
- Empty-array maths: `DistributionBars`/`LevelHistogram` early-return on empty and seed peaks with `Math.max(1, …)`; `reduce(…, 0)` in the page cannot throw.
- Day bucketing in `daySeries`/`calendarCells`/`AvailabilityStrip` rebuilds UTC-midnight/hour keys per index — no dropped or duplicated days at month/UTC boundaries.
- `UptimeGauge` and `availability()` correctly render "—" for `null`/zero-total; no NaN/Infinity in `toFixed`/percent paths.
- Migration views expose only aggregates and `profiles.username`/`avatar_url` — no `profiles.email` anywhere in 0004.