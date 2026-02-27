import { Command, FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Config, Data, Effect, Option, Schema } from "effect";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "os";
import OpenAI from "openai";
import { FFmpegCommandsService } from "./ffmpeg-commands";
import { findSilenceInVideo } from "./silence-detection";

export type BeatType = "none" | "long";

const TRANSCRIPTION_PERMITS = 20;
const AUTO_EDITED_VIDEO_FINAL_END_PADDING = 0.5;

const FUSCRIPT_LOCATION =
  "/mnt/d/Program\\ Files/Blackmagic\\ Design/DaVinci\\ Resolve/fuscript.exe";

const transcribeClipsSchema = Schema.Array(
  Schema.Struct({
    id: Schema.String,
    words: Schema.Array(
      Schema.Struct({
        start: Schema.Number,
        end: Schema.Number,
        text: Schema.String,
      })
    ),
    segments: Schema.Array(
      Schema.Struct({
        start: Schema.Number,
        end: Schema.Number,
        text: Schema.String,
      })
    ),
  })
);

class CouldNotTranscribeError extends Data.TaggedError(
  "CouldNotTranscribeError"
)<{
  cause: unknown;
  message: string;
}> {}

class CouldNotExtractAudioError extends Data.TaggedError(
  "CouldNotExtractAudioError"
)<{
  cause: unknown;
  message: string;
}> {}

class CouldNotRunDavinciResolveScriptError extends Data.TaggedError(
  "CouldNotRunDavinciResolveScriptError"
)<{
  cause: unknown;
  message: string;
}> {}

