import { Effect } from "effect";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { TRANSCRIBE_CLIPS_JOB_KIND } from "@/features/video-editor/transcribe-clips-response";

/**
 * THE STUCK-CLIP SWEEP: a Clip left `transcribing` that no live
 * `transcribe-clips` Job holds — its tab closed or its server died before
 * the Sidecar ran Clip transcription, or its Job was lost and settled by
 * recovery — would spin forever. The sweep marks it `failed`, so the author
 * re-transcribes it by hand. It never enqueues a Job or calls Whisper: an
 * old stuck Clip is not worth a Whisper run nobody asked for.
 *
 * The Sidecar runs it after each recovery sweep (at start, then every
 * `recoverEveryMs`), so a Job recovery has just settled has its Clips
 * failed in the same pass. Each Video is its own write: a Video whose write
 * fails is logged and the rest carry on.
 */
export const sweepStuckClips = Effect.gen(function* () {
  const clipOps = yield* ClipOperationsService;
  const videoIds = yield* clipOps.listVideosWithStuckTranscriptions(
    TRANSCRIBE_CLIPS_JOB_KIND
  );
  yield* Effect.forEach(
    videoIds,
    (videoId) =>
      clipOps.failStuckTranscriptions(videoId, TRANSCRIBE_CLIPS_JOB_KIND).pipe(
        Effect.flatMap((clipIds) =>
          clipIds.length === 0
            ? Effect.void
            : Effect.logWarning(
                "stuck clips: no live transcribe-clips Job held them; marked failed",
                { clipIds }
              )
        ),
        Effect.annotateLogs({ videoId }),
        Effect.catchAllCause((cause) =>
          Effect.logError(
            "stuck clips: could not mark this video's stuck clips failed",
            cause
          ).pipe(Effect.annotateLogs({ videoId }))
        )
      ),
    { discard: true }
  );
});
