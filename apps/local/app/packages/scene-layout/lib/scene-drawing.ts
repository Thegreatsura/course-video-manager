import {
  LAYOUT,
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
 * canvas is `CANVAS`; scale the context to draw it smaller).
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

export const CANVAS = LAYOUT.canvas;

/** Where an item lands on the canvas, in whole pixels — shared by both renderers. */
interface Placement {
  readonly item: LayoutItem;
  readonly dx: number;
  readonly dy: number;
  readonly dw: number;
  readonly dh: number;
}

/** The scene's visible items, bottom to top, placed in whole canvas pixels. */
const placements = (scene: Scene): Placement[] =>
  LAYOUT.scenes[scene]
    .map((item: LayoutItem) => ({
      item,
      dx: Math.round(item.dest.x),
      dy: Math.round(item.dest.y),
      dw: Math.round(item.dest.w),
      dh: Math.round(item.dest.h),
    }))
    .filter(
      (p) =>
        p.dx < CANVAS.width &&
        p.dy < CANVAS.height &&
        p.dx + p.dw > 0 &&
        p.dy + p.dh > 0
    );

/** How a canvas draws a scene (live preview, editor playback), bottom to top. */
export const drawInstructions = (
  scene: Scene,
  sources: Readonly<Record<LayoutSource, SourceSize>>
): DrawInstruction[] =>
  placements(scene).map(({ item, dx, dy, dw, dh }) => {
    const { width, height } = sources[item.source];
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
  /** ffmpeg stream specifiers of the recordings. Default `0:v` and `1:v`. */
  readonly inputs?: Readonly<Record<LayoutSource, string>>;
  /**
   * The session file time at the inputs' t=0: 0 for whole files, or the time
   * the caller seeked each input to with `-ss`.
   */
  readonly inputStartSeconds?: number;
  /** The output label. Default `v`. */
  readonly output?: string;
}

/** Output frame rate: the camera's 29.97 is resampled up to it. */
const FPS = 60;

/**
 * The `-filter_complex` graph that draws `segments` back to back as one
 * 1920x1080 60 fps yuv420p stream labelled `[output]` (export, stills).
 */
export const sceneFilterGraph = ({
  segments,
  inputs = { screen: "0:v", camera: "1:v" },
  inputStartSeconds = 0,
  output = "v",
}: SceneFilterGraphInput): string => {
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
      `color=c=black:s=${CANVAS.width}x${CANVAS.height}:r=${FPS}:d=${end - start}[${base}]`
    );
    placements(segment.scene).forEach(({ item, dx, dy, dw, dh }, j) => {
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

  const splits = (["screen", "camera"] as const).map((source) => {
    const labels = branches[source];
    return labels.length === 0
      ? `[${inputs[source]}]nullsink`
      : `[${inputs[source]}]split=${labels.length}${labels.map((l) => `[${l}]`).join("")}`;
  });

  const joined = segments.map((_, k) => `[seg${k}]`).join("");
  const tail =
    segments.length === 1
      ? `${joined}format=yuv420p[${output}]`
      : `${joined}concat=n=${segments.length}:v=1:a=0,format=yuv420p[${output}]`;

  return [...splits, ...chains, tail].join(";");
};
