import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  MIN_CROP_SIZE,
  createInitialCropState,
  cropReducer,
  shownCrop,
  type CropHandle,
  type CropPoint,
} from "./crop-reducer";
import type { ScreenCrop } from "@/packages/clip-source";

const box: ScreenCrop = { x: 0.2, y: 0.2, w: 0.4, h: 0.2 };

const tester = () => new ReducerTester(cropReducer, createInitialCropState());

const close = (actual: ScreenCrop | null, expected: ScreenCrop) => {
  expect(actual).not.toBeNull();
  for (const k of ["x", "y", "w", "h"] as const) {
    expect(actual![k]).toBeCloseTo(expected[k], 6);
  }
};

/** Drag `handle` of `box` from `from` to `to`, then release. */
const resize = (
  handle: CropHandle,
  from: CropPoint,
  to: CropPoint,
  mods: { alt?: boolean; shift?: boolean } = {}
) => {
  const t = tester()
    .send({ type: "press-handle", handle, point: from, box })
    .send({
      type: "move-pointer",
      point: to,
      alt: mods.alt ?? false,
      shift: mods.shift ?? false,
    });
  const live = shownCrop(t.getState(), box);
  t.send({ type: "release-pointer" });
  return { live, effects: t.getEffects(), state: t.getState() };
};

