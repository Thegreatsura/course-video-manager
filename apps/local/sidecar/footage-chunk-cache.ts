import { FileSystem } from "@effect/platform";
import { Effect, Schema } from "effect";
import path from "node:path";
import type { FootageChunkCache } from "@/services/footage-transcription";
import { sidecarPathFor } from "@/services/footage-cache";

/**
 * The `transcribe-footage` Job's resume point: how the file is cut, and each
 * chunk Whisper has transcribed, kept on disk beside the footage until the
 * whole transcript is written. A run cut off by a Sidecar restart picks up
 * where it stopped — the full audio is not extracted, silence not detected,
 * and a finished chunk not extracted or sent to Whisper again.
 *
 * `<path>.transcript.partial/<source hash>/plan.json` and
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

const CachedPlan = Schema.parseJson(
  Schema.Union(
    Schema.Struct({ whole: Schema.Literal(true) }),
    Schema.Struct({
      whole: Schema.Literal(false),
      boundaries: Schema.Array(
        Schema.Struct({ start: Schema.Number, end: Schema.Number })
      ),
    })
  )
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
  /** Written whole, then renamed: a run killed mid-write leaves no half file. */
  const write = (file: string, contents: string, what: string) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      yield* fs.makeDirectory(dir, { recursive: true });
      const tmp = `${file}.tmp`;
      yield* fs.writeFileString(tmp, contents);
      yield* fs.rename(tmp, file);
    }).pipe(
      Effect.catchAll((error) =>
        Effect.logWarning("transcribe-footage: could not cache", {
          what,
          error: String(error),
        })
      )
    );
  const read = <A>(file: string, schema: Schema.Schema<A, string>) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      return yield* Schema.decode(schema)(yield* fs.readFileString(file));
    }).pipe(Effect.orElseSucceed(() => null));
  const planFile = path.join(dir, "plan.json");
  return {
    getPlan: read(planFile, CachedPlan),
    putPlan: (plan) => write(planFile, JSON.stringify(plan), "plan"),
    get: (chunk) => read(fileOf(chunk.key), CachedChunk),
    put: (chunk, transcript) =>
      write(fileOf(chunk.key), JSON.stringify(transcript), chunk.key),
    clear: Effect.flatMap(FileSystem.FileSystem, (fs) =>
      fs.remove(partialDirFor(sourcePath), { recursive: true })
    ).pipe(Effect.ignore),
  };
};
