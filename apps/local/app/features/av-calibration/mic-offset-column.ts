/**
 * "Past calibrations"' Mic Offset column, one cell per row (rows newest
 * first): the row's Mic Offset in whole ms and its change from the previous
 * (older) row that has one, e.g. "162 ms (+12)"; "—" for a row without one
 * (from before the clap step, or no clap found). Information only: a shift
 * never fails anything.
 */
export const micOffsetColumn = (
  rows: readonly { micOffsetMs: number | null }[]
): string[] =>
  rows.map((row, i) => {
    if (row.micOffsetMs === null) return "—";
    const offset = Math.round(row.micOffsetMs);
    const previous = rows
      .slice(i + 1)
      .find((r) => r.micOffsetMs !== null)?.micOffsetMs;
    if (previous == null) return `${offset} ms`;
    const delta = offset - Math.round(previous);
    const sign = delta > 0 ? "+" : delta < 0 ? "-" : "±";
    return `${offset} ms (${sign}${Math.abs(delta)})`;
  });
