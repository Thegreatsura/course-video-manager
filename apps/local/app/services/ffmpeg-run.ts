import { Command } from "@effect/platform";
import { Effect, Ref, Stream } from "effect";
import { registerFfmpegChild } from "./ffmpeg-child-registry";
import { createFfmpegProgressParser } from "./ffmpeg-progress";
import { appendBoundedTail, withStderrTail } from "./ffmpeg-log-capture";
import { SidecarContext } from "./sidecar-context";
import { FfmpegPermitsService } from "./ffmpeg-permits";
import {
  FFmpegError,
  landscapeCpuFallbackArgs,
  type FfmpegLogInfo,
} from "./ffmpeg-error";

/**
 * How every long ffmpeg ENCODE in this app is started, and the three things
 * every caller of one owes: bitexact output, a durable log, and a child that
 * dies when the fiber that owns it does.
 *
 * An encode is background work: it runs in the **Sidecar**, never in a request
 * (docs/plans/background-jobs-sidecar.md, the spawn guard). So this runner
 * asks for `SidecarContext`, and no module a route can reach may import it
 * (`.dependency-cruiser.cjs`, `spawn-runner-reachable-from-routes`).
 */

// Kept importable from here for the export's tests and passes.
export {
  BITEXACT_ARGS,
  LANDSCAPE_VIDEO_ENCODE_ARGS,
  FFmpegError,
  type FfmpegLogInfo,
} from "./ffmpeg-error";

/**
 * Run a long-lived ffmpeg encode with real progress reporting.
 *
 * `-progress pipe:1` makes ffmpeg emit key=value progress blocks on
 * stdout (which nothing else uses), parsed incrementally into integer
 * percents of `totalDurationSeconds` (see createFfmpegProgressParser for
 * the emission contract). `-nostats` drops the carriage-return stats
 * line from the inherited stderr, which otherwise duplicates the same
 * numbers as terminal noise.
 *
 * Runs under a scope, so fiber interruption (SSE disconnect, cancelled
 * publish) kills the child; the PID is also registered with the
 * parent-death backstop (see ffmpeg-child-registry) for the case where
 * the dev server itself dies without interrupting any fiber.
 *
 * Both stdout (progress) and stderr (diagnostics) are piped rather than
 * inherited, and BOTH are drained concurrently via a single
 * `Effect.all`. That concurrency is load-bearing, not incidental: a
 * piped OS stream that nobody reads fills its buffer (~64KB) and blocks
 * the writer, so draining stdout to completion before even starting to
 * drain stderr would recreate, on stderr, the exact hang this function
 * exists to prevent on stdout.
 *
 * Each drained chunk is handled in isolation — a throw anywhere
 * downstream of `onProgress` (most plausibly an SSE controller whose
 * client has gone away) must never stop that stream's loop. If it did,
 * nobody would read that pipe again, ffmpeg's next write to it would
 * block on a full buffer, and the encode would hang forever — a hang
 * invisible to `Effect.retry`, since a process that never exits never
 * resolves to a failure to retry.
 *
 * It is also where a landscape pass falls back from the GPU. A pass encoding
 * with `LANDSCAPE_VIDEO_ENCODE_ARGS` (h264_nvenc) that fails because NVENC
 * could not open — no CUDA context, no capable device — is run once more,
 * whole, on libx264 (`landscapeCpuFallbackArgs`), with a WARN in the Job's
 * log. Every caller gets it by construction; none decides for itself.
 *
 * And it is where the process-wide limit on heavy encodes is kept: every run
 * takes one of `FfmpegPermitsService`'s encode slots (default 2) for its whole
 * length, fallback included, and logs when it has to wait for one. A Publish,
 * a Batch export and a Short running side by side share those slots, so no
 * mix of Jobs can stack more encodes than that on the machine's memory
 * (Publish Job 859b8689: six 100-input concats at once ran it out of RAM).
 */
