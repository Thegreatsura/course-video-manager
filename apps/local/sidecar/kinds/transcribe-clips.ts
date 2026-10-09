import { Effect } from "effect";
import { transcribeAndStoreClips } from "@/services/clip-transcription.server";
import { defineJobKind } from "../job-kind";
import { JOB_PARAMS } from "../job-params";
import { CLIP_TRANSCRIPTION_POLICY } from "../retry-policy";

/**
 * The Job Events a Clip transcription writes, beside the ones every Job has.
 */
export const CLIP_TRANSCRIPTION_EVENTS = {
  /**
   * One Clip landed, as `POST /clips/transcribe` answered it per Clip
   * (`TranscribedClip`): `{ id, transcriptionStatus: "done", text,
   * hasTranscriptWords }` or `{ id, transcriptionStatus: "failed" }`.
   */
  clipSettled: "clip-settled",
} as const;

/**
 * **Clip transcription** (#12 in docs/plans/background-jobs-sidecar.md): the
 * same `transcribeAndStoreClips` the `/clips/transcribe` route runs — each
 * Clip through Whisper on its own, its text and Transcript Words stored, or
 * the Clip marked `failed` — driven by the Sidecar, so closing the tab no
 * longer leaves Clips `transcribing`.
 *
 * A Clip that fails is a `clip-settled` event with `failed`, not a failed Job:
 * the route never failed the batch for one Clip either. 1 attempt, in the
 * default lane (`CLIP_TRANSCRIPTION_POLICY`).
 */
export const transcribeClipsJobKind = defineJobKind({
  ...CLIP_TRANSCRIPTION_POLICY,
  params: JOB_PARAMS["transcribe-clips"],
  run: (params, ctx) =>
    Effect.gen(function* () {
      yield* Effect.logInfo("transcribe-clips: started", {
        clipIds: params.clipIds,
      });
      const clips = yield* transcribeAndStoreClips(params.clipIds, {
        onClipSettled: (clip) =>
          ctx.emit(CLIP_TRANSCRIPTION_EVENTS.clipSettled, { ...clip }),
      });
      yield* Effect.logInfo("transcribe-clips: done", {
        done: clips.filter((c) => c.transcriptionStatus === "done").length,
        failed: clips.filter((c) => c.transcriptionStatus === "failed").length,
      });
    }),
});
