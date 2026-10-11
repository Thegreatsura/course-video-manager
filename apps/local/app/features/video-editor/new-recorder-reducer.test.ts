import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  canRecord,
  createInitialNewRecorderState,
  newRecorderReducer,
} from "./new-recorder-reducer";
import type { NewRecorderMessage } from "./new-recorder-wire";

const heard = (message: NewRecorderMessage) =>
  ({ type: "recorder-message-heard", message }) as const;

const status = (
  o: Partial<Extract<NewRecorderMessage, { type: "recorder-status" }>> = {}
) =>
  heard({
    type: "recorder-status",
    reachable: true,
    problem: null,
    recordingSessionId: null,
    ...o,
  });

const pressRecord = {
  type: "press-record",
  silenceLength: "long",
  insertionPoint: { type: "start" },
} as const;

const stoppedMessage = (
  o: Partial<Extract<NewRecorderMessage, { type: "recording-stopped" }>> = {}
): NewRecorderMessage => ({
  type: "recording-stopped",
  recordingSessionId: "s1",
  errors: [],
  crashed: false,
  framesLost: { camera: 0, screen: 0 },
  ...o,
});

const recording = () =>
  tester()
    .send(status())
    .send(pressRecord)
    .send(
      heard({
        type: "recording-started",
        recordingSessionId: "s1",
        silenceLength: "long",
        micFile: "mic.mkv",
      })
    );

const tester = () =>
  new ReducerTester(newRecorderReducer, createInitialNewRecorderState());

describe("the New recorder's Record and Stop", () => {
  it("records only once the recorder service is there and able", () => {
    const t = tester();
    t.send(pressRecord);
    t.send(status({ problem: "ffmpeg 8.1 is not 8.0.1" })).send(pressRecord);
    expect(canRecord(t.getState())).toBe(false);
    expect(t.getEffects()).toEqual([]);

    t.send(status()).send(pressRecord);
    expect(t.getEffects()).toEqual([
      {
        type: "start-recording",
        silenceLength: "long",
        insertionPoint: { type: "start" },
      },
    ]);
    expect(t.getState().phase).toBe("starting");
  });

  it("follows the recorder through a recording and Stop", () => {
    const t = tester();
    t.send(status())
      .send(pressRecord)
      .send(
        heard({
          type: "recording-started",
          recordingSessionId: "s1",
          silenceLength: "long",
          micFile: "mic.mkv",
        })
      )
      .send(heard({ type: "speech-started", recordingSessionId: "s1" }));
    expect(t.getState()).toMatchObject({ phase: "recording", speaking: true });

    t.send({ type: "press-stop" }).send(heard(stoppedMessage()));
    expect(t.getState()).toMatchObject({ phase: "idle", speaking: false });
    expect(t.getEffects().map((e) => e.type)).toEqual([
      "start-recording",
      "stop-recording",
    ]);
  });

  it("shows a recording it did not start, and can stop it", () => {
    const t = tester();
    t.send(status({ recordingSessionId: "s1" })).send({ type: "press-stop" });
    expect(t.getEffects()).toEqual([{ type: "stop-recording" }]);
  });

  it("shows why Record was refused and lets it be pressed again", () => {
    const t = tester();
    t.send(status())
      .send(pressRecord)
      .send({ type: "start-recording-failed", message: "Close OBS first" });
    expect(t.getState()).toMatchObject({
      phase: "idle",
      error: "Close OBS first",
    });

    t.send(pressRecord);
    expect(t.getState().error).toBeNull();
    expect(t.getEffects()).toHaveLength(2);
  });

  it("raises a loud alert when the camera is lost, back to not recording, until dismissed", () => {
    const t = recording()
      .send(heard({ type: "speech-started", recordingSessionId: "s1" }))
      .send(
        heard({
          type: "camera-lost",
          recordingSessionId: "s1",
          errors: ["I/O error"],
        })
      );
    expect(t.getState()).toMatchObject({ phase: "idle", speaking: false });
    expect(t.getState().alert).toContain("Cam Link");
    expect(t.getState().alert).toContain("replug");
    expect(canRecord(t.getState())).toBe(true);

    // The stop that follows does not hide it; dismissing does.
    t.send(heard(stoppedMessage()));
    expect(t.getState().alert).toContain("Cam Link");
    t.send({ type: "dismiss-alert" });
    expect(t.getState().alert).toBeNull();
  });

  it("shows the frames lost once a recording stops", () => {
    const t = recording();
    expect(t.getState().framesLost).toBeNull();

    t.send(heard(stoppedMessage({ framesLost: { camera: 1, screen: 0 } })));
    expect(t.getState().framesLost).toEqual({ camera: 1, screen: 0 });

    t.send(pressRecord);
    expect(t.getState().framesLost).toBeNull();
  });

  it("says a Recording Session was cut off by a crash and its Clips kept", () => {
    const t = recording().send(
      heard(stoppedMessage({ crashed: true, framesLost: null }))
    );
    expect(t.getState().phase).toBe("idle");
    expect(t.getState().alert).toContain("crash");
  });
});
