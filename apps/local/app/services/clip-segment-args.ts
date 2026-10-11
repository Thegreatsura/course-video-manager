import type { MicEq } from "@cvm/core/features/videos/recorder";
import type { ClipComposite } from "@/packages/clip-source";
import { sceneFilterGraph } from "@/packages/scene-layout";
import { clipZoomCropFilter } from "@/features/videos/clip-zoom";
import { BITEXACT_ARGS, LANDSCAPE_VIDEO_ENCODE_ARGS } from "./ffmpeg-error";

/**
 * The ffmpeg command lines of a segmented export: each Clip rendered on its
 * own into a segment file, then the segments joined by stream copy.
 *
 * A Video with a new-recorder Clip is exported this way. Its Clips are
 * composites drawn from three files each, and one filter graph across every
 * Clip opens a decoder per file per Clip (about 39 for 13 Clips, 4–5 GB more
 * GPU memory — the composite-cost measurement on #1993). One graph per Clip
 * costs about what today's export does. An OBS-only Video never comes here.
 *
 * Every segment is encoded alike — {@link LANDSCAPE_VIDEO_ENCODE_ARGS} (CFR
 * 60, 8-bit yuv420p), BT.709 tags, 48 kHz stereo PCM in QuickTime — so the
 * concat can copy the picture. The sound is PCM until the concat so no
 * per-segment AAC priming lands between Clips; the concat encodes AAC 48 kHz
 * once, and the audio normalize pass that follows re-encodes it anyway.
 *
 * Two things keep the joined file CFR 60 with the sound on the picture:
 * - Each segment is a whole number of frames, picture and sound alike
 *   ({@link wholeFrameSeconds}). The concat demuxer starts the next segment
 *   where the last one ends; a picture rounded up to its frame over sound cut
 *   at the exact duration opens a gap of a few ms at every join, which the
 *   AAC encode closes by sliding the sound earlier.
 * - The segments carry a 1/15360 video time base (as today's single pass
 *   writes): 60 fps lands on whole ticks, where Matroska's 1 ms ticks give
 *   frame steps of 16 and 17 ms.
 */

/** One Clip as a segmented export renders it. */
export type SegmentClip = {
  /** The Footage file and start an OBS Clip is cut from (a composite reads its own). */
  readonly inputVideo: string;
  readonly startTime: number;
  /** Seconds of output, long Pause included. */
  readonly duration: number;
  readonly zoomType?: string;
  /** The composite to draw, or null for a Clip cut from one Footage file. */
  readonly composite: ClipComposite | null;
};

type Dimensions = { readonly width: number; readonly height: number };

const FPS = 60;

/** A duration rounded up to whole 60 fps frames (800 samples at 48 kHz). */
const wholeFrameSeconds = (seconds: number): number =>
  Math.ceil(seconds * FPS - 1e-6) / FPS;

/** The extension of a segment file: QuickTime, which carries PCM. */
export const SEGMENT_EXTENSION = ".mov";

/**
 * OBS's 3-Band Equalizer splits the mic at 800 Hz and 5 kHz and applies one
 * gain per band. Here: the mid gain on everything, then shelves below 800 Hz
 * and above 5 kHz for the low and high bands' difference from it. A band at
 * 0 dB adds no filter.
 */
export const micEqFilters = (eq: MicEq): string[] => [
  ...(eq.midDb !== 0 ? [`volume=${eq.midDb}dB`] : []),
  ...(eq.lowDb !== eq.midDb
    ? [`lowshelf=f=800:g=${round(eq.lowDb - eq.midDb)}`]
    : []),
  ...(eq.highDb !== eq.midDb
    ? [`highshelf=f=5000:g=${round(eq.highDb - eq.midDb)}`]
    : []),
];

const round = (n: number) => Math.round(n * 1000) / 1000;

/** BT.709 tags on every segment: the concat copies them through. */
const BT709_ARGS = [
  "-color_primaries",
  "bt709",
  "-color_trc",
  "bt709",
  "-colorspace",
  "bt709",
];

const SEGMENT_AUDIO_ARGS = ["-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2"];

/** Scale (after any Clip Zoom crop) to the export frame. */
const frameFilter = (zoomType: string | undefined, dims: Dimensions) => {
  const crop = clipZoomCropFilter(zoomType ?? "none");
  return `${crop ? `${crop},` : ""}scale=${dims.width}:${dims.height},setsar=1,format=yuv420p`;
};

