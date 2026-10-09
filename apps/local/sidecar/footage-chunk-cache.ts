import { FileSystem } from "@effect/platform";
import { Effect, Schema } from "effect";
import path from "node:path";
import type { FootageChunkCache } from "@/services/footage-transcription";
import { sidecarPathFor } from "@/services/footage-cache";

/**
 * The `transcribe-footage` Job's resume point: each chunk Whisper has
 * transcribed, kept on disk beside the footage until the whole transcript is
 * written. A run cut off by a Sidecar restart picks up where it stopped — a
 * finished chunk is never extracted or sent to Whisper again.
 *
 * `<path>.transcript.partial/<source hash>/<chunk key>.json`: keyed by the
 * file's content hash (a re-recorded file never reuses the old file's chunks)
 * and by the chunk's own cut (the same file always cuts the same way). Gone
 * once the transcript (`<path>.transcript.json`) is written.
 */

const CachedChunk = Schema.parseJson(
  Schema.Struct({
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

/** Every chunk cached for `sourcePath`, whatever its hash. */
export const partialDirFor = (sourcePath: string): string =>
  sidecarPathFor(sourcePath).replace(/\.json$/, ".partial");

export const footageChunkCache = (
  sourcePath: string,
  sourceHash: string
): FootageChunkCache & {
  /** Drop every cached chunk of this file, once its transcript is written. */
  readonly clear: Effect.Effect<void, never, FileSystem.FileSystem>;
} => {
  const dir = path.join(partialDirFor(sourcePath), sourceHash);
  const fileOf = (key: string) => path.join(dir, `${key}.json`);
  return {
    get: (chunk) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const raw = yield* fs.readFileString(fileOf(chunk.key));
        return yield* Schema.decode(CachedChunk)(raw);
      }).pipe(Effect.orElseSucceed(() => null)),
    put: (chunk, transcript) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory(dir, { recursive: true });
        // Written whole, then renamed: a run killed mid-write leaves no half
        // chunk for the next run to trust.
        const tmp = `${fileOf(chunk.key)}.tmp`;
        yield* fs.writeFileString(tmp, JSON.stringify(transcript));
        yield* fs.rename(tmp, fileOf(chunk.key));
      }).pipe(
        Effect.catchAll((error) =>
          Effect.logWarning("transcribe-footage: could not cache a chunk", {
            chunk: chunk.key,
            error: String(error),
          })
        )
      ),
    clear: Effect.flatMap(FileSystem.FileSystem, (fs) =>
      fs.remove(partialDirFor(sourcePath), { recursive: true })
    ).pipe(Effect.ignore),
  };
};
