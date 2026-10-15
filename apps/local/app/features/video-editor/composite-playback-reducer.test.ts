import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  compositePlaybackReducer,
  compositeScene,
  createInitialCompositePlaybackState,
  MAX_HOLD_MS,
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

type Times = Partial<compositePlaybackReducer.SourceTimes>;

/** Sources sit where the clock puts them unless told otherwise. */
const at = (clockTime: number, sources: Times = {}) => ({
  clockTime,
  sourceTimes: {
    camera: sources.camera ?? clockTime + 0.15,
    screen: sources.screen ?? clockTime + 0.15,
  },
});
const played = (clockTime: number, sources?: Times) =>
  ({ type: "clock-played", rate: 1, ...at(clockTime, sources) }) as const;
const paused = (clockTime: number, sources?: Times) =>
  ({ type: "clock-paused", ...at(clockTime, sources) }) as const;
const seeked = (clockTime: number, sources?: Times) =>
  ({ type: "clock-seeked", ...at(clockTime, sources) }) as const;
const ticked = (clockTime: number, sources?: Times) =>
  ({ type: "clock-ticked", ...at(clockTime, sources) }) as const;

describe("playing a CVM-recorder Clip as the composite", () => {
  it("plays in place without seeking a picture already cued with the mic", () => {
    const t = start()
      .send({ type: "editor-played" })
      .send(played(9.85, { camera: 10.01, screen: 9.99 }));
    expect(t.effects).toEqual([
      { type: "play-sources", rate: 1, sources: ["camera", "screen"] },
    ]);
    expect(compositeScene(t.state)).toBe("Code");
  });

  it("holds the mic on play until every picture `<video>` has landed, then starts them together", () => {
    const t = start()
      .send({ type: "editor-played" })
      .send(played(9.85, { camera: 0 }));
    expect(t.effects).toEqual([
      { type: "seek-sources", at: 10, sources: ["camera"] },
      { type: "hold-clock", holdId: 1, expiresAfterMs: MAX_HOLD_MS },
    ]);
    // The hold's own pause changes nothing.
    t.send(paused(9.85, { camera: 10 }));
    expect(t.effects).toEqual([]);
    t.send({ type: "source-seeked", source: "camera" });
    expect(t.effects).toEqual([
      { type: "play-sources", rate: 1, sources: ["camera", "screen"] },
      { type: "play-clock" },
    ]);
    expect(t.state.playing).toBe(true);
  });

  it("holds a play after a scrub until the scrub's seeks land, and coalesces them", () => {
    const t = start().send(seeked(11.35, { camera: 10, screen: 10 }));
    expect(t.effects).toEqual([
      { type: "seek-sources", at: 11.5, sources: ["camera", "screen"] },
    ]);
    // Scrubbed on while those are in flight: nothing new is sent…
    t.send(seeked(12.85, { camera: 10, screen: 10 }));
    expect(t.effects).toEqual([]);
    // …until each lands, short, and is sent on to where the mic now is.
    t.send({ type: "source-seeked", source: "camera" });
    expect(t.effects).toEqual([
      { type: "seek-sources", at: 13, sources: ["camera"] },
    ]);
    t.send({ type: "source-seeked", source: "screen" });
    t.send({ type: "editor-played" });
    t.send(played(12.85, { camera: 11.5, screen: 11.5 }));
    expect(t.effects).toEqual([
      { type: "hold-clock", holdId: 1, expiresAfterMs: MAX_HOLD_MS },
    ]);
    t.send({ type: "source-seeked", source: "camera" });
    expect(t.effects).toEqual([]);
    t.send({ type: "source-seeked", source: "screen" });
    expect(t.effects).toEqual([
      { type: "play-sources", rate: 1, sources: ["camera", "screen"] },
      { type: "play-clock" },
    ]);
  });

  it("starts anyway when a held seek never lands, and forgets a hold the editor paused", () => {
    const t = start()
      .send({ type: "editor-played" })
      .send(played(9.85, { camera: 0 }));
    t.send({ type: "hold-expired", holdId: 1 });
    expect(t.effects).toEqual([
      { type: "play-sources", rate: 1, sources: ["camera", "screen"] },
      { type: "play-clock" },
    ]);

    const u = start()
      .send({ type: "editor-played" })
      .send(played(9.85, { camera: 0 }))
      .send({ type: "editor-paused" });
    u.send({ type: "source-seeked", source: "camera" });
    u.send({ type: "hold-expired", holdId: 1 });
    expect(u.effects).toEqual([]);
    expect(u.state.playing).toBe(false);
  });

  it("pulls small drift back by playback rate, and lets go once it is closed", () => {
    const t = start().send({ type: "editor-played" }).send(played(9.85));
    t.send(ticked(11, { camera: 11.25, screen: 11.07 }));
    expect(t.effects).toEqual([
      { type: "set-sources-rate", rate: 0.9, sources: ["camera"] },
      { type: "set-sources-rate", rate: 1.1, sources: ["screen"] },
    ]);
    t.send(ticked(11.5, { camera: 11.69, screen: 11.62 }));
    expect(t.effects).toEqual([]);
    t.send(ticked(12, { camera: 12.155, screen: 12.145 }));
    expect(t.effects).toEqual([
      { type: "set-sources-rate", rate: 1, sources: ["camera"] },
      { type: "set-sources-rate", rate: 1, sources: ["screen"] },
    ]);
  });

  it("reseeks only a picture that is far off, and never while its seek is in flight", () => {
    const t = start().send({ type: "editor-played" }).send(played(9.85));
    t.send(ticked(11, { camera: 10.4 }));
    expect(t.effects).toEqual([
      { type: "seek-sources", at: 11.15, sources: ["camera"] },
    ]);
    t.send(ticked(11.5, { camera: 11.15 }));
    expect(t.effects).toEqual([]);
    t.send({ type: "source-seeked", source: "camera" });
    expect(t.effects).toEqual([]);
    t.send(ticked(12, { camera: 11.2 }));
    expect(t.effects).toEqual([
      { type: "seek-sources", at: 12.15, sources: ["camera"] },
    ]);
  });

  it("pauses the picture with the mic without seeking it, and does not chase drift while paused", () => {
    const t = start().send({ type: "editor-played" }).send(played(9.85));
    t.send(paused(10.35, { camera: 10.8 }));
    expect(t.effects).toEqual([
      { type: "pause-sources", sources: ["camera", "screen"] },
    ]);
    expect(t.state.playing).toBe(false);
    t.send(ticked(11, { camera: 9, screen: 9 }));
    expect(t.effects).toEqual([]);
  });

  it("follows the mic's playback rate, and switches scene where the Recording Session did", () => {
    const t = start().send(played(9.85));
    t.send({ type: "clock-rate-changed", rate: 2 });
    expect(t.effects).toEqual([
      { type: "set-sources-rate", rate: 2, sources: ["camera", "screen"] },
    ]);
    t.send(ticked(11.86));
    expect(compositeScene(t.state)).toBe("Camera");
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

  it("cues and starts on the camera alone", () => {
    const t = cameraOnly()
      .send({ type: "editor-played" })
      .send(played(9.85, { camera: 0, screen: 0 }));
    expect(t.effects).toEqual([
      { type: "seek-sources", at: 10, sources: ["camera"] },
      { type: "hold-clock", holdId: 1, expiresAfterMs: MAX_HOLD_MS },
    ]);
    t.send({ type: "source-seeked", source: "camera" });
    expect(t.effects).toEqual([
      { type: "play-sources", rate: 1, sources: ["camera"] },
      { type: "play-clock" },
    ]);
  });

  it("cues and plays a screen the changed Clip Source starts to draw, and forgets one it stops drawing", () => {
    const t = cameraOnly().send(played(9.85)).send(ticked(10.85));
    t.send({
      type: "clip-source-changed",
      segments: [{ scene: "Code", startSeconds: 10, endSeconds: 14 }],
      offsetSeconds: 0.15,
      sources: ["camera", "screen"],
    });
    expect(t.effects).toEqual([
      { type: "seek-sources", at: 11, sources: ["screen"] },
      { type: "play-sources", rate: 1, sources: ["screen"] },
    ]);
    expect(t.state.seeking).toEqual(["screen"]);

    t.send({
      type: "clip-source-changed",
      segments: [{ scene: "Camera", startSeconds: 10, endSeconds: 14 }],
      offsetSeconds: 0.15,
      sources: ["camera"],
    });
    expect(t.effects).toEqual([]);
    expect(t.state.seeking).toEqual([]);
  });
});
