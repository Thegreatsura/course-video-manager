import { Effect } from "effect";
import { transcribeAndStoreClips } from "@/services/clip-transcription.server";
import { CLIP_TRANSCRIPTION_EVENTS } from "@/features/video-editor/transcribe-clips-response";
import { defineJobKind } from "../job-kind";
import { JOB_PARAMS } from "../job-params";
import { CLIP_TRANSCRIPTION_POLICY } from "../retry-policy";

export { CLIP_TRANSCRIPTION_EVENTS };

/**
 * **Clip transcription** (#12 in docs/plans/background-jobs-sidecar.md),
 * enqueued by the video editor: `transcribeAndStoreClips` — each
 * Clip through Whisper on its own, its text and Transcript Words stored, or
 * the Clip marked `failed` — driven by the Sidecar, so closing the tab no
 * longer leaves Clips `transcribing`.
 *
 * A Clip that fails is a `clip-settled` event with `failed`, not a failed Job:
 * the editor's old `POST /clips/transcribe` never failed the batch for one
 * Clip either. 1 attempt, in the
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
      yield* ctx.emit(CLIP_TRANSCRIPTION_EVENTS.clipsStarted, {
        clipIds: [...params.clipIds],
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
