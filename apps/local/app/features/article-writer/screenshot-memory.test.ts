import { describe, expect, it } from "vitest";
import { createScreenshotMemory } from "./screenshot-memory";

const doc = "Intro\n\n![The box](./screenshot-3.png)\n\nOutro";

describe("screenshotMemory", () => {
  it("revives a remembered image as its placeholder, face, crop and frame included", () => {
    const memory = createScreenshotMemory();
    memory.remember("video-1", "./screenshot-3.png", {
      clipIndex: 4,
      alt: "The box",
      face: "custom",
      crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.25 },
      time: 12.4,
    });

    expect(memory.canRevive("video-1", "./screenshot-3.png", "The box")).toBe(
      true
    );
    expect(memory.revive("video-1", doc, "./screenshot-3.png")).toBe(
      'Intro\n\n<ChooseScreenshot clipIndex={4} alt="The box" face="custom" crop="0.1,0.2,0.5,0.25" />\n\nOutro'
    );
    expect(memory.startTime("video-1", 4, "The box")).toBe(12.4);
  });

  it("keeps a plain No face placeholder plain", () => {
    const memory = createScreenshotMemory();
    memory.remember("video-1", "./screenshot-3.png", {
      clipIndex: 2,
      alt: "The box",
      face: "none",
      time: 3,
    });
    expect(memory.revive("video-1", doc, "./screenshot-3.png")).toBe(
      'Intro\n\n<ChooseScreenshot clipIndex={2} alt="The box" />\n\nOutro'
    );
  });

  it("offers nothing for an image it never captured, another Video's, or one whose alt was edited", () => {
    const memory = createScreenshotMemory();
    memory.remember("video-1", "./screenshot-3.png", {
      clipIndex: 1,
      alt: "The box",
      face: "with",
      time: 0,
    });

    expect(memory.canRevive("video-1", "./screenshot-9.png", "The box")).toBe(
      false
    );
    expect(memory.canRevive("video-2", "./screenshot-3.png", "The box")).toBe(
      false
    );
    expect(memory.canRevive("video-1", "./screenshot-3.png", "Renamed")).toBe(
      false
    );
    expect(memory.revive("video-2", doc, "./screenshot-3.png")).toBeNull();
    expect(
      memory.revive("video-1", "the image was deleted", "./screenshot-3.png")
    ).toBeNull();
    expect(memory.startTime("video-1", 1, "The box")).toBeUndefined();
  });
});
