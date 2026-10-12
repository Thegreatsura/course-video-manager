import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import { clipCompositePicture, clipSource } from "@/packages/clip-source";
import {
  clipStateReducer,
  type ClipOnDatabase,
  type DatabaseId,
  type FrontendId,
} from "./clip-state-reducer";
import { clipStillUrl } from "./clip-still-url";

/**
 * Overriding a New-recorder Clip's scene in the editor: playback and stills
 * follow at once, before the server answers.
 */

/** 10-20 s of a Recording Session that went Camera at 0, Code at 15. */
const newRecorderClip = (
  overrides: Partial<ClipOnDatabase> = {}
): ClipOnDatabase =>
  fromPartial({
    type: "on-database",
    frontendId: "f-a" as FrontendId,
    databaseId: "a" as DatabaseId,
    videoFilename: "/rec/mic.mkv",
    sourceStartTime: 10,
    sourceEndTime: 20,
    scene: "Camera",
    zoomType: "none",
    recordingSession: {
      id: "session-1",
      cameraFilePath: "/rec/camera.mkv",
      screenFilePath: "/rec/screen.mkv",
      micFilePath: "/rec/mic.mkv",
      micOffsetMs: 0,
      sceneEvents: [
        { fileTime: 0, scene: "Camera" },
        { fileTime: 15, scene: "Code" },
      ],
    },
    sceneOverride: null,
    ...overrides,
  });

const tester = (items: ClipOnDatabase[]) =>
  new ReducerTester(clipStateReducer, {
    clipIdsWithTranscriptWords: new Set<DatabaseId>(),
    items,
    insertionPoint: { type: "end" },
    insertionOrder: 0,
    error: null,
    sessions: [],
    clipTranscriptionJobs: {},
    jobEventCursor: 0,
  });

const shown = (t: ReturnType<typeof tester>) =>
  t.getState().items[0] as ClipOnDatabase;

const scenesPlayed = (clip: ClipOnDatabase) =>
  clipCompositePicture(clipSource(clip), { from: 10, to: 20 })?.segments.map(
    (s) => s.scene
  );

describe("Scene Override in the editor", () => {
  it("redraws playback and stills in the override at once, and saves it", () => {
    const t = tester([newRecorderClip()]);
    const stillBefore = clipStillUrl(shown(t), "first");
    expect(scenesPlayed(shown(t))).toEqual(["Camera", "Code"]);

    t.send({
      type: "set-scene-override",
      clipId: "f-a" as FrontendId,
      sceneOverride: "No Face",
    });

    expect(shown(t).sceneOverride).toBe("No Face");
    expect(scenesPlayed(shown(t))).toEqual(["No Face"]);
    expect(clipStillUrl(shown(t), "first")).not.toBe(stillBefore);
    expect(t.getEffects()).toEqual([
      {
        type: "update-scene-override",
        clipId: "a",
        sceneOverride: "No Face",
      },
    ]);

    t.send({
      type: "set-scene-override",
      clipId: "f-a" as FrontendId,
      sceneOverride: null,
    });
    expect(scenesPlayed(shown(t))).toEqual(["Camera", "Code"]);
    expect(clipStillUrl(shown(t), "first")).toBe(stillBefore);
  });

  it("drops a zoom the override makes illegal, as the server does", () => {
    const t = tester([newRecorderClip({ zoomType: "subtle" })]);

    t.send({
      type: "set-scene-override",
      clipId: "f-a" as FrontendId,
      sceneOverride: "Code",
    });
    expect(shown(t).zoomType).toBe("none");

    t.send({ type: "toggle-zoom-for-clip", clipId: "f-a" as FrontendId });
    expect(shown(t).zoomType).toBe("none");
  });

  it("ignores an OBS Clip", () => {
    const obs = newRecorderClip({ recordingSession: null });
    const t = tester([obs]);

    t.send({
      type: "set-scene-override",
      clipId: "f-a" as FrontendId,
      sceneOverride: "Code",
    });

    expect(shown(t)).toBe(obs);
    expect(t.getEffects()).toEqual([]);
  });
});
