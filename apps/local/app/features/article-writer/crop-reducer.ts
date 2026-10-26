import type { EffectReducer } from "use-effect-reducer";
import type { ScreenCrop } from "@/packages/clip-source";

/**
 * The Custom Crop's gestures on Choose Screenshot's screen frame: draw a new
 * crop box, move it, or resize it by one of its eight handles. Every point is
 * a fraction (0–1) of the frame, like the crop itself, so the reducer never
 * needs the frame's size in pixels.
 *
 * Alt resizes about the box's centre (tldraw's rule: drag the left edge and
 * the right edge moves the opposite way). Shift on a corner keeps the box's
 * aspect ratio; the two combine. The box never leaves the frame and never
 * gets smaller than {@link MIN_CROP_SIZE}.
 *
 * The live box is in `drag` while a gesture runs. A gesture that moved
 * something ends in `save-custom-crop`, which the placeholder writes to its
 * tag as `face="custom"`; a click that moved nothing saves nothing.
 */

/** The smallest a crop box gets on either side, as a fraction of the frame. */
export const MIN_CROP_SIZE = 0.02;

/** n/s/e/w are the edges, the others the corners. */
export type CropHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export const CROP_HANDLES: readonly CropHandle[] = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
];

/** A point on the frame, as fractions of its width and height. */
export type CropPoint = { readonly x: number; readonly y: number };

export namespace cropReducer {
  export type Drag = {
    readonly kind: "move" | "resize" | "draw";
    /** Only for `resize`. */
    readonly handle: CropHandle | null;
    /** Where the pointer went down. */
    readonly origin: CropPoint;
    /** The box when the pointer went down (for `draw`, a point at origin). */
    readonly start: ScreenCrop;
    /** The box as the gesture has it now: what the frame shows. */
    readonly rect: ScreenCrop;
    readonly moved: boolean;
  };

  export type State = { readonly drag: Drag | null };

  export type Action =
    /**
     * Pointer down on the frame: inside `box` moves it, anywhere else draws
     * a new one. `box` is the one shown, or null when none is (No face).
     */
    | {
        readonly type: "press-frame";
        readonly point: CropPoint;
        readonly box: ScreenCrop | null;
      }
    | {
        readonly type: "press-handle";
        readonly handle: CropHandle;
        readonly point: CropPoint;
        readonly box: ScreenCrop;
      }
    | {
        readonly type: "move-pointer";
        readonly point: CropPoint;
        readonly alt: boolean;
        readonly shift: boolean;
      }
    | { readonly type: "release-pointer" }
    /** The browser took the pointer away (pointercancel): nothing is saved. */
    | { readonly type: "lose-pointer" };

  export type Effect = {
    readonly type: "save-custom-crop";
    readonly crop: ScreenCrop;
  };
}

export const createInitialCropState = (): cropReducer.State => ({
  drag: null,
});

export const cropReducer: EffectReducer<
  cropReducer.State,
  cropReducer.Action,
  cropReducer.Effect
> = (state, action, exec) => {
  switch (action.type) {
    case "press-frame": {
      const inside = action.box !== null && contains(action.box, action.point);
      const start = inside
        ? action.box!
        : { x: action.point.x, y: action.point.y, w: 0, h: 0 };
      return {
        drag: {
          kind: inside ? "move" : "draw",
          handle: null,
          origin: action.point,
          start,
          rect: start,
          moved: false,
        },
      };
    }
    case "press-handle":
      return {
        drag: {
          kind: "resize",
          handle: action.handle,
          origin: action.point,
          start: action.box,
          rect: action.box,
          moved: false,
        },
      };
    case "move-pointer": {
      const drag = state.drag;
      if (!drag) return state;
      return { drag: { ...drag, rect: dragRect(drag, action), moved: true } };
    }
    case "release-pointer": {
      const drag = state.drag;
      if (drag?.moved) exec({ type: "save-custom-crop", crop: drag.rect });
      return drag ? { drag: null } : state;
    }
    case "lose-pointer":
      return state.drag ? { drag: null } : state;
  }
};

/** The box to show: the live one mid-gesture, else the one saved. */
export const shownCrop = (
  state: cropReducer.State,
  saved: ScreenCrop | null
): ScreenCrop | null => state.drag?.rect ?? saved;