export const runFfmpegWithProgress = Effect.fn("runFfmpegWithProgress")(
  function* (opts: {
    args: string[];
    totalDurationSeconds: number;
    onProgress: ((percent: number) => void) | undefined;
    // Required, not optional: an omitted onLog silently drops the
    // per-video log this function exists to feed — see the
    // "optional parameters" note in CODING_STANDARDS.md.
    // A caller with nothing to do about it passes a no-op explicitly.
    onLog: (info: FfmpegLogInfo) => void;
    errorPrefix: string;
  }) {
    // An encode is a Job's: only the Sidecar provides this.
    yield* SidecarContext;
    const { withEncodeSlot } = yield* FfmpegPermitsService;
    const toError = (cause: unknown, detail: string, stderrTail: string) =>
      new FFmpegError({
        cause,
        message: withStderrTail(`${opts.errorPrefix}${detail}`, stderrTail),
      });

    // The slot is held across the fallback too: the libx264 re-run is the
    // hungrier of the two, and must not start outside the limit.
    yield* withEncodeSlot(opts.errorPrefix)(
      Effect.gen(function* () {
        const first = yield* runOnce(opts.args);
        if (first.code === 0) return;

        const fallbackArgs = landscapeCpuFallbackArgs(
          opts.args,
          first.stderrTail
        );
        if (!fallbackArgs) {
          return yield* toError(
            null,
            `, exit code: ${first.code}`,
            first.stderrTail
          );
        }

        yield* Effect.logWarning(
          "ffmpeg: h264_nvenc could not open (no usable GPU); running this pass again on libx264",
          { errorPrefix: opts.errorPrefix, exitCode: first.code }
        );
        const fallback = yield* runOnce(fallbackArgs);
        if (fallback.code !== 0) {
          return yield* toError(
            null,
            `, exit code: ${fallback.code} (on the libx264 fallback, after h264_nvenc could not open)`,
            fallback.stderrTail
          );
        }
      })
    );

    /** One ffmpeg run: its exit code and the tail of its stderr. */
    function runOnce(args: readonly string[]) {
      const commandLine = ["ffmpeg", ...args];
      return Effect.scoped(
        Effect.gen(function* () {
          const child = yield* Command.start(
            Command.make("ffmpeg", "-nostats", "-progress", "pipe:1", ...args)
          ).pipe(Effect.mapError((e) => toError(e, `: ${e.message}`, "")));

          yield* Effect.acquireRelease(
            Effect.sync(() => registerFfmpegChild(child.pid)),
            (unregister) => Effect.sync(unregister)
          );

          const parser = createFfmpegProgressParser({
            totalDurationSeconds: opts.totalDurationSeconds,
            onPercent: opts.onProgress ?? (() => {}),
          });

          // Drain stdout even when nobody listens — an unread pipe would
          // eventually block ffmpeg. The stream ends when the process
          // does. A failing chunk (see the function doc) is contained
          // right here, per chunk, so the loop keeps running instead of
          // Effect.ignore below only stopping it after the fact.
          const drainStdout = child.stdout.pipe(
            Stream.decodeText(),
            Stream.runForEach((chunk) =>
              Effect.sync(() => parser.push(chunk)).pipe(
                Effect.catchAllCause(() => Effect.void)
              )
            ),
            Effect.ignore
          );

          // Tee stderr to our own stderr (so a developer watching the
          // terminal sees what they always have) while accumulating a
          // bounded tail for the error message and the per-video log.
          // Written into a Ref rather than folded through the stream's
          // own return value: a Ref keeps whatever was captured so far
          // even if the stream itself dies partway (a decode error, a
          // closed fd) — the same per-chunk containment as stdout above,
          // so one bad chunk can't cost the whole tail.
          const stderrTailRef = yield* Ref.make("");
          const drainStderr = child.stderr.pipe(
            Stream.decodeText(),
            Stream.runForEach((chunk) =>
              Effect.sync(() => {
                try {
                  process.stderr.write(chunk);
                } catch {
                  // Best-effort tee only; never let a closed fd stop capture.
                }
              }).pipe(
                Effect.zipRight(
                  Ref.update(stderrTailRef, (tail) =>
                    appendBoundedTail(tail, chunk)
                  )
                ),
                Effect.catchAllCause(() => Effect.void)
              )
            ),
            Effect.ignore
          );

          yield* Effect.all([drainStdout, drainStderr], {
            concurrency: 2,
          });
          const stderrTail = yield* Ref.get(stderrTailRef);

          opts.onLog({ command: commandLine, stderrTail });

          const code = yield* child.exitCode.pipe(
            Effect.mapError((e) => toError(e, `: ${e.message}`, stderrTail))
          );
          return { code: Number(code), stderrTail };
        })
      );
    }
  }
);
