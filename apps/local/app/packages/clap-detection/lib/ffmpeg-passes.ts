import { Command } from "@effect/platform";
import { Chunk, Data, Effect, Stream } from "effect";
import { findStartUpGap, type StartUpGap } from "./audio-onsets";
import { hearClaps } from "./hear-claps";
import type { ClapMatch } from "./match";
import { MOTION_FILTERS, MOTION_KEY, parseMotion } from "./motion";

/**
 * THE TWO FFMPEG PASSES, offline, over an AV Calibration's files: the mic
 * decoded to mono 48 kHz PCM for its onsets, and the camera through
 * `MOTION_FILTERS` for its motion. The camera is cut to the
 * clap window, keeping the file's own timestamps; the mic is decoded from
 * its start to the window's end, so its start-up is checked for a gap too.
 * Every time is in file seconds.
 */

export type ClapWindow = { startSeconds: number; endSeconds: number };

export class ClapDetectionError extends Data.TaggedError("ClapDetectionError")<{
  readonly message: string;
}> {}

const SAMPLE_RATE = 48_000;

export const micOnsetArgs = (micFile: string, w: ClapWindow) => [
  "-hide_banner",
  "-nostats",
  "-v",
  "error",
  "-i",
  micFile,
  "-af",
  `atrim=end=${w.endSeconds}`,
  "-ac",
  "1",
  "-ar",
  String(SAMPLE_RATE),
  "-f",
  "f32le",
  "-",
];

export const cameraMotionArgs = (cameraFile: string, w: ClapWindow) => [
  "-hide_banner",
  "-nostats",
  "-v",
  "error",
  "-i",
  cameraFile,
  "-an",
  "-vf",
  [
    `trim=start=${w.startSeconds}:end=${w.endSeconds}`,
    ...MOTION_FILTERS,
    `metadata=mode=print:key=${MOTION_KEY}:file=-`,
  ].join(","),
  "-f",
  "null",
  "-",
];

const run = (args: string[]) =>
  Effect.scoped(
    Effect.gen(function* () {
      const process = yield* Command.start(Command.make("ffmpeg", ...args));
      const [stdout, stderr] = yield* Effect.all(
        [
          process.stdout.pipe(Stream.runCollect, Effect.map(Chunk.toArray)),
          process.stderr.pipe(Stream.decodeText(), Stream.mkString),
        ],
        { concurrency: 2 }
      );
      const code = yield* process.exitCode;
      if (code !== 0)
        return yield* new ClapDetectionError({
          message: `ffmpeg exited ${code}: ${stderr.trim().split(/\r?\n/).slice(-2).join(" ")}`,
        });
      return stdout;
    })
  ).pipe(
    Effect.catchTag("SystemError", "BadArgument", (e) =>
      Effect.fail(new ClapDetectionError({ message: e.message }))
    )
  );

const concat = (chunks: Uint8Array[]) => {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
};

/** What `detectClaps` answers: the claps, and whether the mic can be trusted. */
export type ClapDetection = ClapMatch & {
  /**
   * The mic's start-up gap, or null. With one the Mic Offset cannot be
   * trusted, so `micOffsetMs` is null though claps were found.
   */
  startUpGap: StartUpGap | null;
};

/**
 * The claps in an AV Calibration's mic and camera files (paths ffmpeg can
 * open) over the clap window.
 */
export const detectClaps = Effect.fn("detectClaps")(function* (o: {
  micFile: string;
  cameraFile: string;
  window: ClapWindow;
}) {
  const [pcm, motion] = yield* Effect.all(
    [
      run(micOnsetArgs(o.micFile, o.window)).pipe(Effect.map(concat)),
      run(cameraMotionArgs(o.cameraFile, o.window)).pipe(
        Effect.map((chunks) =>
          parseMotion(new TextDecoder().decode(concat(chunks)))
        )
      ),
    ],
    { concurrency: 2 }
  );
  const samples = new Float32Array(
    pcm.buffer,
    pcm.byteOffset,
    Math.floor(pcm.byteLength / 4)
  );
  const windowStart = Math.round(o.window.startSeconds * SAMPLE_RATE);
  const heard = hearClaps({
    samples: samples.subarray(windowStart),
    sampleRate: SAMPLE_RATE,
    startSeconds: windowStart / SAMPLE_RATE,
    motion,
  });
  const startUpGap = findStartUpGap(
    samples.subarray(0, windowStart),
    SAMPLE_RATE
  );
  return {
    claps: heard.claps,
    found: heard.found,
    spreadMs: heard.spreadMs,
    micOffsetMs: startUpGap ? null : heard.micOffsetMs,
    startUpGap,
  } satisfies ClapDetection;
});
