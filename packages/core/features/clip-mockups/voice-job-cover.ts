import { CLIP_MOCKUP_VOICING_EVENT } from "./voice-status.js";

/** What a `clip-mockup-voice` Job is asked to voice: each Clip Mockup's line now. */
export interface ClipMockupVoiceRequest {
  readonly clipMockupIds: ReadonlyArray<string>;
  /** Each Clip Mockup's line as the request saw it, by id. */
  readonly lines: Readonly<Record<string, string>>;
}

/** The Job Events that start a run afresh, or put it back to be run again. */
const RUN_STARTS = new Set(["started", "retrying", "requeued"]);

/**
 * THE PER-ROW DEDUPE KEY of Clip Mockup voice: a Clip Mockup and its line.
 * Whether a live `clip-mockup-voice` Job (its params and Job Events) will
 * voice every line `request` asks for — then `enqueueJob` answers with it and
 * queues nothing (`coveredBy`).
 *
 * A Job that has not read its rows yet (queued, or put back to run again)
 * reads them afresh, so it voices whatever each named row says by then: it
 * covers any line. A run that has read them says which lines in its latest
 * `voicing` event, and covers exactly those. So a picture-only `update` on a
 * row already queued or being voiced queues nothing, and new words always
 * get a Job of their own.
 */
export const liveVoiceJobCovers = (
  request: ClipMockupVoiceRequest,
  live: {
    readonly params: unknown;
    readonly events: ReadonlyArray<{
      readonly type: string;
      readonly data: unknown;
    }>;
  }
): boolean => {
  const liveIds = (live.params as { clipMockupIds?: unknown } | null)
    ?.clipMockupIds;
  if (!Array.isArray(liveIds)) return false;
  const named = new Set(liveIds as string[]);
  if (request.clipMockupIds.some((id) => !named.has(id))) return false;

  const latest = live.events.findLast(
    (e) => RUN_STARTS.has(e.type) || e.type === CLIP_MOCKUP_VOICING_EVENT
  );
  if (latest === undefined || latest.type !== CLIP_MOCKUP_VOICING_EVENT) {
    return true;
  }
  const voicing =
    (latest.data as { lines?: Record<string, string> } | null)?.lines ?? {};
  return request.clipMockupIds.every((id) => voicing[id] === request.lines[id]);
};
