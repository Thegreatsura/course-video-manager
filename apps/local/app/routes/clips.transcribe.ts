import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { VideoProcessingService } from "@/services/video-processing-service";
import { Effect, Schema } from "effect";
import { makeAction } from "@/services/route-action.server";
import type { TranscribedClip } from "@/features/video-editor/transcribe-clips-response";

const transcribeClipsSchema = Schema.Struct({
  clipIds: Schema.Array(Schema.String),
});

export const action = makeAction({
  input: "json",
  effect: ({ payload: json }) => {
    return Effect.gen(function* () {
      const clipOps = yield* ClipOperationsService;
      const videoProcessing = yield* VideoProcessingService;

      const { clipIds } = yield* Schema.decodeUnknown(transcribeClipsSchema)(
        json
      );

      const clips = yield* clipOps.getClipsByIds(clipIds);

      yield* clipOps.setTranscriptionStatus(
        clips.map((clip) => clip.id),
        "transcribing"
      );

      // Each Clip is transcribed on its own, so one that fails is marked
      // `failed` and the rest still land, rather than one bad Clip failing the
      // whole batch and leaving every Clip in it "transcribing".
      return yield* Effect.forEach(
        clips,
        (clip) =>
          Effect.gen(function* () {
            const [transcribedClip] = yield* videoProcessing.transcribeClips([
              {
                id: clip.id,
                inputVideo: clip.videoFilename,
                startTime: clip.sourceStartTime,
                duration: clip.sourceEndTime - clip.sourceStartTime,
              },
            ]);

            const updated = yield* clipOps.updateClip(clip.id, {
              text: (transcribedClip?.segments ?? [])
                .map((segment) => segment.text)
                .join(" "),
              transcribedAt: new Date(),
              transcriptionStatus: "done",
            });

            // Whisper's word timing is CLIP-RELATIVE here already (the audio
            // was extracted for this clip's range), so it is stored as-is.
            // Every transcription replaces the clip's Transcript Words
            // wholesale, so a re-transcribe never leaves words from the
            // previous take behind.
            const words = yield* clipOps.replaceTranscriptWords(
              clip.id,
              transcribedClip?.words ?? []
            );

            // The editor's "missing word timing" warning needs to know whether
            // this Transcription gave the Clip any words (see
            // transcript-word-status.ts), without a second round trip.
            return {
              id: updated.id,
              transcriptionStatus: "done",
              text: updated.text,
              hasTranscriptWords: words.length > 0,
            } satisfies TranscribedClip;
          }).pipe(
            Effect.tapError((error) =>
              Effect.logWarning(
                `Transcription failed for clip ${clip.id}`,
                error
              )
            ),
            Effect.catchAll(() =>
              clipOps.setTranscriptionStatus([clip.id], "failed").pipe(
                Effect.as({
                  id: clip.id,
                  transcriptionStatus: "failed",
                } satisfies TranscribedClip)
              )
            )
          ),
        { concurrency: "unbounded" }
      );
    });
  },
});
