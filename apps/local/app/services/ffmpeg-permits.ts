import { Config, Effect } from "effect";

export const DEFAULT_GPU_PERMITS = 6;
export const DEFAULT_CPU_PERMITS = 12;

const permits = (name: string, fallback: number) =>
  Config.integer(name).pipe(
    Config.withDefault(fallback),
    Config.validate({
      message: `${name} must be at least 1`,
      validation: (value) => value >= 1,
    })
  );

/**
 * ffmpeg's process-wide limits: 6 GPU and 12 CPU encodes at once. One
 * instance per process, shared by the interactive commands
 * (`FFmpegCommandsService`) and the Sidecar's encodes (`FFmpegEncodeService`),
 * so splitting the two services did not double either limit.
 *
 * `FFMPEG_GPU_PERMITS` / `FFMPEG_CPU_PERMITS` lower them. Matt's machine
 * sets neither; a verify-cvm clone run sets both to 1, so an agent's stray
 * encode of a real course runs one ffmpeg at a time instead of six.
 */
export class FfmpegPermitsService extends Effect.Service<FfmpegPermitsService>()(
  "FfmpegPermitsService",
  {
    effect: Effect.gen(function* () {
      const gpuPermits = yield* permits(
        "FFMPEG_GPU_PERMITS",
        DEFAULT_GPU_PERMITS
      );
      const cpuPermits = yield* permits(
        "FFMPEG_CPU_PERMITS",
        DEFAULT_CPU_PERMITS
      );
      return {
        gpuPermits,
        cpuPermits,
        gpuSemaphore: yield* Effect.makeSemaphore(gpuPermits),
        cpuSemaphore: yield* Effect.makeSemaphore(cpuPermits),
      };
    }).pipe(Effect.orDie),
  }
) {}
