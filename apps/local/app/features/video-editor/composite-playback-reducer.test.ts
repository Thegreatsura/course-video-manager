import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  compositePlaybackReducer,
  compositeScene,
  createInitialCompositePlaybackState,
} from "./composite-playback-reducer";

/**
 * A CVM-recorder Clip from 10 s to 14 s of picture time, Code until 12 s and
 * Camera after, with a 150 ms mic offset: its mic (the clock) plays from
 * 9.85 s.
 */
const start = (
  o: {
    segments?: compositePlaybackReducer.State["segments"];
    sources?: compositePlaybackReducer.State["sources"];
  } = {}
) => {
  const tester = new ReducerTester(
    compositePlaybackReducer,
    createInitialCompositePlaybackState({
      segments: o.segments ?? [
        { scene: "Code", startSeconds: 10, endSeconds: 12 },
        { scene: "Camera", startSeconds: 12, endSeconds: 14 },
      ],
      offsetSeconds: 0.15,
      sources: o.sources ?? ["camera", "screen"],
    })
  );
  // `effects` is what the last event declared.
  const t = {
    send(action: compositePlaybackReducer.Action) {
      tester.resetExec().send(action);
      return t;
    },
    get state() {
      return tester.getState();
    },
    get effects() {
      return tester.getEffects();
    },
  };
  return t;
};

const ticked = (clockTime: number, sources = { camera: 0, screen: 0 }) =>
  ({
    type: "clock-ticked",
    clockTime,
    sourceTimes: {
      camera: sources.camera || clockTime + 0.15,
      screen: sources.screen || clockTime + 0.15,
    },
  }) as const;

describe("playing a CVM-recorder Clip as the composite", () => {
  it("plays the camera and screen in the picture's clock, the mic offset after the mic", () => {
    const t = start().send({ type: "clock-played", clockTime: 9.85, rate: 1 });
    expect(t.effects).toEqual([
      { type: "play-sources", at: 10, rate: 1, sources: ["camera", "screen"] },
    ]);
    expect(compositeScene(t.state)).toBe("Code");
  });

  it("switches scene where the Recording Session switched, inside the Clip", () => {
    const t = start().send({ type: "clock-played", clockTime: 9.85, rate: 1 });
    t.send(ticked(11.5));
    expect(compositeScene(t.state)).toBe("Code");
    t.send(ticked(11.86));
    expect(compositeScene(t.state)).toBe("Camera");
    expect(t.effects).toEqual([]);
  });

  it("pulls back a picture that drifts from the mic, once until it lands", () => {
    const t = start().send({ type: "clock-played", clockTime: 9.85, rate: 1 });
    t.send(ticked(11, { camera: 10.7, screen: 11.15 }));
    expect(t.effects).toEqual([
      { type: "seek-sources", at: 11.15, sources: ["camera"] },
    ]);
    t.send(ticked(11.02, { camera: 10.7, screen: 11.17 }));
    expect(t.effects).toEqual([]);
    t.send({ type: "source-seeked", source: "camera" });
    t.send(ticked(11.5, { camera: 11.2, screen: 11.65 }));
    expect(t.effects).toEqual([
      { type: "seek-sources", at: 11.65, sources: ["camera"] },
    ]);
  });

  it("pauses and scrubs the picture with the mic", () => {
    const t = start().send({ type: "clock-played", clockTime: 9.85, rate: 1 });
    t.send({ type: "clock-paused", clockTime: 10.35 });
    expect(t.effects).toEqual([
      { type: "pause-sources", at: 10.5, sources: ["camera", "screen"] },
    ]);
    t.send({ type: "clock-seeked", clockTime: 13.35 });
    expect(t.effects).toEqual([
      { type: "seek-sources", at: 13.5, sources: ["camera", "screen"] },
    ]);
    expect(compositeScene(t.state)).toBe("Camera");
  });

  it("does not chase drift while paused", () => {
    const t = start().send(ticked(11, { camera: 9, screen: 9 }));
    expect(t.effects).toEqual([]);
  });

  it("redraws in the scene a changed Clip Source says", () => {
    const t = start().send({
      type: "clip-source-changed",
      segments: [{ scene: "No Face", startSeconds: 10, endSeconds: 14 }],
      offsetSeconds: 0.15,
      sources: ["camera", "screen"],
    });
    expect(compositeScene(t.state)).toBe("No Face");
  });

  it("follows the mic's playback rate", () => {
    const t = start().send({ type: "clock-rate-changed", rate: 2 });
    expect(t.effects).toEqual([
      { type: "set-sources-rate", rate: 2, sources: ["camera", "screen"] },
    ]);
  });
});

