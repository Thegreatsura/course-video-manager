import { FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Config, Effect, Option } from "effect";
import crypto from "node:crypto";
import path from "node:path";
import { homedir, tmpdir } from "os";
import { FFmpegCommandsService } from "./ffmpeg-commands";
import { findSilenceInVideo } from "./silence-detection";
import { VideoEditorLoggerService } from "./video-editor-logger-service";
import type { SilenceLength } from "@/silence-detection-constants";
import { clipFrameFfmpegArgs, type ClipFrame } from "@/packages/clip-source";

export type PauseType = "none" | "long";

export class VideoProcessingService extends Effect.Service<VideoProcessingService>()(
  "VideoProcessingService",
  {
    effect: Effect.gen(function* () {
      const effectFs = yield* FileSystem.FileSystem;
      const ffmpegCommands = yield* FFmpegCommandsService;

      const getLatestOBSVideoClips = Effect.fn("getLatestOBSVideoClips")(
        function* (opts: {
          filePath: string | undefined;
          startTime: number | undefined;
          silenceLength?: SilenceLength;
          /** The threshold the take was recorded under. */
          thresholdDb?: number;
        }) {
          if (!opts.filePath) {
            // Without a file path, fall back to the most recent OBS recording.
            const obsDir = yield* Config.string("OBS_RECORDING_DIR").pipe(
              Effect.orElseSucceed(() => path.join(homedir(), "Videos"))
            );

            // Find the most recent .mp4 file
            const files = yield* effectFs.readDirectory(obsDir);
            const mp4Files = files.filter((f) => f.endsWith(".mp4"));
            if (mp4Files.length === 0) {
              return {
                clips: [] as {
                  inputVideo: string;
                  startTime: number;
                  endTime: number;
                }[],
              };
            }

            // Sort by modification time (most recent first)
            const filesWithStats = yield* Effect.forEach(mp4Files, (file) =>
              Effect.gen(function* () {
                const fullPath = path.join(obsDir, file);
                const stat = yield* effectFs.stat(fullPath);
                const mtimeMs = Option.match(stat.mtime, {
                  onNone: () => 0,
                  onSome: (d) => d.getTime(),
                });
                return { file: fullPath, mtimeMs };
              })
            );
            filesWithStats.sort((a, b) => b.mtimeMs - a.mtimeMs);

            const latestFile = filesWithStats[0]!.file;
            return yield* findSilenceInVideo(ffmpegCommands, latestFile, {
              startTime: opts.startTime,
              silenceLength: opts.silenceLength,
              thresholdDb: opts.thresholdDb,
            });
          }

          return yield* findSilenceInVideo(ffmpegCommands, opts.filePath, {
            startTime: opts.startTime,
            silenceLength: opts.silenceLength,
            thresholdDb: opts.thresholdDb,
          });
        }
      );

      /**
       * Renders a still to a cached PNG. An OBS Clip's frame is cached under
       * its file and time as it always was; a composite under the whole frame.
       */
      const renderStill = Effect.fn("renderStill")(function* (
        frame: ClipFrame,
        cacheKeyPrefix: string
      ) {
        const seek = frame.time.toFixed(2);
        const inputHash = crypto
          .createHash("sha256")
          .update(
            cacheKeyPrefix +
              (frame.kind === "footage"
                ? frame.inputVideo + seek
                : JSON.stringify({ ...frame, time: seek }))
          )
          .digest("hex")
          .slice(0, 10);

        const folder = path.join(tmpdir(), "tt-cli-images");
        yield* effectFs.makeDirectory(folder, { recursive: true });

        const outputFile = path.join(folder, `${inputHash}.png`);

        const outputFileExists = yield* effectFs.exists(outputFile);

        if (outputFileExists) {
          return outputFile;
        }

        yield* ffmpegCommands.runStill([
          ...clipFrameFfmpegArgs(frame, { seek }),
          "-frames:v",
          "1",
          outputFile,
        ]);

        return outputFile;
      });

      const getLastFrame = (frame: ClipFrame) => renderStill(frame, "");

      const getFirstFrame = (frame: ClipFrame) => renderStill(frame, "first-");

      return {
        getLatestOBSVideoClips,
        /**
         * The container duration of a finished file, in seconds.
         *
         * The export step needs this for a file it did not just render — the
         * export it finds already on disk and would otherwise skip. It has to
         * come through this service rather than from ffprobe directly, because
         * this is the seam a Publish test replaces.
         */
        getVideoDurationInSeconds: ffmpegCommands.getVideoDurationInSeconds,
        getLastFrame,
        getFirstFrame,
      };
    }),
    dependencies: [
      NodeContext.layer,
      FFmpegCommandsService.Default,
      VideoEditorLoggerService.Default,
    ],
  }
) {}
