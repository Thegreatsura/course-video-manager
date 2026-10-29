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
 * The vertical Shorts pipeline's subtitle burn-in does NOT use it: it has its
 * own constant-quality target, {@link SHORTS_BURN_IN_ENCODE_ARGS}.
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
 * the same constant-quality target the Shorts burn-in falls back to, capped at the same
 * peak bitrate as the NVENC settings so the file stays in the same size class.
 * `medium` rather than `slow`: this runs on the CPU for a whole course, and it
 * is a stopgap for a GPU that has gone away, not the house encode.
 *
 * Never chosen up front. {@link cpuFallbackArgs} swaps it in for one
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
 * How a Short's subtitle burn-in (its final pass, `compositeOverlay`) encodes:
 * h264_nvenc at constant quality, chosen to look like the libx264 `slow`
 * CRF 18 it replaced at a similar size (#2140). On two 8 s 1080x1920 60 fps
 * test composites CQ 22 landed level with CRF 18 on SSIM (23.13 vs 23.02 dB,
 * +21% size) on dense detail and above it (20.31 vs 18.58 dB, -1% size) on a
 * camera-and-code frame; CQ 23 fell below on the first.
 *
 * `-b:v 0` leaves the quality target uncapped, as CRF is; the lookahead, AQ
 * and B-frame-as-reference settings are what close most of the gap to x264.
 *
 * A Short is not byte-hashed or published through the Export Digest, so its
 * bytes may move; nothing landscape reads this.
 */
export const SHORTS_BURN_IN_ENCODE_ARGS = [
  "-c:v",
  "h264_nvenc",
  "-preset",
  "p7",
  "-tune",
  "hq",
  "-rc",
  "vbr",
  "-cq",
  "22",
  "-b:v",
  "0",
  "-rc-lookahead",
  "32",
  "-spatial-aq",
  "1",
  "-temporal-aq",
  "1",
  "-bf",
  "3",
  "-b_ref_mode",
  "middle",
  "-profile:v",
  "high",
  "-pix_fmt",
  "yuv420p",
];

/** The Shorts burn-in without a GPU: the libx264 encode it always was. */
export const SHORTS_BURN_IN_CPU_FALLBACK_ENCODE_ARGS = [
  "-c:v",
  "libx264",
  "-preset",
  "slow",
  "-crf",
  "18",
];

/**
 * How the AV Calibration clap step's Play clip encodes: two seconds the page
 * loops, so the fastest NVENC preset. Two threads at most, as the page is
 * something Matt waits on, not an encode.
 */
export const CLAP_PREVIEW_ENCODE_ARGS = [
  "-c:v",
  "h264_nvenc",
  "-preset",
  "p1",
  "-rc",
  "vbr",
  "-cq",
  "23",
  "-b:v",
  "0",
  "-threads",
  "2",
  "-pix_fmt",
  "yuv420p",
];

/** The clap step's Play clip without a GPU: libx264 `ultrafast`, as it was. */
export const CLAP_PREVIEW_CPU_FALLBACK_ENCODE_ARGS = [
  "-c:v",
  "libx264",
  "-preset",
  "ultrafast",
  "-threads",
  "2",
  "-pix_fmt",
  "yuv420p",
];

/**
 * Every GPU encode block and what stands in for it on the CPU. A pass that
 * encodes with one of these may be re-run by {@link cpuFallbackArgs}; one
 * that does not is never touched.
 */
const GPU_ENCODES: ReadonlyArray<{
  gpu: readonly string[];
  cpu: readonly string[];
}> = [
  {
    gpu: LANDSCAPE_VIDEO_ENCODE_ARGS,
    cpu: LANDSCAPE_VIDEO_CPU_FALLBACK_ENCODE_ARGS,
  },
  {
    gpu: SHORTS_BURN_IN_ENCODE_ARGS,
    cpu: SHORTS_BURN_IN_CPU_FALLBACK_ENCODE_ARGS,
  },
  {
    gpu: CLAP_PREVIEW_ENCODE_ARGS,
    cpu: CLAP_PREVIEW_CPU_FALLBACK_ENCODE_ARGS,
  },
];

/**
 * An input option: decode the input after it on the GPU (NVDEC). Frames come
 * back to system memory, so the CPU filters after it run unchanged, and a
 * codec or profile NVDEC cannot do is decoded on the CPU by ffmpeg itself.
 * What it cannot survive is no GPU at all — {@link cpuFallbackArgs} strips it
 * then.
 */
export const GPU_DECODE_ARGS = ["-hwaccel", "cuda"];

/**
 * An input option for an encode with many inputs: decode the input after it
 * on two threads.
 *
 * ffmpeg starts every input's decoder when the pass begins, and by default
 * each one runs `nproc + 1` frame threads, each holding its own frame
 * buffers. A concat reads only one input at a time, so those threads add
 * memory and no speed. On a 104-Clip concat (#2424) the peak was 10.65 GB at
 * production's 11 threads per input, 4.04 GB at two (4:01, against 4:00 at
 * the default) and 3.30 GB at one (4:19). The output was byte-identical at
 * every count: thread count does not change what h264 decodes. Two Publishes
 * at the default threads ran the machine out of memory mid-demux (#2419).
 */
export const MANY_INPUT_DECODE_ARGS = ["-threads", "2"];

/** `args` with {@link GPU_DECODE_ARGS} before every input. */
export const withGpuDecode = (args: readonly string[]): string[] =>
  args.flatMap((arg) => (arg === "-i" ? [...GPU_DECODE_ARGS, arg] : [arg]));

/**
 * The lines ffmpeg prints when NVENC or NVDEC could not open because there is
 * no usable GPU — the CUDA context will not come up (a driver wedged after
 * sleep, WSL losing the device), the libraries are missing, or no device can
 * encode. Not a bad parameter, not a bad input: the same command on the CPU
 * would run.
 */
const NO_USABLE_GPU =
  /cuCtxCreate|cuInit|CUDA_ERROR_|Cannot load libcuda|Cannot load libnvidia-encode|Hardware device setup failed|OpenEncodeSessionEx failed: (no encode device|unsupported device)/i;

/**
 * What h264_nvenc prints when the GPU is there and working but will not give
 * it an encoder session — every session the driver allows is taken (OBS, the
 * recorder, another encode). The driver reports it as `out of memory (10)`
 * or, on older drivers, `incompatible client key (21)`; anything else that
 * fails at `OpenEncodeSessionEx` once CUDA is up is treated the same. ffmpeg
 * follows it with `No capable devices found`, which is why that line alone
 * says nothing.
 */
const NVENC_SESSION_REFUSED = /OpenEncodeSessionEx failed/i;

/** ffmpeg's last resort line for either case above. */
const NO_CAPABLE_DEVICE = /No (NVENC )?capable devices found/i;

/**
 * Why a pass that asked for the GPU failed, from its stderr:
 *
 * - `"no-usable-gpu"`: no device, no driver, no CUDA context. Re-run it on
 *   the CPU ({@link cpuFallbackArgs}).
 * - `"nvenc-sessions-exhausted"`: the GPU is fine but busy. Wait and try the
 *   same pass on NVENC again (`runFfmpegWithProgress`); never the CPU.
 * - `null`: not the GPU's doing.
 */
export type GpuFailure = "no-usable-gpu" | "nvenc-sessions-exhausted";

export const classifyGpuFailure = (stderrTail: string): GpuFailure | null => {
  if (NO_USABLE_GPU.test(stderrTail)) return "no-usable-gpu";
  if (NVENC_SESSION_REFUSED.test(stderrTail)) return "nvenc-sessions-exhausted";
  if (NO_CAPABLE_DEVICE.test(stderrTail)) return "no-usable-gpu";
  return null;
};

/**
 * The one place a pass leaves the GPU: given the args of a pass that FAILED
 * and the stderr it left, the same pass on the CPU — or `null` when the
 * failure was not the GPU being unusable, or the pass asked nothing of it.
 *
 * A GPU that is merely out of NVENC sessions is NOT unusable: this answers
 * `null` for it, so a busy GPU never silently becomes CPU load (#2141).
 *
 * Every {@link GPU_DECODE_ARGS} is dropped and every GPU encode block in
 * {@link GPU_ENCODES} is swapped for its CPU stand-in; inputs, filters, audio,
 * bitexact flags and the output path stay exactly as the caller built them.
 */
export const cpuFallbackArgs = (
  failedArgs: readonly string[],
  stderrTail: string
): string[] | null => {
  if (classifyGpuFailure(stderrTail) !== "no-usable-gpu") return null;
  let args = withoutGpuDecode(failedArgs);
  for (const { gpu, cpu } of GPU_ENCODES) {
    const at = indexOfSequence(args, gpu);
    if (at === -1) continue;
    args = [...args.slice(0, at), ...cpu, ...args.slice(at + gpu.length)];
  }
  return args.length === failedArgs.length &&
    args.every((arg, i) => arg === failedArgs[i])
    ? null
    : args;
};

const withoutGpuDecode = (args: readonly string[]): string[] => {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === GPU_DECODE_ARGS[0] && args[i + 1] === GPU_DECODE_ARGS[1]) {
      i++;
      continue;
    }
    out.push(args[i]!);
  }
  return out;
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

