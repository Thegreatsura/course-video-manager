import { Effect } from "effect";
import { ClipMockupVoiceOperationsService } from "@/services/db-clip-mockup-voice-operations.server";
import { writeClipMockupFile } from "@/services/clip-mockup-files";
import { resolveClipMockupSpeeches } from "@/services/resolve-clip-mockup-speech";
import { defineJobKind } from "../job-kind";
import { JOB_PARAMS } from "../job-params";
import { CLIP_MOCKUP_VOICE_POLICY } from "../retry-policy";

/** Why a run failed, in one line for the Clip Mockup's `voiceError`. */
const messageOf = (error: unknown): string =>
  typeof error === "object" &&
  error !== null &&
  "message" in error &&
  typeof error.message === "string" &&
  error.message !== ""
    ? error.message
    : String(error);

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
 * (`CLIP_MOCKUP_VOICE_POLICY`: 3). The last one marks every Clip Mockup it
 * still holds `failed`, with the reason, and fails the Job; `cvm clip-mockup
 * update` on one queues it again. No toast when it succeeds: a Clip Mockup
 * shows its own voice, as a Clip shows its own transcription.
 */
export const clipMockupVoiceJobKind = defineJobKind({
  ...CLIP_MOCKUP_VOICE_POLICY,
  params: JOB_PARAMS["clip-mockup-voice"],
  run: (params, ctx) =>
    Effect.gen(function* () {
      const voice = yield* ClipMockupVoiceOperationsService;
      const rows = yield* voice.listClipMockupsToVoice(params.clipMockupIds);
      const todo = rows.filter((r) => !r.archived && r.voiceStatus !== "ready");
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

      const voiced = yield* Effect.gen(function* () {
        const { speeches, files } = yield* resolveClipMockupSpeeches(
          todo.map((r) => ({ lineageId: r.lineageId, line: r.line }))
        );
        // Every WAV before any row says `ready`: a row whose audioPath
        // points at nothing is the one state nobody can see or fix.
        for (const file of files) {
          yield* writeClipMockupFile(file.lineageId, file.audioPath, file.wav);
        }
        return speeches;
      }).pipe(
        Effect.tapError((error) =>
          ctx.attempt < ctx.maxAttempts
            ? Effect.logWarning("clip-mockup-voice: attempt failed", {
                error: messageOf(error),
              })
            : Effect.forEach(
                todo,
                (row) =>
                  voice.markVoiceFailed({
                    id: row.id,
                    line: row.line,
                    error: messageOf(error),
                  }),
                { discard: true }
              ).pipe(
                Effect.zipRight(
                  Effect.logError(
                    "clip-mockup-voice: no attempt left; marked failed",
                    { error: messageOf(error) }
                  )
                ),
                Effect.catchAll((cause) =>
                  Effect.logError(
                    "clip-mockup-voice: could not mark the Clip Mockups failed",
                    { cause: messageOf(cause) }
                  )
                )
              )
        )
      );

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
    }),
});
