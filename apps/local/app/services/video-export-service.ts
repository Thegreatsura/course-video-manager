import { FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import { FFmpegCommandsService } from "./ffmpeg-commands";
import { FFmpegEncodeService } from "./ffmpeg-encode-commands";
import { makeVideoExportPasses } from "./video-export-passes";
import { VideoEditorLoggerService } from "./video-editor-logger-service";

/**
 * A course export's ffmpeg passes — concat-and-normalize, then the Overlay
 * composite — and the probe that measures what came out. Every pass is an
 * encode, so this service is the **Sidecar's** alone: it is built only by
 * `sidecar/sidecar-layer.ts`, and its encodes ask for `SidecarContext`.
 *
 * It is also the seam a Publish test replaces (`course-publish-service-test-setup.ts`).
 */
export class VideoExportService extends Effect.Service<VideoExportService>()(
  "VideoExportService",
  {
    effect: Effect.gen(function* () {
      const effectFs = yield* FileSystem.FileSystem;
      const ffmpegCommands = yield* FFmpegCommandsService;
      const ffmpegEncode = yield* FFmpegEncodeService;
      const videoEditorLogger = yield* VideoEditorLoggerService;
      const { exportVideoClips, compositeOverlaysOntoExport } =
        makeVideoExportPasses({
          ffmpegEncode,
          ffmpegCommands,
          effectFs,
          videoEditorLogger,
        });
      return {
        exportVideoClips,
        compositeOverlaysOntoExport,
        /**
         * The container duration of a finished file, in seconds: the export
         * step measures a file it did not just render (one it found on disk)
         * through here, so a Publish test can replace it.
         */
        getVideoDurationInSeconds: ffmpegCommands.getVideoDurationInSeconds,
      };
    }),
    dependencies: [
      NodeContext.layer,
      FFmpegCommandsService.Default,
      FFmpegEncodeService.Default,
      VideoEditorLoggerService.Default,
    ],
  }
) {}
