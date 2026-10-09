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

export class FFmpegError extends Data.TaggedError("FFmpegError")<{
  cause: unknown;
  message: string;
}> {}
