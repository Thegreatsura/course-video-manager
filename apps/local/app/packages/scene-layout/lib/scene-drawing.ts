import type { VideoFormat } from "@/features/videos/video-format";
import {
  LAYOUTS,
  type LayoutItem,
  type LayoutSource,
  type Scene,
} from "./layout-definition";
import type { SceneSegment } from "./scene-segments";

export interface SourceSize {
  readonly width: number;
  readonly height: number;
}

/**
 * One `ctx.drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh)` call: source
 * rect in the source's own pixels, destination rect in canvas pixels (the
 * canvas is the format's `CANVASES` entry; scale the context to draw it
 * smaller).
 */
export interface DrawInstruction {
  readonly source: LayoutSource;
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
  readonly dx: number;
  readonly dy: number;
  readonly dw: number;
  readonly dh: number;
}

/** Each format's canvas, in pixels. */
export const CANVASES: Readonly<
  Record<VideoFormat, { readonly width: number; readonly height: number }>
> = {
  landscape: LAYOUTS.landscape.canvas,
  short: LAYOUTS.short.canvas,
};

/** The Landscape canvas (kept for today's Landscape callers). */
export const CANVAS = CANVASES.landscape;

/** Where an item lands on the canvas, in whole pixels — shared by both renderers. */
interface Placement {
  readonly item: LayoutItem;
  readonly dx: number;
  readonly dy: number;
  readonly dw: number;
  readonly dh: number;
}

/** Every source, in input order. */
const SOURCES = ["screen", "camera"] as const satisfies LayoutSource[];

/** The scene's visible items, bottom to top, placed in whole canvas pixels. */
const placements = (scene: Scene, format: VideoFormat): Placement[] => {
  const canvas = CANVASES[format];
  return LAYOUTS[format].scenes[scene]
    .map((item: LayoutItem) => ({
      item,
      dx: Math.round(item.dest.x),
      dy: Math.round(item.dest.y),
      dw: Math.round(item.dest.w),
      dh: Math.round(item.dest.h),
    }))
    .filter(
      (p) =>
        p.dx < canvas.width &&
        p.dy < canvas.height &&
        p.dx + p.dw > 0 &&
        p.dy + p.dh > 0
    );
};

/**
 * The sources a run of segments draws, in input order (screen, camera). A
 * source no segment draws (the Short Camera scene's screen, say) need not be
 * opened at all: leave it out of `drawInstructions` and `sceneFilterGraph`.
 */
export const drawnSources = (
  segments: readonly { readonly scene: Scene }[],
  format: VideoFormat = "landscape"
): LayoutSource[] => {
  const drawn = new Set(
    segments.flatMap(({ scene }) =>
      placements(scene, format).map((p) => p.item.source)
    )
  );
  return SOURCES.filter((source) => drawn.has(source));
};

const missingSource = (source: LayoutSource, format: VideoFormat) =>
  new Error(`The ${format} layout draws the ${source}, but it was not given`);

/**
 * How a canvas draws a scene (live preview, editor playback), bottom to top.
 * A source the scene doesn't draw may be left out of `sources`.
 */
export const drawInstructions = (
  scene: Scene,
  sources: Readonly<Partial<Record<LayoutSource, SourceSize>>>,
  format: VideoFormat = "landscape"
): DrawInstruction[] =>
  placements(scene, format).map(({ item, dx, dy, dw, dh }) => {
    const size = sources[item.source];
    if (!size) throw missingSource(item.source, format);
    const { width, height } = size;
    return {
      source: item.source,
      sx: Math.round(item.crop.x * width),
      sy: Math.round(item.crop.y * height),
      sw: Math.round(item.crop.w * width),
      sh: Math.round(item.crop.h * height),
      dx,
      dy,
      dw,
      dh,
    };
  });

export interface SceneFilterGraphInput {
  /** The segments to draw, in order, in the Recording Session's file time. */
  readonly segments: readonly SceneSegment[];
  /**
   * ffmpeg stream specifiers of the recordings. Default `0:v` (screen) and
   * `1:v` (camera). A source no segment draws (see `drawnSources`) may be
   * left out; a given source no segment draws is sent to a `nullsink`.
   */
  readonly inputs?: Readonly<Partial<Record<LayoutSource, string>>>;
  /**
   * The session file time at the inputs' t=0: 0 for whole files, or the time
   * the caller seeked each input to with `-ss`.
   */
  readonly inputStartSeconds?: number;
  /** The output label. Default `v`. */
  readonly output?: string;
  /** Whose layout and canvas to draw. Default Landscape. */
  readonly format?: VideoFormat;
}

/** Output frame rate: the camera's 29.97 is resampled up to it. */
const FPS = 60;

/**
 * The `-filter_complex` graph that draws `segments` back to back as one
 * 60 fps yuv420p stream on the format's canvas (1920x1080 Landscape, 1080x1920
 * Short), labelled `[output]` (export, stills).
 */
export const sceneFilterGraph = ({
  segments,
  inputs = { screen: "0:v", camera: "1:v" },
  inputStartSeconds = 0,
  output = "v",
  format = "landscape",
}: SceneFilterGraphInput): string => {
  const canvas = CANVASES[format];
  const chains: string[] = [];
  const branches: Record<LayoutSource, string[]> = { screen: [], camera: [] };
  const take = (source: LayoutSource) => {
    const label = `${source}${branches[source].length}`;
    branches[source].push(label);
    return label;
  };

  segments.forEach((segment, k) => {
    const start = segment.startSeconds - inputStartSeconds;
    const end = segment.endSeconds - inputStartSeconds;
    let base = `base${k}`;
    chains.push(
      `color=c=black:s=${canvas.width}x${canvas.height}:r=${FPS}:d=${end - start}[${base}]`
    );
    placements(segment.scene, format).forEach(({ item, dx, dy, dw, dh }, j) => {
      const branch = take(item.source);
      const { x, y, w, h } = item.crop;
      chains.push(
        `[${branch}]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,fps=${FPS},` +
          `crop=w=iw*${w}:h=ih*${h}:x=iw*${x}:y=ih*${y},scale=${dw}:${dh}[item${k}_${j}]`
      );
      const next = `seg${k}_${j}`;
      chains.push(
        `[${base}][item${k}_${j}]overlay=x=${dx}:y=${dy}:eof_action=repeat[${next}]`
      );
      base = next;
    });
    chains.push(`[${base}]null[seg${k}]`);
  });

  const splits = SOURCES.flatMap((source) => {
    const labels = branches[source];
    const input = inputs[source];
    if (input === undefined) {
      if (labels.length > 0) throw missingSource(source, format);
      return [];
    }
    return labels.length === 0
      ? [`[${input}]nullsink`]
      : [
          `[${input}]split=${labels.length}${labels.map((l) => `[${l}]`).join("")}`,
        ];
  });

  const joined = segments.map((_, k) => `[seg${k}]`).join("");
  const tail =
    segments.length === 1
      ? `${joined}format=yuv420p[${output}]`
      : `${joined}concat=n=${segments.length}:v=1:a=0,format=yuv420p[${output}]`;

  return [...splits, ...chains, tail].join(";");
};