const contains = (box: ScreenCrop, p: CropPoint) =>
  p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h;

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));

const dragRect = (
  drag: cropReducer.Drag,
  move: { point: CropPoint; alt: boolean; shift: boolean }
): ScreenCrop => {
  const dx = move.point.x - drag.origin.x;
  const dy = move.point.y - drag.origin.y;
  if (drag.kind === "move") {
    const { start } = drag;
    return {
      ...start,
      x: clamp(start.x + dx, 0, 1 - start.w),
      y: clamp(start.y + dy, 0, 1 - start.h),
    };
  }
  if (drag.kind === "draw") return drawRect(drag.origin, move.point, move.alt);
  return resizeRect(drag.start, drag.handle!, dx, dy, move);
};

/** A new box from where the pointer went down to where it is; Alt centres it. */
const drawRect = (origin: CropPoint, point: CropPoint, alt: boolean) => {
  const span = (o: number, p: number) => {
    const to = clamp(p, 0, 1);
    if (alt) {
      const half = Math.min(Math.abs(to - o), o, 1 - o);
      return fitMin(o - half, 2 * half);
    }
    return fitMin(Math.min(o, to), Math.abs(to - o));
  };
  const [x, w] = span(origin.x, point.x);
  const [y, h] = span(origin.y, point.y);
  return { x, y, w, h };
};

/** Grow a span to the minimum size, kept inside the frame. */
const fitMin = (lo: number, size: number): [number, number] => {
  const s = Math.max(size, MIN_CROP_SIZE);
  return [clamp(lo, 0, 1 - s), s];
};

/** Which way each axis of a handle moves: -1 the low side, 1 the high. */
const HANDLE_SIDES: Record<CropHandle, readonly [-1 | 0 | 1, -1 | 0 | 1]> = {
  n: [0, -1],
  s: [0, 1],
  e: [1, 0],
  w: [-1, 0],
  ne: [1, -1],
  nw: [-1, -1],
  se: [1, 1],
  sw: [-1, 1],
};

/**
 * One axis of a resize: the size the pointer asks for, the largest the frame
 * allows from the fixed point (the opposite side, or the centre with Alt),
 * and where the box starts once its size is known.
 */
const resizeAxis = (
  lo: number,
  size: number,
  side: -1 | 0 | 1,
  delta: number,
  alt: boolean
) => {
  if (side === 0) {
    return { wanted: size, max: size, place: (_s: number) => lo };
  }
  const anchor = alt ? lo + size / 2 : side === 1 ? lo : lo + size;
  const moving = side === 1 ? lo + size + delta : lo + delta;
  const extent = (moving - anchor) * side;
  const room = side === 1 ? 1 - anchor : anchor;
  return {
    wanted: alt ? 2 * extent : extent,
    max: alt ? 2 * Math.min(anchor, 1 - anchor) : room,
    place: (s: number) =>
      alt ? anchor - s / 2 : side === 1 ? anchor : anchor - s,
  };
};

const resizeRect = (
  start: ScreenCrop,
  handle: CropHandle,
  dx: number,
  dy: number,
  mods: { alt: boolean; shift: boolean }
): ScreenCrop => {
  const [sx, sy] = HANDLE_SIDES[handle];
  const ax = resizeAxis(start.x, start.w, sx, dx, mods.alt);
  const ay = resizeAxis(start.y, start.h, sy, dy, mods.alt);
  const fit = (wanted: number, max: number) =>
    Math.min(Math.max(wanted, MIN_CROP_SIZE), max);
  let w: number;
  let h: number;
  if (mods.shift && sx !== 0 && sy !== 0 && start.w > 0 && start.h > 0) {
    // One scale for both sides: the larger the pointer asks for, held to
    // what the frame allows on either axis.
    const kMax = Math.min(ax.max / start.w, ay.max / start.h);
    const kMin = Math.max(MIN_CROP_SIZE / start.w, MIN_CROP_SIZE / start.h);
    const k = Math.min(
      Math.max(ax.wanted / start.w, ay.wanted / start.h, kMin),
      kMax
    );
    w = start.w * k;
    h = start.h * k;
  } else {
    w = sx === 0 ? start.w : fit(ax.wanted, ax.max);
    h = sy === 0 ? start.h : fit(ay.wanted, ay.max);
  }
  return { x: ax.place(w), y: ay.place(h), w, h };
};
