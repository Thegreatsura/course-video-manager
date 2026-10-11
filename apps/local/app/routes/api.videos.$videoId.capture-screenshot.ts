import { Effect, Schema } from "effect";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { FFmpegCommandsService } from "@/services/ffmpeg-commands";
import { makeAction } from "@/services/route-action.server";
import { getVideoFilePath } from "@/services/video-files";
import { FileSystem } from "@effect/platform";
import path from "node:path";

/** A `ClipFrame` from `@/packages/clip-source`: the picker never names a file. */
const RequestSchema = Schema.Struct({
  inputVideo: Schema.String,
  time: Schema.Number,
});

export const action = makeAction({
  input: "json",
  errors: { NotFoundError: 404, FFmpegError: 500 },
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const frame = yield* Schema.decodeUnknown(RequestSchema)(payload);

      const videoOps = yield* VideoOperationsService;
      const ffmpeg = yield* FFmpegCommandsService;
      const fs = yield* FileSystem.FileSystem;

      const video = yield* videoOps.getVideoDeepById(params.videoId!);

      const baseDir = path.resolve(getVideoFilePath(video.lineageId));

      yield* fs.makeDirectory(baseDir, { recursive: true });
      let counter = 1;
      let filename: string;
      do {
        filename = `screenshot-${counter}.png`;
        const exists = yield* fs.exists(path.join(baseDir, filename));
        if (!exists) break;
        counter++;
      } while (true);

      const outputPath = path.join(baseDir, filename);

      yield* ffmpeg.captureFrameAtTime(
        frame.inputVideo,
        frame.time,
        outputPath
      );

      return { imagePath: `./${filename}` };
    }),
});
