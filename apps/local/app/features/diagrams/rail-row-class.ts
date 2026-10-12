/**
 * The background, border and ring of a row in the Active Diagram window's right
 * rail — a Diagram in the Diagram Rail, a snapshot in the Snapshot Timeline.
 *
 * The active row (the Diagram open, the snapshot on the canvas) carries a 2px
 * light ring and a raised background, so it reads at a glance: Matt picks the
 * snapshot to archive by it.
 */
export function railRowClass(isActive: boolean): string {
  return isActive
    ? "border-zinc-200 bg-zinc-700 ring-1 ring-zinc-200"
    : "border-zinc-700 bg-zinc-800 hover:bg-zinc-700/40";
}
