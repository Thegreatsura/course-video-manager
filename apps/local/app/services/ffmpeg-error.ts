import { Data } from "effect";

/**
 * What every ffmpeg caller shares, whichever process runs it: the error, the
 * log line, and the encode flags. It spawns nothing, so the app server's
 * interactive ffmpeg calls (`ffmpeg-commands.ts`) and the Sidecar's encodes
 * (`ffmpeg-encode-commands.ts`, through `ffmpeg-run.ts`) both import it.
 */

/** Emitted once a command has run (success or failure) so a caller that
 * knows the domain object (a videoId) can tee it into a durable, agent- and
 * human-readable log — see VideoEditorLoggerService's "cli-output" event. */
export type FfmpegLogInfo = { command: string[]; stderrTail: string };

/**
 * Written before every output file in the export pipeline, so that an export's
 * bytes are a function of its inputs and nothing else.
 *
 * Without these, ffmpeg stamps the running library versions into the file — an
 * `encoder=Lavf60.16.100` format tag and an `encoder=Lavc60.31.102 h264_nvenc`
 * stream tag. Neither changes a frame, but both change the SHA256 that the
 * published manifest carries and that AI Hero uses to decide whether a Video is
 * new. Upgrading ffmpeg would otherwise re-ingest the whole catalogue into Mux.
 *
 * They must go on every pass, not just the last: the stream tag is written by
 * the pass that encodes the stream and survives the later stream-copy.
 *
 * Reproducibility here is per-machine — same ffmpeg build, same driver, same
 * GPU. These flags remove the part that was gratuitously variable.
 */
export const BITEXACT_ARGS = [
  "-fflags",
  "+bitexact",
  "-flags:v",
  "+bitexact",
  "-flags:a",
  "+bitexact",
];

/**
 * How a landscape/course Video's picture is encoded — one answer, shared by
 * every pass in that export path.
 *
 * A course export is written twice when it carries Definition Cards: the
 * concat-and-scale pass makes the file, and the Overlay compositing pass
 * re-encodes it. If those two passes disagreed about the encoder, a Video with
 * an Overlay would ship with different characteristics from every Video
 * without one, and the second write would be a CPU re-encode of a
 * GPU-encoded 40-minute file. They read this constant so they cannot.
 *
 * The vertical Shorts pipeline deliberately does NOT use it. Its subtitle
 * burn-in is libx264 at CRF 18, and its bytes must not move.
 *
 * When NVENC cannot open at all (no usable GPU), the pass is re-run with
 * {@link LANDSCAPE_VIDEO_CPU_FALLBACK_ENCODE_ARGS} instead — decided in one
 * place, `runFfmpegWithProgress`, never by a caller.
 */
export const LANDSCAPE_VIDEO_ENCODE_ARGS = [
  "-c:v",
  "h264_nvenc",
  "-preset",
  "slow",
  "-rc:v",
  "vbr",
  "-cq:v",
  "19",
  "-b:v",
  "15387k",
  "-maxrate",
  "20000k",
  "-bufsize",
  "30000k",
  "-fps_mode",
  "cfr",
  "-r",
  "60",
];

/**
 * What a landscape pass encodes with when the GPU cannot: libx264 at CRF 18,
 * the same constant-quality target the Shorts burn-in uses, capped at the same
 * peak bitrate as the NVENC settings so the file stays in the same size class.
 * `medium` rather than `slow`: this runs on the CPU for a whole course, and it
 * is a stopgap for a GPU that has gone away, not the house encode.
 *
 * Never chosen up front. {@link landscapeCpuFallbackArgs} swaps it in for one
 * pass, only after NVENC has refused to open — see `runFfmpegWithProgress`.
 */
export const LANDSCAPE_VIDEO_CPU_FALLBACK_ENCODE_ARGS = [
  "-c:v",
  "libx264",
  "-preset",
  "medium",
  "-crf",
  "18",
  "-maxrate",
  "20000k",
  "-bufsize",
  "30000k",
  "-pix_fmt",
  "yuv420p",
  "-fps_mode",
  "cfr",
  "-r",
  "60",
];

/**
 * The lines ffmpeg prints when NVENC could not open because there is no usable
 * GPU — the CUDA context will not come up (a driver wedged after sleep, WSL
 * losing the device), the libraries are missing, or no device can encode. Not
 * a bad parameter, not a bad input: the same command on the CPU would run.
 */
const NVENC_UNAVAILABLE =
  /cuCtxCreate|cuInit|CUDA_ERROR_|No (NVENC )?capable devices found|Cannot load libcuda|Cannot load libnvidia-encode|OpenEncodeSessionEx failed/i;

/**
 * The one place a landscape pass changes encoder: given the args of a pass
 * that FAILED and the stderr it left, the same pass on libx264 — or `null`
 * when the failure was not NVENC being unable to open, or the pass did not
 * encode with {@link LANDSCAPE_VIDEO_ENCODE_ARGS}.
 *
 * Only the encoder block is swapped; inputs, filters, audio, bitexact flags
 * and the output path stay exactly as the caller built them.
 */
export const landscapeCpuFallbackArgs = (
  failedArgs: readonly string[],
  stderrTail: string
): string[] | null => {
  if (!NVENC_UNAVAILABLE.test(stderrTail)) return null;
  const at = indexOfSequence(failedArgs, LANDSCAPE_VIDEO_ENCODE_ARGS);
  if (at === -1) return null;
  return [
    ...failedArgs.slice(0, at),
    ...LANDSCAPE_VIDEO_CPU_FALLBACK_ENCODE_ARGS,
    ...failedArgs.slice(at + LANDSCAPE_VIDEO_ENCODE_ARGS.length),
  ];
};

const indexOfSequence = (
  haystack: readonly string[],
  needle: readonly string[]
): number => {
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((arg, j) => haystack[i + j] === arg)) return i;
  }
  return -1;
};

export class FFmpegError extends Data.TaggedError("FFmpegError")<{
  cause: unknown;
  message: string;
}> {}
