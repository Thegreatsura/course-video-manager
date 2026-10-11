/**
 * Speech to Clips: the source-agnostic half of recording. Whoever finds the
 * speech (the new recorder's silence detector), this decides what of it
 * becomes a Clip and where the Clips go.
 *
 * The OBS path (`appendFromObsImpl`) finds its speech and bounds its Clips in
 * `silence-detection.ts`, frame by frame, then shares the placement half
 * (`placeClips`). Both read the same constants
 * (`silence-detection-constants.ts`), so the two paths cannot drift on the
 * minimum Clip length or the end padding.
 */

import { Effect } from "effect";
import {
  AUTO_EDITED_END_PADDING_SECONDS,
  MINIMUM_CLIP_LENGTH_SECONDS,
} from "@/silence-detection-constants";
import { TRANSCRIBE_CLIPS_JOB_KIND } from "@/features/video-editor/transcribe-clips-response";
import type { Database } from "@/services/drizzle-service.server";
import { enqueueJob, JOB_KIND_SPECS } from "../../sidecar/job-specs";
import {
  resolveInsertionPoint,
  type FrontendInsertionPoint,
  type FrontendTimelineItem,
} from "./clip-service";
import { placeClips, withVideoMutex } from "./clip-service-handler.helpers";

/** One stretch of speech, in the Footage file's own time (seconds). */
export interface SpeechSegment {
  readonly startTime: number;
  readonly endTime: number;
}

export interface PlaceSpeechAsClipsInput {
  readonly videoId: string;
  /** The Footage file the speech was found in: each Clip's Footage path. */
  readonly footagePath: string;
  /** The editor's insertion point, as appendFromObs takes it. */
  readonly insertionPoint: FrontendInsertionPoint;
  readonly items: FrontendTimelineItem[];
  readonly speech: readonly SpeechSegment[];
}

const toHundredths = (seconds: number) => Math.round(seconds * 100) / 100;

/**
 * Speech too short to be a take is dropped; the rest gets the end padding,
 * so a cut never lands on the last syllable.
 */
const clipBoundsOf = (speech: readonly SpeechSegment[]) =>
  speech
    .filter((s) => s.endTime - s.startTime >= MINIMUM_CLIP_LENGTH_SECONDS)
    .map((s) => ({
      startTime: toHundredths(Math.max(0, s.startTime)),
      endTime: toHundredths(s.endTime + AUTO_EDITED_END_PADDING_SECONDS),
    }));

/**
 * Save speech as Clips at the editor's insertion point and enqueue one
 * `transcribe-clips` Job for them. Runs under the video's mutex, so speech
 * arriving at once from two places never takes the same order key.
 */
export const placeSpeechAsClips = Effect.fn("placeSpeechAsClips")(function* (
  db: Database,
  input: PlaceSpeechAsClipsInput
) {
  const bounds = clipBoundsOf(input.speech);
  if (bounds.length === 0) {
    return { clips: [], transcriptionJobId: null };
  }

  const clips = yield* withVideoMutex(
    input.videoId,
    placeClips(db, {
      videoId: input.videoId,
      insertionPoint: resolveInsertionPoint(input.insertionPoint, input.items),
      clips: bounds.map((b) => ({ inputVideo: input.footagePath, ...b })),
    })
  );

  const clipIds = clips.map((c) => c.id);
  const job = yield* enqueueJob({
    id: null,
    kind: TRANSCRIBE_CLIPS_JOB_KIND,
    title: `Transcribe ${clipIds.length} ${clipIds.length === 1 ? "Clip" : "Clips"}`,
    params: { clipIds },
    subject: { type: "video", id: input.videoId },
    attemptsSpent: 0,
    dependsOn: null,
    registry: JOB_KIND_SPECS,
  });

  return { clips, transcriptionJobId: job.id };
});
