/**
 * Speech to Clips: the source-agnostic half of recording. Whoever finds the
 * speech (the new recorder's silence detector), this decides what of it
 * becomes a Clip and where the Clips go.
 *
 * What of the speech becomes a Clip is `speechToClipBounds`, the same rule the
 * OBS path (`findSilenceInVideo`) bounds its Clips with, so one speech gives
 * the same Clip whichever Recorder found it. The OBS path also shares the
 * placement half (`placeClips`); it keeps its own dedup and its browser-side
 * transcription.
 */

import { Effect } from "effect";
import { TRANSCRIBE_CLIPS_JOB_KIND } from "@/features/video-editor/transcribe-clips-response";
import type { Database } from "@/services/drizzle-service.server";
import { enqueueJob, JOB_KIND_SPECS } from "../../sidecar/job-specs";
import {
  resolveInsertionPoint,
  type FrontendInsertionPoint,
  type FrontendTimelineItem,
} from "./clip-service";
import { placeClips, withVideoMutex } from "./clip-service-handler.helpers";
import { speechToClipBounds, type SpeechSegment } from "./silence-detection";

export type { SpeechSegment };

export interface PlaceSpeechAsClipsInput {
  readonly videoId: string;
  /** The Footage file the speech was found in: each Clip's Footage path. */
  readonly footagePath: string;
  /** The editor's insertion point, as appendFromObs takes it. */
  readonly insertionPoint: FrontendInsertionPoint;
  readonly items: FrontendTimelineItem[];
  /** The picture's frame rate: Clip bounds snap to its frames. */
  readonly fps: number;
  readonly speech: readonly SpeechSegment[];
}

/**
 * Save speech as Clips at the editor's insertion point and enqueue one
 * `transcribe-clips` Job for them. Runs under the video's mutex, so speech
 * arriving at once from two places never takes the same order key.
 */
export const placeSpeechAsClips = Effect.fn("placeSpeechAsClips")(function* (
  db: Database,
  input: PlaceSpeechAsClipsInput
) {
  const bounds = speechToClipBounds(input.speech, input.fps);
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
