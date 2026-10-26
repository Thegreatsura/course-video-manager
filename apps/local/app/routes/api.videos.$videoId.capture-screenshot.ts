import { Effect, Schema } from "effect";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { FFmpegCommandsService } from "@/services/ffmpeg-commands";
import { makeAction } from "@/services/route-action.server";
import { getVideoFilePath, videoFileExists } from "@/services/video-files";
import { FileSystem } from "@effect/platform";
import path from "node:path";
import { SCENES } from "@/packages/scene-layout";
import { VIDEO_FORMATS } from "@cvm/core/features/videos/video-format";
import { resolveClipFrameFiles } from "@/services/clip-source-files.server";
import { storageRootsConfig } from "@/services/storage-roots";

const Fraction = Schema.Number.pipe(Schema.between(0, 1));

/**
 * A `ClipFrame` from `@/packages/clip-source`: the picker never names a file.
 * A CVM-recorder Clip's is its screen frame alone (No face, the default),
 * that frame cut to the Diagram Frame (Diagram), or the composite (With
 * face), drawn from its screen and camera in its Recording Session's Video
 * Format.
 */
const RequestSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("footage"),
    inputVideo: Schema.String,
    time: Schema.Number,
  }),
  Schema.Struct({
    kind: Schema.Literal("screen"),
    screen: Schema.String,
    time: Schema.Number,
    // Diagram or Custom: its crop, as fractions of the screen frame.
    crop: Schema.optional(
      Schema.Struct({
        x: Fraction,
        y: Fraction,
        w: Fraction,
        h: Fraction,
      })
    ),
  }),
  Schema.Struct({
    kind: Schema.Literal("composite"),
    format: Schema.optionalWith(Schema.Literal(...VIDEO_FORMATS), {
      default: () => "landscape",
    }),
    // Null for a camera-only Short Recording Session.
    screen: Schema.NullOr(Schema.String),
    camera: Schema.String,
    scene: Schema.Literal(...SCENES),
    time: Schema.Number,
  })
);

export const action = makeAction({
  input: "json",
  errors: {
    NotFoundError: 404,
    StorageFileNotFoundError: 404,
    FFmpegError: 500,
  },
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
        // Any store: a legacy or other-drive screenshot-1.png is taken too.
        const exists = yield* videoFileExists(video.lineageId, filename);
        if (!exists) break;
        counter++;
      } while (true);

      const outputPath = path.join(baseDir, filename);

      // The picker names stored paths; ffmpeg opens the files on disk.
      const onDisk = yield* resolveClipFrameFiles(
        frame,
        yield* storageRootsConfig
      );
      yield* ffmpeg.captureFrameAtTime(onDisk, outputPath);

      return { imagePath: `./${filename}` };
    }),
});
