import { Command, FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Config, Data, Effect, Schema } from "effect";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "os";
import OpenAI from "openai";
import { FFmpegCommandsService } from "./ffmpeg-commands";
import { transcribeFootage } from "./footage-transcription";
import { SidecarContext } from "./sidecar-context";
import { removeBestEffort } from "@/services/remove-best-effort";

const TRANSCRIPTION_PERMITS = 20;

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

/**
 * **Whisper transcription**: ffmpeg extracts the audio, OpenAI's Whisper
 * transcribes it, at most 20 calls at once (the permits are this service's,
 * shared by every caller in the process).
 *
 * Sidecar only (docs/plans/background-jobs-sidecar.md, batch 7): a Clip
 * transcription (the `transcribe-clips` Job) and the vertical Short's
 * subtitles (the `render-vertical` Job) ask for `SidecarContext`, only the
 * Sidecar's layer (`sidecar/sidecar-layer.ts`) builds this service, and no
 * module a route can reach may import it (`.dependency-cruiser.spawn.cjs`).
 * The one other caller is `cvm footage transcribe`, which builds it in its own
 * CLI layer on the author's machine: never a request.
 */
export class WhisperTranscriptionService extends Effect.Service<WhisperTranscriptionService>()(
  "WhisperTranscriptionService",
  {
    effect: Effect.gen(function* () {
      const effectFs = yield* FileSystem.FileSystem;
      const ffmpegCommands = yield* FFmpegCommandsService;
      const transcriptionSemaphore = yield* Effect.makeSemaphore(
        TRANSCRIPTION_PERMITS
      );

      const openaiApiKey = yield* Config.string("OPENAI_API_KEY");
      const openai = new OpenAI({ apiKey: openaiApiKey });

      /** ffmpeg writes `inputVideo`'s audio (or a range of it) as an mp3. */
      const extractAudio = Effect.fn("extractAudio")(function* (
        inputVideo: string,
        range: { startTime: number; duration: number } | undefined
      ) {
        const outputDir = path.join(tmpdir(), "whisper-audio");
        yield* effectFs.makeDirectory(outputDir, { recursive: true });

        const outputHash = crypto
          .createHash("sha256")
          .update(
            range
              ? `${inputVideo}-${range.startTime}-${range.duration}`
              : `${inputVideo}-full-audio`
          )
          .digest("hex")
          .slice(0, 12);
        const outputFile = path.join(outputDir, `${outputHash}.mp3`);

        const rangeArgs = range
          ? ["-ss", range.startTime.toString(), "-t", range.duration.toString()]
          : [];

        const code = yield* Command.exitCode(
          Command.make(
            "ffmpeg",
            "-y",
            "-hide_banner",
            ...rangeArgs,
            "-i",
            inputVideo,
            "-vn",
            "-c:a",
            "libmp3lame",
            "-b:a",
            "384k",
            outputFile
          )
        ).pipe(
          Effect.mapError(
            (e) =>
              new CouldNotExtractAudioError({
                cause: e,
                message: `Failed to extract audio: ${e.message}`,
              })
          )
        );
        if (code !== 0) {
          return yield* new CouldNotExtractAudioError({
            cause: null,
            message: `Failed to extract audio, exit code: ${code}`,
          });
        }

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

      /** Each Clip's range of its recording, transcribed on its own. */
      const transcribeClips = Effect.fn("transcribeClips")(function* (
        clips: {
          id: string;
          inputVideo: string;
          startTime: number;
          duration: number;
        }[]
      ) {
        // A Clip transcription is a Job: only the Sidecar runs it.
        yield* SidecarContext;
        const results = yield* Effect.forEach(
          clips,
          (clip) =>
            Effect.gen(function* () {
              const audioPath = yield* extractAudio(clip.inputVideo, {
                startTime: clip.startTime,
                duration: clip.duration,
              });
              const transcription = yield* transcribeAudioFile(audioPath);
              yield* removeBestEffort(effectFs, audioPath);

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

      /**
       * Transcribe an entire, already-concatenated video in a single Whisper
       * pass. Extracts the full audio track (audio-only, so it stays well under
       * Whisper's 25MB upload limit even though the source video does not) and
       * transcribes it once.
       *
       * Unlike {@link transcribeClips}, the returned segment timestamps are on
       * the video's own final timeline, so downstream callers need no per-clip
       * offset — matching the original Total TypeScript renderer, which
       * transcribed a single concatenated audio file.
       */
      const transcribeVideoFile = Effect.fn("transcribeVideoFile")(function* (
        inputVideo: string
      ) {
        // The vertical Short's subtitles: part of the `render-vertical` Job.
        yield* SidecarContext;
        const audioPath = yield* extractAudio(inputVideo, undefined);
        const transcription = yield* transcribeAudioFile(audioPath);
        yield* removeBestEffort(effectFs, audioPath);
        return transcription;
      });

      /**
       * Transcribe a whole raw FOOTAGE file (see GLOSSARY.md "Footage"): a file on
       * disk that is not — and never becomes — a database row. The ffmpeg +
       * silence-chunking orchestration lives in {@link transcribeFootage}; it
       * reuses THIS service's {@link transcribeAudioFile} per chunk, so faking
       * WhisperTranscriptionService still fakes all of footage transcription.
       * Run by `cvm footage transcribe` only. No diarization, ever.
       */
      const transcribeFootageFile = (inputVideo: string) =>
        transcribeFootage({ ffmpegCommands, transcribeAudioFile }, inputVideo);

      return {
        transcribeClips,
        transcribeVideoFile,
        transcribeFootageFile,
      };
    }),
    dependencies: [NodeContext.layer, FFmpegCommandsService.Default],
  }
) {}
