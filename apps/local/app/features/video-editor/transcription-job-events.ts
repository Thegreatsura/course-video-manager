import { Either, Schema } from "effect";
import type { JobEventMessage } from "@/features/jobs/job-wire";
import type { ClipReducerAction, DatabaseId } from "./clip-state-reducer.types";
import {
  CLIP_TRANSCRIPTION_EVENTS,
  toTranscribedClipEvent,
  TranscribedClip,
  TRANSCRIBE_CLIPS_JOB_KIND,
} from "./transcribe-clips-response";

const ClipsStarted = Schema.Struct({ clipIds: Schema.Array(Schema.String) });

/**
 * A `transcribe-clips` Job Event for this Video, as the clip reducer's
 * action; `null` for anything else: another Video, another kind, an event the
 * editor has no use for, or one the loader had already seen.
 *
 * `loadedThrough` is the newest Job Event id when the loader read the Clips
 * (it reads that first). A Clip's row is written before its `clip-settled`
 * event, so every event at or below it is in the loader's Clips already, and
 * a replayed one could only turn a newer result back into an older one.
 */
export const clipActionOfJobEvent = (
  heard: JobEventMessage,
  scope: { videoId: string; loadedThrough: number }
): ClipReducerAction | null => {
  const { job, event } = heard;
  if (
    job.kind !== TRANSCRIBE_CLIPS_JOB_KIND ||
    job.subjectId !== scope.videoId ||
    event.id <= scope.loadedThrough
  ) {
    return null;
  }
  switch (event.type) {
    case CLIP_TRANSCRIPTION_EVENTS.clipsStarted: {
      const started = Schema.decodeUnknownEither(ClipsStarted)(event.data);
      return Either.isRight(started)
        ? {
            type: "transcription-job-started",
            jobId: job.id,
            clipIds: started.right.clipIds as DatabaseId[],
          }
        : null;
    }
    case CLIP_TRANSCRIPTION_EVENTS.clipSettled: {
      const clip = Schema.decodeUnknownEither(TranscribedClip)(event.data);
      return Either.isRight(clip)
        ? {
            type: "clips-transcribed",
            clips: [toTranscribedClipEvent(clip.right)],
          }
        : null;
    }
    case "failed":
    case "interrupted":
      return { type: "transcription-job-failed", jobId: job.id };
    default:
      return null;
  }
};
