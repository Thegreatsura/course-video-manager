import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { VideoProcessingService } from "@/services/video-processing-service";
import { Effect, Schema } from "effect";
import { makeAction } from "@/services/route-action.server";

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

      const transcribedClips = yield* videoProcessing.transcribeClips(
        clips.map((clip) => ({
          id: clip.id,
          inputVideo: clip.videoFilename,
          startTime: clip.sourceStartTime,
          duration: clip.sourceEndTime - clip.sourceStartTime,
        }))
      );

      const updatedClips = yield* Effect.forEach(
        transcribedClips,
        Effect.fn(function* (transcribedClip) {
          const updated = yield* clipOps.updateClip(transcribedClip.id, {
            text: transcribedClip.segments
              .map((segment) => segment.text)
              .join(" "),
            transcribedAt: new Date(),
          });

          // Whisper's word timing is CLIP-RELATIVE here already (the audio was
          // extracted for this clip's range), so it is stored as-is. Every
          // transcription replaces the clip's Transcript Words wholesale, so a
          // re-transcribe never leaves words from the previous take behind.
          yield* clipOps.replaceTranscriptWords(
            transcribedClip.id,
            transcribedClip.words
          );

          return updated;
        })
      );

      return updatedClips;
    });
  },
});
