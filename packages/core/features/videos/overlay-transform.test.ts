import { describe, expect, it } from "vitest";
import {
  OVERLAY_CONTENT_FPS,
  OVERLAY_TRANSFORM_EASE_IN_SECONDS,
  easeOverlayTransformProgress,
  overlayTransform,
  overlayTransformCssStyleAt,
  overlayTransformVideoFilter,
  type OverlayTransformWindow,
} from "./overlay-transform.js";

/**
 * Evaluate one of the filter's expressions at a moment, for a given input
 * size — ffmpeg's own arithmetic, in JavaScript, so the test can compare the
 * export against the preview in PIXELS rather than by reading two strings and
 * hoping.
 *
 * The dialect is small and entirely arithmetic: `st`/`ld` are the numbered
 * slots, `;` sequences them, and `min`/`clip`/`lerp`/`floor`/`sqrt`/`pow` are
 * ffmpeg's own functions. There is no `if` left to evaluate — the camera's
 * ease stopped being a branching ladder of straight segments when it became a
 * closed form.
 */
const evaluateExpression = (
  expression: string,
  iw: number,
  ih: number,
  t: number
): number => {
  const js = expression
    .replace(/\bst\(/g, "ST(")
    .replace(/\bld\(/g, "LD(")
    .replace(/\blerp\(/g, "LERP(")
    .replace(/\bclip\(/g, "CLIP(")
    .replace(/\bmin\(/g, "MIN(")
    .replace(/\bfloor\(/g, "FLOOR(")
    .replace(/\bsqrt\(/g, "SQRT(")
    .replace(/\bpow\(/g, "POW(")
    // Sequenced statements become one comma expression, which is exactly what
    // ffmpeg's `;` is: evaluate each, take the last.
    .replace(/;/g, ",");

  const slots: number[] = [];
  const helpers = {
    ST: (slot: number, value: number) => (slots[slot] = value),
    LD: (slot: number) => slots[slot] ?? 0,
    LERP: (from: number, to: number, p: number) => from + (to - from) * p,
    CLIP: (value: number, low: number, high: number) =>
      Math.min(high, Math.max(low, value)),
    MIN: (a: number, b: number) => Math.min(a, b),
    FLOOR: (value: number) => Math.floor(value),
    SQRT: (value: number) => Math.sqrt(value),
    POW: (base: number, exponent: number) => Math.pow(base, exponent),
  };

  return Function(
    "iw",
    "ih",
    "t",
    ...Object.keys(helpers),
    `return (${js});`
  )(iw, ih, t, ...Object.values(helpers));
};

/**
 * What the two-node chain does to one source frame at one moment: the size of
 * the frame that comes out, and where the SOURCE PICTURE's left edge sits
 * inside it.
 *
 * That second number is the whole feature. The `pad` puts the untouched
 * picture at `padX` on a wider canvas; the `crop` takes an original-sized
 * window back out at `cropX`; so the picture's left edge leaves the chain at
 * `padX - cropX` — which is exactly how far right the footage has slid.
 */
const evaluateVideoFilter = (
  chain: string,
  sourceWidth: number,
  sourceHeight: number,
  t: number
) => {
  // Split at the NODE boundary, not on every comma: the crop's own
  // expressions are full of them (`min`, `clip`, `lerp`).
  const [pad, crop] = chain.split(",crop=");
  const term = (node: string, name: string, iw: number, ih: number) =>
    evaluateExpression(
      new RegExp(`${name}='([^']*)'`).exec(node)![1]!,
      iw,
      ih,
      t
    );

  // The `pad` is static, and its `iw`/`ih` are the SOURCE's.
  const paddedWidth = term(pad!, "w", sourceWidth, sourceHeight);
  const padX = term(pad!, "x", sourceWidth, sourceHeight);

  // The `crop` sees the PADDED frame, so that is the `iw` its own expressions
  // are read against.
  const cropX = term(crop!, "x", paddedWidth, sourceHeight);

  return {
    paddedWidth,
    outputWidth: term(crop!, "w", paddedWidth, sourceHeight),
    outputHeight: term(crop!, "h", paddedWidth, sourceHeight),
    cropX,
    pictureLeftEdge: padX - cropX,
  };
};

/** How far right the preview has slid the footage, in pixels. */
const evaluateCssStyle = (style: { transform: string }, width: number) => {
  const percent = Number(/translateX\(([-\d.]+)%\)/.exec(style.transform)![1]);
  return { pictureLeftEdge: (percent / 100) * width };
};

const SOURCE_WIDTH = 2560;
const SOURCE_HEIGHT = 1440;

/** A Bullet Panel long enough for the move to arrive and hold. */
const panelWindow: OverlayTransformWindow & { kind: string } = {
  kind: "bulletPanel",
  startInSeconds: 12,
  endInSeconds: 20,
};

/** The arrived offset, as a fraction of frame width: the panel's own ground. */
const PANEL_OFFSET = 812 / 1920;

describe("overlay transform", () => {
  describe("which kinds move the camera", () => {
    it("moves nothing for a Definition Card, at any moment", () => {
      expect(overlayTransform("definitionCard")).toBeNull();
      expect(
        overlayTransformCssStyleAt(
          { kind: "definitionCard", startInSeconds: 0, endInSeconds: 5 },
          2
        )
      ).toBeNull();
      expect(
        overlayTransformVideoFilter({
          kind: "definitionCard",
          startInSeconds: 0,
          endInSeconds: 5,
        })
      ).toBeNull();
    });

    it("moves nothing for a kind this build does not know", () => {
      expect(
        overlayTransformCssStyleAt(
          { kind: "diagram", startInSeconds: 0, endInSeconds: 5 },
          2
        )
      ).toBeNull();
    });
  });

  describe("the move is a slide and never a zoom", () => {
    it("states every end of every move as an offset alone", () => {
      // The type has no `scale` to set, so this is really a check that the
      // table has not grown one back through a cast.
      const transform = overlayTransform("bulletPanel")!;
      expect(Object.keys(transform.from)).toEqual(["offsetX"]);
      expect(Object.keys(transform.to)).toEqual(["offsetX"]);
      expect(transform.from.offsetX).toBe(0);
    });

    it("never puts a scale in the preview's CSS", () => {
      for (const moment of [12, 12.4, 16, 19.6, 20]) {
        const style = overlayTransformCssStyleAt(panelWindow, moment)!;
        expect(style.transform).toMatch(/^translateX\(/);
        expect(style.transform).not.toContain("scale");
      }
    });

    it("hands the export back a frame of the source's own size", () => {
      const filter = overlayTransformVideoFilter(panelWindow)!;
      for (const moment of [12, 12.4, 16, 19.6, 20]) {
        const { outputWidth, outputHeight } = evaluateVideoFilter(
          filter,
          SOURCE_WIDTH,
          SOURCE_HEIGHT,
          moment
        );
        // Same size in as out, on every frame, is what "no zoom" means once
        // the picture itself is only ever copied between the two.
        expect(outputWidth).toBeCloseTo(SOURCE_WIDTH, 6);
        expect(outputHeight).toBeCloseTo(SOURCE_HEIGHT, 6);
      }
    });
  });

  describe("the preview style", () => {
    it("is absent outside the Overlay's own window", () => {
      expect(overlayTransformCssStyleAt(panelWindow, 11.9)).toBeNull();
      expect(overlayTransformCssStyleAt(panelWindow, 20.1)).toBeNull();
    });

    it("starts unmoved and arrives at the panel's own width", () => {
      expect(overlayTransformCssStyleAt(panelWindow, 12)).toEqual({
        transform: "translateX(0%)",
      });
      expect(
        evaluateCssStyle(
          overlayTransformCssStyleAt(panelWindow, 16)!,
          SOURCE_WIDTH
        ).pictureLeftEdge
      ).toBeCloseTo(PANEL_OFFSET * SOURCE_WIDTH, 6);
    });

    it("is already arrived on the first frame when the enter is a cut", () => {
      const style = overlayTransformCssStyleAt(
        { ...panelWindow, disableEnterAnimation: true },
        12
      )!;
      expect(evaluateCssStyle(style, SOURCE_WIDTH).pictureLeftEdge).toBeCloseTo(
        PANEL_OFFSET * SOURCE_WIDTH,
        6
      );
    });

    it("reads the same on the Clip's clock as on the Video's", () => {
      // What the editor asks: the same Overlay, seen from a Clip it spilled
      // onto, so its start is NEGATIVE. Only the difference between the window
      // and the moment is ever used, so the framing must not move.
      const spilled = { ...panelWindow, startInSeconds: -3, endInSeconds: 5 };
      expect(overlayTransformCssStyleAt(spilled, 1)).toEqual(
        overlayTransformCssStyleAt(panelWindow, 16)
      );
      expect(overlayTransformCssStyleAt(spilled, -3 + 0.2)).toEqual(
        overlayTransformCssStyleAt(panelWindow, 12.2)
      );
    });
  });

  describe("the ease", () => {
    /**
     * `cubic-bezier(0.25, 0.1, 0.25, 1)` solved the slow, obvious way: walk the
     * curve's own parameter until its x reaches the one asked for, then read
     * its y.
     *
     * This is the DEFINITION the closed form has to reproduce. It is written
     * out here, in the test, precisely because the shipped one no longer looks
     * anything like it — Cardano's formula is right or wrong by a derivation
     * nobody can check by eye, so it is checked against the curve instead.
     */
    const bisect = (x: number): number => {
      const axis = (t: number, p1: number, p2: number) =>
        3 * (1 - t) * (1 - t) * t * p1 + 3 * (1 - t) * t * t * p2 + t * t * t;
      if (x <= 0 || x >= 1) return Math.min(1, Math.max(0, x));
      let low = 0;
      let high = 1;
      for (let i = 0; i < 60; i++) {
        const mid = (low + high) / 2;
        if (axis(mid, 0.25, 0.25) < x) low = mid;
        else high = mid;
      }
      return axis((low + high) / 2, 0.1, 1);
    };

    it("is the curve it claims to be, at every point of it", () => {
      let worst = 0;
      for (let step = 0; step <= 10000; step++) {
        const x = step / 10000;
        worst = Math.max(
          worst,
          Math.abs(easeOverlayTransformProgress(x) - bisect(x))
        );
      }
      expect(worst).toBeLessThan(1e-12);
    });

    it("pins both ends, and never leaves 0..1 in between", () => {
      expect(easeOverlayTransformProgress(0)).toBe(0);
      expect(easeOverlayTransformProgress(1)).toBe(1);
      // Out of range in is clamped, not extrapolated.
      expect(easeOverlayTransformProgress(-5)).toBe(0);
      expect(easeOverlayTransformProgress(5)).toBe(1);
      for (let step = 0; step <= 1000; step++) {
        const y = easeOverlayTransformProgress(step / 1000);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(1);
      }
    });
  });

  describe("preview and export frame the same shot", () => {
    const filter = overlayTransformVideoFilter(panelWindow)!;

    // Through the ease in, across the hold, and back out through the ease out.
    const moments = [
      panelWindow.startInSeconds,
      panelWindow.startInSeconds + OVERLAY_TRANSFORM_EASE_IN_SECONDS / 2,
      panelWindow.startInSeconds + OVERLAY_TRANSFORM_EASE_IN_SECONDS,
      16,
      panelWindow.endInSeconds - OVERLAY_TRANSFORM_EASE_IN_SECONDS / 2,
      panelWindow.endInSeconds,
    ];

    for (const moment of moments) {
      it(`agree at t=${moment}s`, () => {
        const style = overlayTransformCssStyleAt(panelWindow, moment)!;
        const fromCss = evaluateCssStyle(style, SOURCE_WIDTH);
        const fromFilter = evaluateVideoFilter(
          filter,
          SOURCE_WIDTH,
          SOURCE_HEIGHT,
          moment
        );

        // To a BILLIONTH of a pixel, not to a pixel. Both sides evaluate the
        // same closed-form ease at the same grid-sampled moment, so all that
        // is left between them is the twelfth decimal place the filter string
        // spells its constants to.
        expect(fromFilter.pictureLeftEdge).toBeCloseTo(
          fromCss.pictureLeftEdge,
          6
        );
      });
    }

    // REGRESSION. The export used to sample this curve as eight straight
    // segments, because a Bézier was thought to have no closed-form inverse.
    // The two ends of a segment are exact and its middle is not, so every test
    // that checked whole seconds passed while the export ran up to 18px ahead
    // of the panel it was meant to be moving with — worst just after the start,
    // which is exactly where the eye is on the moving edge. Only a sweep sees
    // it, so this sweeps.
    it("agree at EVERY moment of the move, not only at the ends", () => {
      let worst = 0;
      for (let step = 0; step <= 2000; step++) {
        const moment =
          panelWindow.startInSeconds +
          (step / 2000) *
            (panelWindow.endInSeconds - panelWindow.startInSeconds);
        const style = overlayTransformCssStyleAt(panelWindow, moment);
        if (!style) continue;
        worst = Math.max(
          worst,
          Math.abs(
            evaluateVideoFilter(filter, SOURCE_WIDTH, SOURCE_HEIGHT, moment)
              .pictureLeftEdge -
              evaluateCssStyle(style, SOURCE_WIDTH).pictureLeftEdge
          )
        );
      }
      // A millionth of a pixel. The ladder's worst was 18.6.
      expect(worst).toBeLessThan(1e-6);
    });

    // The panel is a CLIP at `OVERLAY_CONTENT_FPS`, so it can only ever show
    // whole frames. The footage has to step with it: sliding smoothly past a
    // panel that steps puts the two out by up to a frame's travel, which is
    // 38px at the fastest part of this ease.
    it("holds the footage still across one frame of the panel, and steps with it", () => {
      const frame = 1 / OVERLAY_CONTENT_FPS;
      // Mid-ease, where the move is quickest and a slip shows most.
      const start = panelWindow.startInSeconds + 6 * frame;
      const at = (moment: number) =>
        evaluateCssStyle(
          overlayTransformCssStyleAt(panelWindow, moment)!,
          SOURCE_WIDTH
        ).pictureLeftEdge;

      // Anywhere inside one frame of the panel, the footage is in one place.
      expect(at(start + frame * 0.25)).toBeCloseTo(at(start), 9);
      expect(at(start + frame * 0.99)).toBeCloseTo(at(start), 9);
      // And it does move on the next one — this is a grid, not a freeze.
      expect(at(start + frame)).toBeGreaterThan(at(start) + 10);
    });

    it("keeps the crop inside the padded canvas throughout", () => {
      for (const moment of moments) {
        const { cropX, outputWidth, paddedWidth } = evaluateVideoFilter(
          filter,
          SOURCE_WIDTH,
          SOURCE_HEIGHT,
          moment
        );
        expect(cropX).toBeGreaterThanOrEqual(-0.5);
        expect(cropX + outputWidth).toBeLessThanOrEqual(paddedWidth + 0.5);
      }
    });

    it("is an identity outside the Overlay's window", () => {
      // There is no `enable=` gate on either node, so the ONLY thing keeping
      // the rest of the video untouched is that the ramps read zero out
      // there. If that ever stops being true the whole video slides.
      expect(filter).not.toContain("enable=");
      for (const moment of [0, 5, 11.9, 20.1, 60]) {
        const { pictureLeftEdge, outputWidth, outputHeight } =
          evaluateVideoFilter(filter, SOURCE_WIDTH, SOURCE_HEIGHT, moment);
        expect(pictureLeftEdge).toBeCloseTo(0, 6);
        expect(outputWidth).toBeCloseTo(SOURCE_WIDTH, 6);
        expect(outputHeight).toBeCloseTo(SOURCE_HEIGHT, 6);
      }
    });
  });
});
