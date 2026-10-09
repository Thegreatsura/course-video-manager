import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import type { FFmpegCommandsService } from "./ffmpeg-commands";
import { findSilenceInVideo } from "./silence-detection";
import {
  mergeChunkTranscripts,
  planChunkBoundaries,
  type FootageTranscript,
} from "./footage-chunking";
import { removeBestEffort } from "@/services/remove-best-effort";

/**
 * Whole-file **Footage** transcription — the chunking orchestration behind
 * `WhisperTranscriptionService.transcribeFootageFile`. Split out of that
 * service purely to keep it under the repo's per-file token budget; it is not a
 * seam. It starts no process of its own: the audio comes from the service's
 * `extractAudio` and every chunk goes through its `transcribeAudioFile` (the
 * Whisper call, with its permits and API key), so the whole thing stays
 * fakeable by faking WhisperTranscriptionService.
 *
 * DELIBERATELY SEPARATE from the per-clip transcription path: the audio here is
 * mono 64kbps (small enough that most files upload in one Whisper pass), never
 * the 384kbps stereo a Clip's audio is extracted as.
 */

/**
 * Whisper refuses an upload over 25MB. Footage whose extracted mono-64kbps audio
 * exceeds this is transcribed in silence-aligned chunks; anything at or under it
 * is one pass.
 */
const WHISPER_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * One piece of a footage file Whisper hears on its own: the whole file
 * (`key: "whole"`), or a silence-aligned `[start, end)` window of a long one.
 */
export interface FootageChunk {
  /** Stable for the same file and the same cut: what the chunk cache is keyed by. */
  readonly key: string;
  readonly index: number;
  readonly count: number;
  readonly start: number;
  readonly end: number | null;
}

/**
 * Where finished chunks are kept so a run that is cut off (the Sidecar
 * restarting) resumes rather than paying Whisper for them again. Both are best
 * effort: a cache that cannot be read is a miss, one that cannot be written
 * costs only the resume.
 */
export interface FootageChunkCache {
  readonly get: (
    chunk: FootageChunk
  ) => Effect.Effect<FootageTranscript | null, never, FileSystem.FileSystem>;
  readonly put: (
    chunk: FootageChunk,
    transcript: FootageTranscript
  ) => Effect.Effect<void, never, FileSystem.FileSystem>;
}

export interface TranscribeFootageOptions {
  readonly cache?: FootageChunkCache;
  /** Called once per chunk as it settles, from the cache or from Whisper. */
  readonly onChunk?: (
    chunk: FootageChunk & { readonly cached: boolean }
  ) => Effect.Effect<void>;
}

/**
 * Transcribe a whole raw footage file. Extracts the full audio (mono 64k); if it
 * fits under Whisper's 25MB cap it is one pass, otherwise the file is split into
 * ~27-minute chunks cut at detected silence (never mid-word), each transcribed
 * on its own, and the pieces' timestamps offset back onto the file's timeline
 * and merged. No diarization, ever. A chunk already in `options.cache` is not
 * extracted or sent to Whisper again.
 */
export const transcribeFootage = <EA, RA, ET, RT>(
  deps: {
    readonly ffmpegCommands: FFmpegCommandsService;
    /** ffmpeg writes the file's audio (or a range of it) as mono 64k mp3. */
    readonly extractAudio: (
      inputVideo: string,
      range: { startTime: number; duration: number } | undefined
    ) => Effect.Effect<string, EA, RA>;
    readonly transcribeAudioFile: (
      audioPath: string
    ) => Effect.Effect<FootageTranscript, ET, RT>;
  },
  inputVideo: string,
  options: TranscribeFootageOptions = {}
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    /** A chunk from the cache, or extracted, through Whisper, and cached. */
    const transcribeChunk = (
      chunk: FootageChunk,
      audio: Effect.Effect<string, EA, RA>
    ) =>
      Effect.gen(function* () {
        const cached = options.cache ? yield* options.cache.get(chunk) : null;
        if (cached) {
          yield* options.onChunk?.({ ...chunk, cached: true }) ?? Effect.void;
          return cached;
        }
        const audioPath = yield* audio;
        const transcription = yield* deps.transcribeAudioFile(audioPath);
        yield* removeBestEffort(fs, audioPath);
        if (options.cache) yield* options.cache.put(chunk, transcription);
        yield* options.onChunk?.({ ...chunk, cached: false }) ?? Effect.void;
        return transcription;
      });

    const fullAudio = yield* deps.extractAudio(inputVideo, undefined);
    const stat = yield* fs.stat(fullAudio);

    if (Number(stat.size) <= WHISPER_MAX_UPLOAD_BYTES) {
      const whole: FootageChunk = {
        key: "whole",
        index: 0,
        count: 1,
        start: 0,
        end: null,
      };
      const transcription = yield* transcribeChunk(
        whole,
        Effect.succeed(fullAudio)
      );
      yield* removeBestEffort(fs, fullAudio);
      return transcription;
    }

    // Too large for one upload: split at silence near the target size.
    const durationSeconds =
      yield* deps.ffmpegCommands.getVideoDurationInSeconds(fullAudio);
    yield* removeBestEffort(fs, fullAudio);
    const { clips } = yield* findSilenceInVideo(
      deps.ffmpegCommands,
      inputVideo
    );
    // The end of each speaking clip is where the file falls silent — the only
    // place it is safe to cut without splitting a spoken word.
    const silencePoints = clips.map((clip) => clip.endTime);
    const boundaries = planChunkBoundaries({ durationSeconds, silencePoints });

    // Sequential: transcribeAudioFile already bounds Whisper concurrency with a
    // semaphore, and chunking exists to stay UNDER a limit, not to fan one file
    // out across the whole permit budget.
    const chunks = yield* Effect.forEach(boundaries, (boundary, index) =>
      transcribeChunk(
        {
          key: `${boundary.start}-${boundary.end}`,
          index,
          count: boundaries.length,
          start: boundary.start,
          end: boundary.end,
        },
        deps.extractAudio(inputVideo, {
          startTime: boundary.start,
          duration: boundary.end - boundary.start,
        })
      ).pipe(
        Effect.map((transcription) => ({
          offset: boundary.start,
          words: transcription.words,
          segments: transcription.segments,
        }))
      )
    );

    return mergeChunkTranscripts(chunks);
  });
