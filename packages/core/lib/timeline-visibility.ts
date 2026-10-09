/**
 * What a Diagram's timeline shows, and whether its head is held there.
 *
 * One module because every surface that decides "would this lose the head?"
 * must agree: the Playground's restore dialog and Snapshot Step, and the
 * agent's `cvm diagram snapshot add`. A disagreement silently loses work from
 * one route and not the other.
 */

/** A snapshot is on the timeline if it is Preserved or a live Clip pins it. */
export function isVisibleInTimeline(
  snapshot: { preserved: boolean },
  pinningClips: { archived: boolean }[]
): boolean {
  return snapshot.preserved || pinningClips.some((c) => !c.archived);
}

/**
 * Whether the head is already safely captured — some snapshot ON THE TIMELINE
 * has the same content hash. `timelineSnapshots` must already be filtered by
 * {@link isVisibleInTimeline}: a snapshot the timeline hides is one the author
 * cannot click back to, so it holds nothing.
 *
 * A `null` head hash is never captured: treating "unknown" as "safe" is the
 * failure that loses work silently.
 */
export function isHeadCaptured(
  timelineSnapshots: readonly { contentHash: string }[],
  headContentHash: string | null
): boolean {
  if (headContentHash === null) return false;
  return timelineSnapshots.some((s) => s.contentHash === headContentHash);
}
