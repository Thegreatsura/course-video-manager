import { describe, expect, it } from "vitest";
import type { ClipOnDatabase, FrontendId } from "../clip-state-reducer";
import { clipScenePicker } from "./clip-scene-picker";

const cvmRecorderClip = (session: {
  format: "landscape" | "short";
  screenCaptured: boolean;
}) =>
  ({
    type: "on-database",
    frontendId: "f-a" as FrontendId,
    recordingSession: {
      id: "session-1",
      cameraFilePath: "/rec/camera.mkv",
      screenFilePath: "/rec/screen.mkv",
      micFilePath: "/rec/mic.mkv",
      micOffsetMs: 0,
      micEq: null,
      sceneEvents: [{ fileTime: 0, scene: "Camera" }],
      ...session,
    },
    sceneOverride: null,
  }) as unknown as ClipOnDatabase;

const optionValues = (clip: ClipOnDatabase) => {
  const picker = clipScenePicker(clip, () => {});
  return picker ? picker.options.map((o) => o.value) : null;
};

describe("clipScenePicker", () => {
  it("offers every scene on a Clip whose Recording Session captured its screen", () => {
    for (const format of ["landscape", "short"] as const) {
      expect(
        optionValues(cvmRecorderClip({ format, screenCaptured: true }))
      ).toEqual(["follow-live-scenes", "Camera", "Code", "No Face"]);
    }
  });

  it("offers only Camera (and clear) on a camera-only Recording Session", () => {
    expect(
      optionValues(cvmRecorderClip({ format: "short", screenCaptured: false }))
    ).toEqual(["follow-live-scenes", "Camera"]);
  });
});
