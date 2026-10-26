import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CENTERING_DEFAULTS,
  CENTERING_STORAGE_KEYS,
  getCentringInsets,
} from "./diagram-centering-settings";
import {
  computedDiagramFrame,
  diagramFrameFor,
  rememberDiagramFrame,
} from "./diagram-frame";

/** `localStorage` is a system boundary, so it is the one thing faked here. */
let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
});

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

/** The full-height strip the centring keeps clear on the right, less its padding. */
const faceStripWidth = (
  format: "landscape" | "short",
  width: number,
  settings = CENTERING_DEFAULTS
) =>
  getCentringInsets(settings, format, { x: 0, w: width }, width).right -
  settings.paddingX;

describe("the Diagram Frame with none remembered", () => {
  it("is the DELL's whole screen but the face-cam strip, padding and all", () => {
    expect(computedDiagramFrame("landscape", CENTERING_DEFAULTS)).toEqual({
      x: 0,
      y: 0,
      w: (1920 - faceStripWidth("landscape", 1920)) / 1920,
      h: 1,
    });
  });

  it("is the whole 1080x1080 Spacedesk screen for a Short, which has no face-cam strip", () => {
    expect(faceStripWidth("short", 1080)).toBe(0);
    expect(computedDiagramFrame("short", CENTERING_DEFAULTS)).toEqual({
      x: 0,
      y: 0,
      w: 1,
      h: 1,
    });
  });

  it("follows a re-tuned face-cam strip", () => {
    const settings = { ...CENTERING_DEFAULTS, faceCamWidth: 600 };
    expect(computedDiagramFrame("landscape", settings).w).toBe(
      (1920 - faceStripWidth("landscape", 1920, settings)) / 1920
    );
  });

  it("is the computed one when nothing is stored", () => {
    expect(diagramFrameFor("landscape")).toEqual(
      computedDiagramFrame("landscape")
    );
  });
});

describe("the remembered Diagram Frame", () => {
  it("is the full-screen window but the face-cam strip", () => {
    store.set(CENTERING_STORAGE_KEYS.faceCamWidth, "400");
    rememberDiagramFrame("landscape", {
      innerWidth: 1600,
      fullScreen: true,
    });

    expect(diagramFrameFor("landscape")).toEqual({
      x: 0,
      y: 0,
      w: 1200 / 1600,
      h: 1,
    });
  });

  it("is not remembered from a window that is not full screen", () => {
    rememberDiagramFrame("landscape", {
      innerWidth: 1600,
      fullScreen: false,
    });

    expect(diagramFrameFor("landscape")).toEqual(
      computedDiagramFrame("landscape")
    );
  });
});
