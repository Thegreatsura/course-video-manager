import { Effect } from "effect";

const GPU_PERMITS = 6;
const CPU_PERMITS = 12;

/**
 * ffmpeg's process-wide limits: 6 GPU and 12 CPU encodes at once. One
 * instance per process, shared by the interactive commands
 * (`FFmpegCommandsService`) and the Sidecar's encodes (`FFmpegEncodeService`),
 * so splitting the two services did not double either limit.
 */
export class FfmpegPermitsService extends Effect.Service<FfmpegPermitsService>()(
  "FfmpegPermitsService",
  {
    effect: Effect.gen(function* () {
      return {
        gpuSemaphore: yield* Effect.makeSemaphore(GPU_PERMITS),
        cpuSemaphore: yield* Effect.makeSemaphore(CPU_PERMITS),
      };
    }),
  }
) {}
