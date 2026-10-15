import type { FrontendId } from "./clip-state-reducer";

/**
 * The most Clips kept preloaded at once. Each one mounts its own `<video>`s
 * (three for a CVM-recorder Clip), so the set is rebuilt around the playhead
 * on every move instead of growing with every Clip visited.
 */
export const MAX_PRELOADED_CLIPS = 6;

/**
 * The Clips to keep preloaded: the current one and the two after it, then the
 * selected Clips nearest the current one, up to `MAX_PRELOADED_CLIPS`.
 */
export const preloadedAround = (
  clipIds: FrontendId[],
  currentClipId: FrontendId,
  selected: Set<FrontendId>
): Set<FrontendId> => {
  const index = clipIds.indexOf(currentClipId);
  const ahead = clipIds.slice(index + 1, index + 3);
  const nearestSelected = clipIds
    .map((id, i) => ({ id, distance: Math.abs(i - index) }))
    .filter(({ id }) => selected.has(id))
    .sort((a, b) => a.distance - b.distance)
    .map(({ id }) => id);
  return new Set(
    [currentClipId, ...ahead, ...nearestSelected].slice(0, MAX_PRELOADED_CLIPS)
  );
};