/** Stereo 48 kHz, exactly `duration` long, starting at 0. */
const audioTail = (duration: number) =>
  `aresample=48000,aformat=sample_fmts=s16:channel_layouts=stereo,apad,atrim=0:${duration},asetpts=PTS-STARTPTS`;

/**
 * Render one Clip to a segment file: the composite for a new-recorder Clip,
 * the Footage cut for any other.
 *
 * The composite reads screen and camera from the Clip's picture time and the
 * mic from `start - micOffset` (the mic is behind the picture by the offset);
 * a mic read that would start before the file does is padded with silence.
 */
export const clipSegmentArgs = (
  clip: SegmentClip,
  dims: Dimensions,
  outputFile: string
): string[] => {
  const { composite } = clip;
  const duration = wholeFrameSeconds(clip.duration);
  const encode = [
    "-map",
    "[outv]",
    "-map",
    "[outa]",
    ...LANDSCAPE_VIDEO_ENCODE_ARGS,
    ...BT709_ARGS,
    ...SEGMENT_AUDIO_ARGS,
    "-video_track_timescale",
    String(FPS * 256),
    "-t",
    String(duration),
    ...BITEXACT_ARGS,
    outputFile,
  ];

  if (!composite) {
    return [
      "-y",
      "-hide_banner",
      "-ss",
      String(clip.startTime),
      "-t",
      String(duration),
      "-i",
      clip.inputVideo,
      "-filter_complex",
      [
        `[0:v]setpts=PTS-STARTPTS,fps=60,${frameFilter(clip.zoomType, dims)}[outv]`,
        `[0:a]asetpts=PTS-STARTPTS,${audioTail(duration)}[outa]`,
      ].join(";"),
      ...encode,
    ];
  }

  const start = composite.start;
  // Draw the last scene on to the end of the last frame.
  const segments = composite.segments.map((segment, i, all) =>
    i === all.length - 1
      ? {
          ...segment,
          endSeconds: Math.max(segment.endSeconds, start + duration),
        }
      : segment
  );
  const micStart = start - composite.micOffsetSeconds;
  const silenceMs = Math.max(0, Math.round(-micStart * 1000));
  // Read a little past the end, so the 29.97 camera has a frame to hold.
  const pictureRead = String(duration + 1);
  const audioFilters = [
    "asetpts=PTS-STARTPTS",
    ...(silenceMs > 0 ? [`adelay=${silenceMs}:all=1`] : []),
    ...micEqFilters(composite.eq),
    audioTail(duration),
  ];
  return [
    "-y",
    "-hide_banner",
    "-ss",
    String(start),
    "-t",
    pictureRead,
    "-i",
    composite.screen,
    "-ss",
    String(start),
    "-t",
    pictureRead,
    "-i",
    composite.camera,
    "-ss",
    String(Math.max(0, micStart)),
    "-t",
    String(duration),
    "-i",
    composite.mic,
    "-filter_complex",
    [
      sceneFilterGraph({
        segments,
        inputs: { screen: "0:v", camera: "1:v" },
        inputStartSeconds: start,
        output: "composite",
      }),
      `[composite]${frameFilter(clip.zoomType, dims)}[outv]`,
      `[2:a]${audioFilters.join(",")}[outa]`,
    ].join(";"),
    ...encode,
  ];
};

/**
 * Join the segment files listed in `listFile` (concat demuxer syntax) by
 * stream copy, encoding the PCM sound to the export's AAC 48 kHz.
 */
export const concatSegmentsArgs = (
  listFile: string,
  outputFile: string
): string[] => [
  "-y",
  "-hide_banner",
  "-f",
  "concat",
  "-safe",
  "0",
  "-i",
  listFile,
  "-map",
  "0:v",
  "-map",
  "0:a",
  "-c:v",
  "copy",
  "-c:a",
  "aac",
  "-ar",
  "48000",
  "-b:a",
  "320k",
  "-movflags",
  "+faststart",
  ...BITEXACT_ARGS,
  outputFile,
];

/** A concat demuxer list naming each segment file. */
export const concatList = (segmentFiles: readonly string[]): string =>
  segmentFiles.map((f) => `file '${f.replaceAll("'", "'\\''")}'`).join("\n") +
  "\n";