describe("cropReducer", () => {
  describe("edges", () => {
    it("the right edge moves only the right side, and the drag saves it", () => {
      const { live, effects, state } = resize(
        "e",
        { x: 0.6, y: 0.3 },
        { x: 0.7, y: 0.9 }
      );
      close(live, { x: 0.2, y: 0.2, w: 0.5, h: 0.2 });
      expect(effects).toHaveLength(1);
      close(effects[0]!.crop, { x: 0.2, y: 0.2, w: 0.5, h: 0.2 });
      expect(state.drag).toBeNull();
    });

    it("the top edge keeps the bottom where it was", () => {
      const { live } = resize("n", { x: 0.4, y: 0.2 }, { x: 0.4, y: 0.1 });
      close(live, { x: 0.2, y: 0.1, w: 0.4, h: 0.3 });
    });
  });

  describe("corners", () => {
    it("the top-left corner moves both its sides, the opposite corner stays", () => {
      const { live } = resize("nw", { x: 0.2, y: 0.2 }, { x: 0.1, y: 0.3 });
      close(live, { x: 0.1, y: 0.3, w: 0.5, h: 0.1 });
    });
  });

  describe("Alt", () => {
    it("resizes an edge about the centre: the opposite edge moves the other way", () => {
      const { live } = resize(
        "w",
        { x: 0.2, y: 0.3 },
        { x: 0.1, y: 0.3 },
        {
          alt: true,
        }
      );
      close(live, { x: 0.1, y: 0.2, w: 0.6, h: 0.2 });
    });

    it("resizes a corner about the centre on both axes", () => {
      const { live } = resize(
        "se",
        { x: 0.6, y: 0.4 },
        { x: 0.65, y: 0.45 },
        {
          alt: true,
        }
      );
      close(live, { x: 0.15, y: 0.15, w: 0.5, h: 0.3 });
    });
  });

  describe("Shift", () => {
    it("keeps a corner's aspect ratio, following the larger pull", () => {
      const { live } = resize(
        "se",
        { x: 0.6, y: 0.4 },
        { x: 0.8, y: 0.41 },
        {
          shift: true,
        }
      );
      // Width 0.4 -> 0.6 is x1.5, so the height goes 0.2 -> 0.3.
      close(live, { x: 0.2, y: 0.2, w: 0.6, h: 0.3 });
    });

    it("does nothing to an edge", () => {
      const { live } = resize(
        "e",
        { x: 0.6, y: 0.3 },
        { x: 0.7, y: 0.3 },
        {
          shift: true,
        }
      );
      close(live, { x: 0.2, y: 0.2, w: 0.5, h: 0.2 });
    });

    it("combines with Alt: aspect kept, about the centre", () => {
      const { live } = resize(
        "se",
        { x: 0.6, y: 0.4 },
        { x: 0.7, y: 0.4 },
        {
          alt: true,
          shift: true,
        }
      );
      // Width 0.4 -> 0.6 about the centre (0.4, 0.3): x1.5, height 0.3.
      close(live, { x: 0.1, y: 0.15, w: 0.6, h: 0.3 });
    });
  });

  describe("clamping", () => {
    it("an edge stops at the frame", () => {
      const { live } = resize("e", { x: 0.6, y: 0.3 }, { x: 1.4, y: 0.3 });
      close(live, { x: 0.2, y: 0.2, w: 0.8, h: 0.2 });
    });

    it("an edge dragged past the opposite one keeps the minimum size", () => {
      const { live } = resize("e", { x: 0.6, y: 0.3 }, { x: 0.05, y: 0.3 });
      close(live, { x: 0.2, y: 0.2, w: MIN_CROP_SIZE, h: 0.2 });
    });

    it("an aspect-locked corner stops when either side reaches the frame", () => {
      const { live } = resize(
        "se",
        { x: 0.6, y: 0.4 },
        { x: 0.9, y: 0.99 },
        {
          shift: true,
        }
      );
      // Height can grow to 0.8 (x4) but width only to 0.8 (x2): x2 wins.
      close(live, { x: 0.2, y: 0.2, w: 0.8, h: 0.4 });
    });

    it("a moved box stays inside the frame", () => {
      const t = tester()
        .send({ type: "press-frame", point: { x: 0.3, y: 0.3 }, box })
        .send({
          type: "move-pointer",
          point: { x: -0.5, y: 0.95 },
          alt: false,
          shift: false,
        });
      close(shownCrop(t.getState(), box), { x: 0, y: 0.8, w: 0.4, h: 0.2 });
    });
  });

  describe("drawing and moving", () => {
    it("a drag outside the box draws a new one from the drag", () => {
      const t = tester()
        .send({ type: "press-frame", point: { x: 0.9, y: 0.9 }, box })
        .send({
          type: "move-pointer",
          point: { x: 0.7, y: 0.6 },
          alt: false,
          shift: false,
        })
        .send({ type: "release-pointer" });
      expect(t.getEffects()).toHaveLength(1);
      close(t.getEffects()[0]!.crop, { x: 0.7, y: 0.6, w: 0.2, h: 0.3 });
    });

    it("a drag on a frame with no box draws one", () => {
      const t = tester()
        .send({ type: "press-frame", point: { x: 0.1, y: 0.1 }, box: null })
        .send({
          type: "move-pointer",
          point: { x: 0.5, y: 0.4 },
          alt: false,
          shift: false,
        });
      close(shownCrop(t.getState(), null), { x: 0.1, y: 0.1, w: 0.4, h: 0.3 });
    });

    it("a drag inside the box moves it", () => {
      const t = tester()
        .send({ type: "press-frame", point: { x: 0.3, y: 0.3 }, box })
        .send({
          type: "move-pointer",
          point: { x: 0.4, y: 0.35 },
          alt: false,
          shift: false,
        })
        .send({ type: "release-pointer" });
      close(t.getEffects()[0]!.crop, { x: 0.3, y: 0.25, w: 0.4, h: 0.2 });
    });

    it("a click that moves nothing, or a lost pointer, saves nothing", () => {
      const t = tester()
        .send({ type: "press-frame", point: { x: 0.9, y: 0.9 }, box })
        .send({ type: "release-pointer" })
        .send({
          type: "press-handle",
          handle: "e",
          point: { x: 0.6, y: 0.3 },
          box,
        })
        .send({
          type: "move-pointer",
          point: { x: 0.7, y: 0.3 },
          alt: false,
          shift: false,
        })
        .send({ type: "lose-pointer" });
      expect(t.getEffects()).toEqual([]);
      expect(shownCrop(t.getState(), box)).toBe(box);
    });
  });
});
