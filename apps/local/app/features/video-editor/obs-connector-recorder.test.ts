import { describe, expect, it } from "vitest";
import {
  createInitialOBSConnectorState,
  obsConnectorReducer,
  type useOBSConnector,
} from "./obs-connector";

const start = (usesObs: boolean) => {
  const effects: useOBSConnector.Effect[] = [];
  const exec = (e: useOBSConnector.Effect) => {
    effects.push(e);
  };
  let state = createInitialOBSConnectorState(usesObs, exec);
  const send = (action: useOBSConnector.Action) => {
    state = obsConnectorReducer(state, action, exec as never);
    return state;
  };
  return { send, effects, state: () => state };
};

const connected = {
  type: "obs-connected",
  profile: "Landscape Recording",
  scene: "Camera",
} as const;

describe("the OBS connector and the Video's Recorder", () => {
  it("an OBS Video connects to OBS and follows its recording, as today", () => {
    const obs = start(true);
    expect(obs.effects).toEqual([{ type: "attempt-to-connect" }]);
    obs.send(connected);
    expect(
      obs.send({ type: "recording-started", outputPath: "/a.mkv" })
    ).toEqual({
      type: "obs-recording",
      profile: "Landscape Recording",
      scene: "Camera",
      latestOutputPath: "/a.mkv",
    });
  });

  it("a New recorder Video never connects to OBS and ignores what it reports", () => {
    const newRecorder = start(false);
    expect(newRecorder.effects).toEqual([]);
    newRecorder.send({ type: "connection-closed" });
    newRecorder.send({ type: "recording-started", outputPath: "/a.mkv" });
    expect(newRecorder.state()).toEqual({ type: "obs-not-used" });
    expect(newRecorder.effects).toEqual([]);
  });

  it("switching a connected Video to the New recorder disconnects OBS, and back reconnects", () => {
    const video = start(true);
    video.send(connected);
    video.effects.length = 0;

    video.send({ type: "video-recorder-changed", usesObs: false });
    expect(video.state()).toEqual({ type: "obs-not-used" });
    expect(video.effects).toEqual([{ type: "disconnect" }]);

    video.effects.length = 0;
    video.send({ type: "video-recorder-changed", usesObs: true });
    expect(video.effects).toEqual([{ type: "attempt-to-connect" }]);
  });

  it("a connection that lands after switching to the New recorder is dropped", () => {
    const video = start(true);
    video.send({ type: "video-recorder-changed", usesObs: false });
    video.effects.length = 0;
    video.send(connected);
    expect(video.state()).toEqual({ type: "obs-not-used" });
    expect(video.effects).toEqual([{ type: "disconnect" }]);
  });
});
