import { describe, expect, it } from "vitest";
import {
  NO_ANIMATIC_NEIGHBOURS,
  animaticNeighbours,
  readAnimaticStartIntent,
  resolveAnimaticStep,
  type AnimaticNeighbours,
} from "./animatic-course-walk";
import {
  ANIMATIC_FPS,
  buildAnimaticTimeline,
  type AnimaticClipMockup,
} from "./animatic-timeline";

const mockup = (position: number): AnimaticClipMockup => ({
  id: `cm_${position}`,
  line: `Line ${position}.`,
  position,
  durationSeconds: 3,
  order: `a${position}`,
  imageUrl: `/api/clip-mockups/cm_${position}/image`,
  audioUrl: `/api/clip-mockups/cm_${position}/audio`,
  imageMissing: false,
  audioMissing: false,
  speechStartSeconds: 0,
  voiceStatus: "ready",
  voiceError: null,
});

const segments = buildAnimaticTimeline([
  mockup(1),
  mockup(2),
  mockup(3),
]).segments;
const second = segments[1]!.startFrame;
const third = segments[2]!.startFrame;

const neighbours: AnimaticNeighbours = {
  previousVideoId: "prev",
  nextVideoId: "next",
  sectionStartVideoId: null,
  previousSectionVideoId: "prev-section",
  nextSectionVideoId: "next-section",
};

const press = (
  level: "clip-mockup" | "section",
  delta: -1 | 1,
  frame: number,
  around: AnimaticNeighbours = neighbours
) => resolveAnimaticStep({ level, delta, segments, frame, neighbours: around });

describe("LEFT and RIGHT", () => {
  it("step between Clip Mockups, keeping play state", () => {
    expect(press("clip-mockup", 1, second + 5)).toEqual({
      type: "seek",
      frame: third,
      playback: "keep",
    });
    expect(press("clip-mockup", -1, second + 5)).toEqual({
      type: "seek",
      frame: 0,
      playback: "keep",
    });
  });

  it("RIGHT off the last Clip Mockup opens the next Video from the top", () => {
    expect(press("clip-mockup", 1, third + 5)).toEqual({
      type: "open",
      videoId: "next",
      start: "first",
    });
  });

  it("LEFT in the first second goes to the previous Video's last Clip Mockup, and restarts after it", () => {
    expect(press("clip-mockup", -1, ANIMATIC_FPS - 1)).toEqual({
      type: "open",
      videoId: "prev",
      start: "last",
    });
    expect(press("clip-mockup", -1, ANIMATIC_FPS)).toEqual({
      type: "seek",
      frame: 0,
      playback: "keep",
    });
  });

  it("hold at either end of the Course", () => {
    expect(press("clip-mockup", 1, third, NO_ANIMATIC_NEIGHBOURS)).toBeNull();
    expect(press("clip-mockup", -1, 0, NO_ANIMATIC_NEIGHBOURS)).toBeNull();
  });
});

describe("CTRL+LEFT and CTRL+RIGHT", () => {
  it("CTRL+RIGHT opens the next Section's first Animatic", () => {
    expect(press("section", 1, second)).toEqual({
      type: "open",
      videoId: "next-section",
      start: "first",
    });
  });

  it("CTRL+LEFT goes back to the Section's start, and only from there to the previous Section", () => {
    // Later in the Section: back to its first Animatic.
    expect(
      press("section", -1, 0, { ...neighbours, sectionStartVideoId: "start" })
    ).toEqual({ type: "open", videoId: "start", start: "first" });
    // On the Section's first Video, past its first second: restart it.
    expect(press("section", -1, second)).toEqual({
      type: "seek",
      frame: 0,
      playback: "play",
    });
    // At the very start: the previous Section.
    expect(press("section", -1, 0)).toEqual({
      type: "open",
      videoId: "prev-section",
      start: "first",
    });
  });
});

describe("animaticNeighbours", () => {
  // Section A: a1 (mockups), a2 (none), a3 (mockups).
  // Section B: nothing to watch. Section C: c1 (none), c2 (mockups).
  const sections = [
    { videoIds: ["a1", "a2", "a3"] },
    { videoIds: ["b1"] },
    { videoIds: ["c1", "c2"] },
  ];
  const withClipMockups = new Set(["a1", "a3", "c2"]);
  const around = (currentVideoId: string) =>
    animaticNeighbours({ sections, withClipMockups, currentVideoId });

  it("steps over Videos and Sections with no Clip Mockups", () => {
    expect(around("a3")).toEqual({
      previousVideoId: "a1",
      nextVideoId: "c2",
      sectionStartVideoId: "a1",
      previousSectionVideoId: null,
      nextSectionVideoId: "c2",
    });
    expect(around("c2")).toEqual({
      previousVideoId: "a3",
      nextVideoId: null,
      sectionStartVideoId: null,
      previousSectionVideoId: "a1",
      nextSectionVideoId: null,
    });
  });

  it("gives a Video outside the Course no neighbours", () => {
    expect(around("standalone")).toEqual(NO_ANIMATIC_NEIGHBOURS);
  });
});

describe("readAnimaticStartIntent", () => {
  it("reads only a well-formed intent", () => {
    expect(readAnimaticStartIntent({ animaticStart: "last" })).toBe("last");
    expect(readAnimaticStartIntent({ animaticStart: "middle" })).toBeNull();
    expect(readAnimaticStartIntent(null)).toBeNull();
  });
});