/**
 * A Short's Camera-only picture (or a camera-only Recording Session): the
 * screen `<video>` is never mounted, so it is never sent anywhere and never
 * waited on.
 */
describe("playing a composite whose picture has no screen", () => {
  const cameraOnly = () =>
    start({
      segments: [{ scene: "Camera", startSeconds: 10, endSeconds: 14 }],
      sources: ["camera"],
    });

  it("plays, pauses, scrubs and rates the camera alone", () => {
    const t = cameraOnly().send({
      type: "clock-played",
      clockTime: 9.85,
      rate: 1,
    });
    expect(t.effects).toEqual([
      { type: "play-sources", at: 10, rate: 1, sources: ["camera"] },
    ]);
    t.send({ type: "clock-seeked", clockTime: 11.35 });
    expect(t.effects).toEqual([
      { type: "seek-sources", at: 11.5, sources: ["camera"] },
    ]);
    t.send({ type: "clock-rate-changed", rate: 2 });
    expect(t.effects).toEqual([
      { type: "set-sources-rate", rate: 2, sources: ["camera"] },
    ]);
    t.send({ type: "clock-paused", clockTime: 11.85 });
    expect(t.effects).toEqual([
      { type: "pause-sources", at: 12, sources: ["camera"] },
    ]);
  });

  it("lands a scrub once the camera has, without waiting on a screen", () => {
    const t = cameraOnly().send({ type: "clock-seeked", clockTime: 11.35 });
    expect(t.state.seeking).toEqual(["camera"]);
    t.send({ type: "source-seeked", source: "camera" });
    expect(t.state.seeking).toEqual([]);
  });

  it("chases drift on the camera only", () => {
    const t = cameraOnly().send({
      type: "clock-played",
      clockTime: 9.85,
      rate: 1,
    });
    t.send(ticked(11, { camera: 10.7, screen: 3 }));
    expect(t.effects).toEqual([
      { type: "seek-sources", at: 11.15, sources: ["camera"] },
    ]);
  });

  it("cues and plays a screen the changed Clip Source starts to draw, and forgets one it stops drawing", () => {
    const t = cameraOnly().send({
      type: "clock-played",
      clockTime: 9.85,
      rate: 1.5,
    });
    t.send(ticked(10.85));
    t.send({
      type: "clip-source-changed",
      segments: [{ scene: "Code", startSeconds: 10, endSeconds: 14 }],
      offsetSeconds: 0.15,
      sources: ["camera", "screen"],
    });
    expect(t.effects).toEqual([
      { type: "play-sources", at: 11, rate: 1.5, sources: ["screen"] },
    ]);
    expect(t.state.sources).toEqual(["camera", "screen"]);

    t.send({ type: "clock-seeked", clockTime: 11.35 });
    t.send({
      type: "clip-source-changed",
      segments: [{ scene: "Camera", startSeconds: 10, endSeconds: 14 }],
      offsetSeconds: 0.15,
      sources: ["camera"],
    });
    expect(t.effects).toEqual([]);
    expect(t.state.seeking).toEqual(["camera"]);
  });

  it("cues a newly drawn screen where the picture is, while paused", () => {
    const t = cameraOnly().send({ type: "clock-seeked", clockTime: 11.35 });
    t.send({ type: "source-seeked", source: "camera" });
    t.send({
      type: "clip-source-changed",
      segments: [{ scene: "Code", startSeconds: 10, endSeconds: 14 }],
      offsetSeconds: 0.15,
      sources: ["camera", "screen"],
    });
    expect(t.effects).toEqual([
      { type: "seek-sources", at: 11.5, sources: ["screen"] },
    ]);
    expect(t.state.seeking).toEqual(["screen"]);
  });
});