export class VideoProcessingService extends Effect.Service<VideoProcessingService>()(
  "VideoProcessingService",
  {
    effect: Effect.gen(function* () {
      const effectFs = yield* FileSystem.FileSystem;
      const ffmpegCommands = yield* FFmpegCommandsService;
      const transcriptionSemaphore = yield* Effect.makeSemaphore(
        TRANSCRIPTION_PERMITS
      );

      const openaiApiKey = yield* Config.string("OPENAI_API_KEY");
      const openai = new OpenAI({ apiKey: openaiApiKey });

      const getLatestOBSVideoClips = Effect.fn("getLatestOBSVideoClips")(
        function* (opts: {
          filePath: string | undefined;
          startTime: number | undefined;
        }) {
          if (!opts.filePath) {
            // Without a file path, fall back to the most recent OBS recording.
            const obsDir = yield* Config.string("OBS_RECORDING_DIR").pipe(
              Effect.orElseSucceed(() =>
                path.join(require("os").homedir(), "Videos")
              )
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
            });
          }

          return yield* findSilenceInVideo(ffmpegCommands, opts.filePath, {
            startTime: opts.startTime,
          });
        }
      );

      const exportVideoClips = Effect.fn("exportVideoClips")(function* (opts: {
        videoId: string;
        clips: {
          inputVideo: string;
          startTime: number;
          duration: number;
          beatType: BeatType;
        }[];
        shortsDirectoryOutputName: string | undefined;
        onStageChange?: (
          stage: "concatenating-clips" | "normalizing-audio"
        ) => void;
      }) {
        const FINISHED_VIDEOS_DIRECTORY = yield* Config.string(
          "FINISHED_VIDEOS_DIRECTORY"
        );

        // Create concatenated video using native FFmpeg
        opts.onStageChange?.("concatenating-clips");
        const concatenatedPath =
          yield* ffmpegCommands.createAndConcatenateVideoClipsSinglePass(
            opts.clips
          );

        // Normalize audio
        opts.onStageChange?.("normalizing-audio");
        const normalizedPath =
          yield* ffmpegCommands.normalizeAudio(concatenatedPath);

        // Move to final location
        const outputPath = path.join(
          FINISHED_VIDEOS_DIRECTORY,
          `${opts.videoId}.mp4`
        );

        yield* effectFs.makeDirectory(path.dirname(outputPath), {
          recursive: true,
        });
        yield* effectFs.rename(normalizedPath, outputPath);

        // Clean up intermediate file
        yield* effectFs
          .remove(concatenatedPath)
          .pipe(Effect.catchAll(() => Effect.void));

        return outputPath;
      });

      /**
       * Extract audio from a video clip segment using ffmpeg.
       */
      const extractAudioClip = Effect.fn("extractAudioClip")(function* (
        inputVideo: string,
        startTime: number,
        duration: number
      ) {
        const outputDir = path.join(tmpdir(), "whisper-audio");
        yield* effectFs.makeDirectory(outputDir, { recursive: true });

        const outputHash = crypto
          .createHash("sha256")
          .update(`${inputVideo}-${startTime}-${duration}`)
          .digest("hex")
          .slice(0, 12);
        const outputFile = path.join(outputDir, `${outputHash}.mp3`);

        yield* Effect.async<void, CouldNotExtractAudioError>((resume) => {
          const { exec } =
            require("child_process") as typeof import("child_process");
          exec(
            `ffmpeg -y -hide_banner -ss ${startTime} -t ${duration} -i "${inputVideo}" -vn -c:a libmp3lame -b:a 384k "${outputFile}"`,
            { maxBuffer: 50 * 1024 * 1024 },
            (error) => {
              if (error) {
                resume(
                  Effect.fail(
                    new CouldNotExtractAudioError({
                      cause: error,
                      message: `Failed to extract audio: ${error.message}`,
                    })
                  )
                );
              } else {
                resume(Effect.succeed(undefined));
              }
            }
          );
        });

        return outputFile;
      });

      /**
       * Transcribe a single audio file using OpenAI Whisper API.
       */
      const transcribeAudioFile = Effect.fn("transcribeAudioFile")(function* (
        audioPath: string
      ) {
        const response = yield* transcriptionSemaphore.withPermits(1)(
          Effect.tryPromise({
            try: async () => {
              const stream = fs.createReadStream(audioPath);
              return openai.audio.transcriptions.create({
                file: stream,
                model: "whisper-1",
                response_format: "verbose_json",
                timestamp_granularities: ["segment", "word"],
              });
            },
            catch: (e) =>
              new CouldNotTranscribeError({
                cause: e,
                message: `Whisper API call failed: ${e}`,
              }),
          })
        );

        return {
          segments: (response.segments ?? []).map((segment) => ({
            start: segment.start,
            end: segment.end,
            text: segment.text,
          })),
          words: (response.words ?? []).map((word) => ({
            start: word.start,
            end: word.end,
            text: word.word,
          })),
        };
      });

      const transcribeClips = Effect.fn("transcribeClips")(function* (
        clips: {
          id: string;
          inputVideo: string;
          startTime: number;
          duration: number;
        }[]
      ) {
        const results = yield* Effect.forEach(
          clips,
          (clip) =>
            Effect.gen(function* () {
              // Extract audio segment from video
              const audioPath = yield* extractAudioClip(
                clip.inputVideo,
                clip.startTime,
                clip.duration
              );

              // Transcribe the audio clip
              const transcription = yield* transcribeAudioFile(audioPath);

              // Clean up audio file
              yield* effectFs
                .remove(audioPath)
                .pipe(Effect.catchAll(() => Effect.void));

              return {
                id: clip.id,
                words: transcription.words,
                segments: transcription.segments,
              };
            }),
          { concurrency: "unbounded" }
        );

        return yield* Schema.decodeUnknown(transcribeClipsSchema)(results);
      });

      const getLastFrame = Effect.fn("getLastFrame")(function* (
        inputVideo: string,
        seekTo: number
      ) {
        const inputHash = crypto
          .createHash("sha256")
          .update(inputVideo + seekTo.toFixed(2))
          .digest("hex")
          .slice(0, 10);

        const folder = path.join(tmpdir(), "tt-cli-images");
        yield* effectFs.makeDirectory(folder, { recursive: true });

        const outputFile = path.join(folder, `${inputHash}.png`);

        const outputFileExists = yield* effectFs.exists(outputFile);

        if (outputFileExists) {
          return outputFile;
        }

        const command = Command.make(
          "ffmpeg",
          "-ss",
          seekTo.toFixed(2),
          "-i",
          inputVideo,
          "-frames:v",
          "1",
          outputFile
        );
        yield* Command.exitCode(command);

        return outputFile;
      });

      const getFirstFrame = Effect.fn("getFirstFrame")(function* (
        inputVideo: string,
        seekTo: number
      ) {
        const inputHash = crypto
          .createHash("sha256")
          .update("first-" + inputVideo + seekTo.toFixed(2))
          .digest("hex")
          .slice(0, 10);

        const folder = path.join(tmpdir(), "tt-cli-images");
        yield* effectFs.makeDirectory(folder, { recursive: true });

        const outputFile = path.join(folder, `${inputHash}.png`);

        const outputFileExists = yield* effectFs.exists(outputFile);

        if (outputFileExists) {
          return outputFile;
        }

        const command = Command.make(
          "ffmpeg",
          "-ss",
          seekTo.toFixed(2),
          "-i",
          inputVideo,
          "-frames:v",
          "1",
          outputFile
        );
        yield* Command.exitCode(command);

        return outputFile;
      });

      /**
       * Serialize clips into the format expected by the clip-and-append.lua script.
       */
      const serializeClipsForAppendScript = (
        clips: {
          startFrame: number;
          endFrame: number;
          videoIndex: number;
          trackIndex: number;
        }[]
      ) => {
        return clips
          .map(
            (clip) =>
              `${clip.startFrame}___${clip.endFrame}___${clip.videoIndex}___${clip.trackIndex}`
          )
          .join(":::");
      };

      /**
       * Run a DaVinci Resolve Lua script via fuscript.exe.
       */
      const runDavinciResolveScript = Effect.fn("runDavinciResolveScript")(
        function* (script: string, env: Record<string, string>) {
          const scriptPath = path.resolve(
            __dirname,
            "../../resources/resolve",
            script
          );

          // Convert to Windows UNC path for fuscript
          const windowsScriptPath = scriptPath.replace(
            /^\/home\/(\w+)/,
            (_, user) =>
              `\\\\\\\\wsl.localhost\\\\Ubuntu-24.04\\\\home\\\\${user}`
          );

          const envString = Object.entries(env)
            .map(([key, value]) => `${key}="${value}"`)
            .join(" ");

          return yield* Effect.async<
            { stdout: string; stderr: string },
            CouldNotRunDavinciResolveScriptError
          >((resume) => {
            const { exec } =
              require("child_process") as typeof import("child_process");
            exec(
              `${envString} ${FUSCRIPT_LOCATION} -q "${windowsScriptPath}"`,
              { maxBuffer: 50 * 1024 * 1024 },
              (error, stdout, stderr) => {
                if (error) {
                  resume(
                    Effect.fail(
                      new CouldNotRunDavinciResolveScriptError({
                        cause: error,
                        message: `Failed to run DaVinci Resolve script: ${error.message}`,
                      })
                    )
                  );
                } else {
                  resume(
                    Effect.succeed({
                      stdout: stdout.toString(),
                      stderr: stderr.toString(),
                    })
                  );
                }
              }
            );
          });
        }
      );

      const sendClipsToDavinciResolve = Effect.fn("sendClipsToDavinciResolve")(
        function* (opts: {
          timelineName: string;
          clips: {
            inputVideo: string;
            startTime: number;
            duration: number;
          }[];
        }) {
          const uniqueInputVideos = [
            ...new Set(opts.clips.map((clip) => clip.inputVideo)),
          ];

          const inputVideosMap = uniqueInputVideos.reduce(
            (acc, video, index) => {
              acc[video] = index;
              return acc;
            },
            {} as Record<string, number>
          );

          const firstInputVideo = uniqueInputVideos[0];
          if (!firstInputVideo) {
            return "";
          }

          const fps = yield* ffmpegCommands.getFPS(firstInputVideo);

          const serializedClips = serializeClipsForAppendScript(
            opts.clips.map((clip, index, array) => {
              const isLastClip = index === array.length - 1;
              const endPadding = isLastClip
                ? AUTO_EDITED_VIDEO_FINAL_END_PADDING
                : 0;
              return {
                startFrame: Math.floor(clip.startTime * fps),
                endFrame: Math.ceil(
                  (clip.startTime + clip.duration + endPadding) * fps
                ),
                videoIndex: inputVideosMap[clip.inputVideo]!,
                trackIndex: 1,
              };
            })
          );

          const result = yield* runDavinciResolveScript("clip-and-append.lua", {
            NEW_TIMELINE_NAME: opts.timelineName,
            INPUT_VIDEOS: uniqueInputVideos.join(":::"),
            CLIPS_TO_APPEND: serializedClips,
            WSLENV: "INPUT_VIDEOS/p:CLIPS_TO_APPEND:NEW_TIMELINE_NAME",
          });

          return result.stdout;
        }
      );

      return {
        getLatestOBSVideoClips,
        exportVideoClips,
        transcribeClips,
        getLastFrame,
        getFirstFrame,
        sendClipsToDavinciResolve,
      };
    }),
    dependencies: [NodeContext.layer, FFmpegCommandsService.Default],
  }
) {}
