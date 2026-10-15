import { METRICS, rank, type Measured, type Row } from "./metrics";

/**
 * The scorecard's two outputs: `scorecard.json` (metrics in a fixed order,
 * one per line in `metrics`, so two runs diff line by line; `ranking` lists
 * the failing ids worst first) and `scorecard.md` (the same, for reading).
 */

export type RunInfo = {
  startedAt: string;
  mode: "quick" | "full";
  commit: string;
  longTakeSeconds: number;
  cycles: number;
  wallSeconds: number;
  notes: string[];
};

const round = (v: number | null) =>
  v === null
    ? null
    : Math.abs(v) >= 100
      ? Math.round(v)
      : Math.round(v * 100) / 100;

const fmt = (v: number | null, unit: string) =>
  v === null
    ? "—"
    : unit === "bool"
      ? v >= 1
        ? "yes"
        : "no"
      : `${round(v)} ${unit}`;

export const renderJson = (
  run: RunInfo,
  measured: Measured,
  details: unknown
) => {
  const rows = rank(measured);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const metrics = Object.fromEntries(
    METRICS.map((d) => {
      const r = byId.get(d.id)!;
      return [
        d.id,
        {
          value: round(r.value),
          target: d.target,
          obs: d.obs,
          bar: r.bar,
          status: r.status,
          gap: round(r.gap),
          vsObs: r.vsObs,
        },
      ];
    })
  );
  const lines = Object.entries(metrics).map(
    ([id, m]) => `    ${JSON.stringify(id)}: ${JSON.stringify(m)}`
  );
  const head = JSON.stringify(
    {
      run,
      ranking: rows.filter((r) => r.status === "fail").map((r) => r.id),
      unmeasured: rows
        .filter((r) => r.status === "unmeasured")
        .map((r) => r.id),
    },
    null,
    2
  ).replace(/\n}$/, "");
  return `${head},\n  "metrics": {\n${lines.join(",\n")}\n  },\n  "details": ${JSON.stringify(details, null, 2).replace(/\n/g, "\n  ")}\n}\n`;
};

const obsCell = (r: Row) => (r.obs === null ? "unknown" : `${r.obs} ${r.unit}`);

const table = (rows: Row[]) =>
  [
    "| # | Metric | CVM | Target | OBS | Bar | Status | Gap |",
    "|---|---|---|---|---|---|---|---|",
    ...rows.map(
      (r, i) =>
        `| ${i + 1} | ${r.label} (\`${r.id}\`) | ${fmt(r.value, r.unit)} | ${fmt(r.target, r.unit)} | ${obsCell(r)} | ${fmt(r.bar, r.unit)} | ${r.status === "fail" ? "**fail**" : r.status} | ${r.status === "fail" ? round(r.gap) : ""} |`
    ),
  ].join("\n");

export const renderMarkdown = (run: RunInfo, measured: Measured) => {
  const rows = rank(measured);
  const failing = rows.filter((r) => r.status === "fail");
  const groups = (["speed", "reliability", "resources"] as const).map(
    (g) =>
      `### ${g[0]!.toUpperCase()}${g.slice(1)}\n\n${table(rows.filter((r) => r.group === g))}`
  );
  const sources = rows
    .filter((r) => r.obsSource)
    .map((r) => `- \`${r.id}\`: ${r.obsSource}`);
  const notes = rows
    .filter((r) => r.note)
    .map((r) => `- \`${r.id}\`: ${r.note}`);
  return [
    "# Recorder scorecard",
    "",
    `Run ${run.startedAt}, ${run.mode} mode, commit \`${run.commit}\`, ${Math.round(run.wallSeconds)} s. Long take ${run.longTakeSeconds} s; ${run.cycles} Record/Stop cycles. Synthetic sources only (lavfi through the real ffmpeg.exe and the real recorder service).`,
    "",
    "The bar is the stricter of the target and OBS's value (CVM must be at least as good as OBS). Gap is how far past the bar, in each metric's own scale, so gaps rank across units.",
    "",
    `## Gaps, worst first (${failing.length} failing, ${rows.filter((r) => r.status === "unmeasured").length} unmeasured, ${rows.filter((r) => r.status === "pass").length} passing)`,
    "",
    failing.length ? table(failing) : "None.",
    "",
    "## All metrics",
    "",
    ...groups.flatMap((g) => [g, ""]),
    "## OBS evidence",
    "",
    ...sources,
    "",
    "Every other OBS value is unknown: the repo has no measurement of it (no OBS start/stop latency, finalisation time, idle preview latency, crash recovery, cycle or disk-full data).",
    "",
    "## Notes",
    "",
    ...notes,
    ...run.notes.map((n) => `- ${n}`),
    "",
  ].join("\n");
};