/** An ffmpeg input whose demuxer gave up partway, and the reason it gave. */
export type CutShortInput = { inputIndex: number; reason: string };

/**
 * The input, if any, that ffmpeg stopped reading early.
 *
 * When a demuxer fails mid-file — the real case was "Cannot allocate memory"
 * on input #40 of a 104-input concat — ffmpeg logs it, treats that input as
 * finished, and goes on to exit 0. The concat filter simply moves to the next
 * Clip, so the output is short by whatever was left of that input, and
 * nothing else in the run says so.
 *
 * Only the demuxer's own failure counts. A decoder concealing a bad frame, or
 * a seek that lands a frame off, leaves the input's length intact.
 */
export const findCutShortInput = (stderr: string): CutShortInput | null => {
  const match =
    /\[in#(\d+)\/[^\]]*\] Error (?:during demuxing|retrieving a packet from demuxer): (.*)/.exec(
      stderr
    );
  if (!match) return null;
  return { inputIndex: Number(match[1]), reason: match[2]!.trim() };
};

/**
 * ffmpeg exited 0, but stopped reading one of its inputs before the end —
 * so the file it wrote is missing the rest of that input.
 *
 * `inputIndex` is ffmpeg's input number within the one pass that failed; a
 * pass that knows which Clip that input was sets `clipIndex`, so the export
 * can name the Clip.
 */
export class FfmpegInputCutShortError extends Data.TaggedError(
  "FfmpegInputCutShortError"
)<{
  message: string;
  inputIndex: number;
  /** The file passed as that input, when the args name one. */
  inputPath: string | undefined;
  /** What ffmpeg said, e.g. "Cannot allocate memory". */
  reason: string;
  /** The Clip, by its position in the Video, that the input belongs to. */
  clipIndex?: number;
}> {}

/** The file given as ffmpeg's `inputIndex`-th `-i`, if there is one. */
export const nthInputPath = (
  args: readonly string[],
  inputIndex: number
): string | undefined => {
  let seen = 0;
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] !== "-i") continue;
    if (seen === inputIndex) return args[i + 1];
    seen++;
  }
  return undefined;
};

/** The same failure, told which Clip its input belongs to. */
export const withClipIndex = (
  error: FfmpegInputCutShortError,
  clipIndex: number
): FfmpegInputCutShortError =>
  new FfmpegInputCutShortError({
    message: error.message,
    inputIndex: error.inputIndex,
    inputPath: error.inputPath,
    reason: error.reason,
    clipIndex,
  });
