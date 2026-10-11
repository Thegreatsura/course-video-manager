import { describe, expect, it } from "vitest";
import { sceneSegments } from "@/packages/scene-layout";

const clip = { startSeconds: 10, endSeconds: 20 };

describe("sceneSegments", () => {
  it("draws a Recording Session with no scene events in the Code scene", () => {
    expect(sceneSegments({ events: [], clip })).toEqual([
      { scene: "Code", startSeconds: 10, endSeconds: 20 },
    ]);
  });

  it("splits a Clip in two where the scene changes mid-Clip", () => {
    const events = [
      { scene: "Camera" as const, atSeconds: 0 },
      { scene: "Code" as const, atSeconds: 14 },
      { scene: "No Face" as const, atSeconds: 30 },
    ];
    expect(sceneSegments({ events, clip })).toEqual([
      { scene: "Camera", startSeconds: 10, endSeconds: 14 },
      { scene: "Code", startSeconds: 14, endSeconds: 20 },
    ]);
  });

  it("keeps one segment when the scene changes exactly at a Clip boundary", () => {
    expect(
      sceneSegments({
        events: [
          { scene: "Code", atSeconds: 0 },
          { scene: "Camera", atSeconds: 10 },
          { scene: "No Face", atSeconds: 20 },
        ],
        clip,
      })
    ).toEqual([{ scene: "Camera", startSeconds: 10, endSeconds: 20 }]);
  });

  it("draws the whole Clip in its Scene Override, whatever the events say", () => {
    expect(
      sceneSegments({
        events: [
          { scene: "Camera", atSeconds: 0 },
          { scene: "Code", atSeconds: 14 },
        ],
        clip,
        override: "No Face",
      })
    ).toEqual([{ scene: "No Face", startSeconds: 10, endSeconds: 20 }]);
  });
});
