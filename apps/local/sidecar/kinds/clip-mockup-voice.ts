import { Effect } from "effect";
import { ClipMockupVoiceOperationsService } from "@/services/db-clip-mockup-voice-operations.server";
import { writeClipMockupFile } from "@/services/clip-mockup-files";
import { resolveClipMockupSpeeches } from "@/services/resolve-clip-mockup-speech";
import { CLIP_MOCKUP_VOICING_EVENT } from "@cvm/core/features/clip-mockups/voice-status";
import { defineJobKind } from "../job-kind";
import { JOB_PARAMS } from "../job-params";
import { CLIP_MOCKUP_VOICE_POLICY } from "../retry-policy";

/**
 * **Clip Mockup voice**, enqueued by `cvm clip-mockup add` and `update`:
 * voice each named Clip Mockup's line with Kokoro, through the Clip Mockup
 * daemon on this machine's GPU, write the WAV into its Video's Clip Mockup
 * directory, and record it on the row — `ready`, with its `audioPath` and
 * measured `durationSeconds`.
 *
 * The CLI no longer waits for any of this: it writes the rows `pending` and
 * returns, and this Job, in the Sidecar, does the slow part.
 *
 * Each run READS THE ROWS AFRESH and voices only what is not `ready`, with
 * the words each row says NOW; the row is marked against that line, so a
 * line changed meanwhile is left for the Job its change queued. The WAVs are
 * named by a hash of the line, so a second run — a retry, or a Job put back
 * by a deliberate stop — finds the ones that landed on disk and voices only
 * the rest.
 *
 * A failed run is retried at once while attempts remain
 * (`CLIP_MOCKUP_VOICE_POLICY`: 3). Once the Job has ENDED FOR GOOD — by any
 * route: its last attempt threw or died of a defect, or its last run was lost
 * to a killed Sidecar or an expired lease — `afterFinalFailure` marks every
 * Clip Mockup it named that is still `pending` `failed`, with the reason.
 * That is the one place a row is marked failed. `cvm clip-mockup update` on
 * one queues it again. No toast when it succeeds: a Clip Mockup shows its
 * own voice, as a Clip shows its own transcription.
 */
/**
 * ONE VOICE RUN AT A TIME in this Sidecar, from reading its rows to marking
 * them: a second Job for the same Clip Mockup waits here, then reads them
 * afresh and finds them voiced. So two Jobs never voice the same row at
 * once. The daemon voices one line at a time on one GPU anyway; like
 * ffmpeg's permits, the limit lives with the work, not in a lane.
 */
const voicing = Effect.unsafeMakeSemaphore(1);

export const clipMockupVoiceJobKind = defineJobKind({
  ...CLIP_MOCKUP_VOICE_POLICY,
  params: JOB_PARAMS["clip-mockup-voice"],
  run: (params, ctx) =>
    voicing.withPermits(1)(
      Effect.gen(function* () {
        const voice = yield* ClipMockupVoiceOperationsService;
        const rows = yield* voice.listClipMockupsToVoice(params.clipMockupIds);
        const todo = rows.filter(
          (r) => !r.archived && r.voiceStatus !== "ready"
        );
        if (todo.length === 0) {
          yield* Effect.logInfo(
            "clip-mockup-voice: every Clip Mockup is already voiced, archived or gone"
          );
          return;
        }
        yield* Effect.logInfo("clip-mockup-voice: started", {
          clipMockupIds: todo.map((r) => r.id),
          attempt: ctx.attempt,
          maxAttempts: ctx.maxAttempts,
        });
        // The words this run voices: a request for the same words is covered
        // by this Job and queues none (`voice-job-cover.ts`).
        yield* ctx.emit(CLIP_MOCKUP_VOICING_EVENT, {
          lines: Object.fromEntries(todo.map((r) => [r.id, r.line])),
        });

        const { speeches: voiced, files } = yield* resolveClipMockupSpeeches(
          todo.map((r) => ({ lineageId: r.lineageId, line: r.line }))
        );
        // Every WAV before any row says `ready`: a row whose audioPath points
        // at nothing is the one state nobody can see or fix.
        for (const file of files) {
          yield* writeClipMockupFile(file.lineageId, file.audioPath, file.wav);
        }

        let marked = 0;
        for (const [i, row] of todo.entries()) {
          const landed = yield* voice.markVoiceReady({
            id: row.id,
            line: row.line,
            speech: voiced[i]!,
          });
          if (landed) marked++;
        }
        yield* Effect.logInfo("clip-mockup-voice: done", {
          ready: marked,
          changedMeanwhile: todo.length - marked,
        });
      })
    ),
  afterFinalFailure: (params, failure) =>
    Effect.gen(function* () {
      const voice = yield* ClipMockupVoiceOperationsService;
      const failed = yield* voice.markVoiceFailed({
        ids: params.clipMockupIds,
        jobId: failure.jobId,
        error: failure.message,
      });
      yield* Effect.logError(
        "clip-mockup-voice: no attempt left; marked failed",
        { clipMockupIds: failed, error: failure.message }
      );
    }),
});
