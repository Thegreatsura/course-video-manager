import { Effect } from "effect";
import { ClipMockupVoiceOperationsService } from "@/services/db-clip-mockup-voice-operations.server";
import { CLIP_MOCKUP_VOICE_JOB_KIND } from "@cvm/core/features/clip-mockups/voice-status";
import { voiceJobRequests } from "@cvm/core/features/clip-mockups/voice-job-cover";
import { enqueueJob, JOB_KIND_SPECS } from "./job-specs";

/**
 * THE UNQUEUED-VOICE SWEEP: a Clip Mockup `pending` that no live
 * `clip-mockup-voice` Job names would wait for ever. A COPY makes one — a
 * Version's Submit, a Course's duplicate or a Video's copy writes new rows,
 * with new ids, that no Job knows of (`copiedVoice`). The sweep queues a Job
 * for them, one per Video, as `cvm clip-mockup add` would: Kokoro is local
 * and free, and the WAV of a line already voiced is found on disk.
 *
 * It never marks a row failed: a Job that ends for good does that itself
 * (`afterFinalFailure`). A request the CLI makes at the same moment joins the
 * sweep's Job, or the sweep's joins it (`coveredBy`).
 *
 * The Sidecar runs it after each recovery sweep (at start, then every
 * `recoverEveryMs`), beside the stuck-Clip sweep.
 */
export const sweepUnqueuedVoices = Effect.gen(function* () {
  const voice = yield* ClipMockupVoiceOperationsService;
  const rows = yield* voice.listUnqueuedVoices();
  yield* Effect.forEach(
    voiceJobRequests(rows),
    (request) =>
      enqueueJob({
        id: null,
        kind: CLIP_MOCKUP_VOICE_JOB_KIND,
        ...request,
        dependsOn: null,
        attemptsSpent: 0,
        registry: JOB_KIND_SPECS,
      }).pipe(
        Effect.flatMap((job) =>
          Effect.logWarning(
            "unqueued voices: no live clip-mockup-voice Job named them; queued one",
            { jobId: job.id, clipMockupIds: request.params.clipMockupIds }
          )
        ),
        Effect.annotateLogs({ videoId: request.subject.id }),
        Effect.catchAllCause((cause) =>
          Effect.logError(
            "unqueued voices: could not queue this video's voices",
            cause
          ).pipe(Effect.annotateLogs({ videoId: request.subject.id }))
        )
      ),
    { discard: true }
  );
});
