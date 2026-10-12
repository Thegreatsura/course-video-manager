import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import { clipPlaybackUrl, clipSource } from "@/packages/clip-source";
import { MIC_OFFSET_SHARED_WITH_FROZEN_VERSION_MESSAGE } from "@/services/recording-session-shared-message";
import {
  clipStateReducer,
  type ClipOnDatabase,
  type DatabaseId,
  type FrontendId,
} from "./clip-state-reducer";

/**
 * The editor's Mic Settings dialog on a New-recorder Clip: the Recording
 * Session's mic offset, and the mic EQ every New-recorder Video shares.
 */

const OBS_EQ = { lowDb: 0, midDb: 0, highDb: -6.1 };

const newRecorderClip = (
  id: string,
  sessionId: string,
  range: [number, number]
): ClipOnDatabase =>
  fromPartial({
    type: "on-database",
    frontendId: `f-${id}` as FrontendId,
    databaseId: id as DatabaseId,
    videoFilename: `/rec/${sessionId}/mic.mkv`,
    sourceStartTime: range[0],
    sourceEndTime: range[1],
    scene: "Code",
    zoomType: "none",
    recordingSession: {
      id: sessionId,
      cameraFilePath: `/rec/${sessionId}/camera.mkv`,
      screenFilePath: `/rec/${sessionId}/screen.mkv`,
      micFilePath: `/rec/${sessionId}/mic.mkv`,
      micOffsetMs: 150,
      micEq: null,
      sceneEvents: [{ fileTime: 0, scene: "Code" }],
    },
    sceneOverride: null,
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
    micOffsetRefusal: null,
  });

const played = (t: ReturnType<typeof tester>) =>
  (t.getState().items as ClipOnDatabase[]).map((c) =>
    clipPlaybackUrl(clipSource(c), {
      from: c.sourceStartTime,
      to: c.sourceEndTime,
    })
  );

describe("Mic Settings in the editor", () => {
  it("a new offset replays every Clip of that Recording Session against the shifted mic at once, and saves it", () => {
    const t = tester([
      newRecorderClip("a", "s1", [10, 20]),
      newRecorderClip("b", "s1", [25, 30]),
      newRecorderClip("c", "s2", [10, 20]),
    ]);

    t.send({
      type: "mic-settings-submitted",
      clipId: "f-b" as FrontendId,
      micOffsetMs: 200,
      micEq: OBS_EQ,
    });

    expect(played(t)).toEqual([
      "/view-video?videoPath=%2Frec%2Fs1%2Fmic.mkv#t=9.8,19.8",
      "/view-video?videoPath=%2Frec%2Fs1%2Fmic.mkv#t=24.8,29.8",
      "/view-video?videoPath=%2Frec%2Fs2%2Fmic.mkv#t=9.85,19.85",
    ]);
    expect(
      (t.getState().items as ClipOnDatabase[]).map((c) => [
        c.sourceStartTime,
        c.sourceEndTime,
      ])
    ).toEqual([
      [10, 20],
      [25, 30],
      [10, 20],
    ]);
    expect(t.getEffects()).toEqual([
      {
        type: "update-mic-offset",
        clipId: "b",
        micOffsetMs: 200,
        frontendClipId: "f-b",
        recordingSessionId: "s1",
        previousMicOffsetMs: 150,
      },
    ]);
  });

  it("a new EQ is saved once and shown on every Recording Session's Clips", () => {
    const quieterHighs = { lowDb: 0, midDb: 0, highDb: -3 };
    const t = tester([
      newRecorderClip("a", "s1", [10, 20]),
      newRecorderClip("c", "s2", [10, 20]),
    ]);

    t.send({
      type: "mic-settings-submitted",
      clipId: "f-a" as FrontendId,
      micOffsetMs: 150,
      micEq: quieterHighs,
    });

    expect(
      (t.getState().items as ClipOnDatabase[]).map(
        (c) => c.recordingSession?.micEq
      )
    ).toEqual([quieterHighs, quieterHighs]);
    expect(t.getEffects()).toEqual([
      { type: "update-mic-eq", micEq: quieterHighs },
    ]);
  });

  it("an offset refused because a Submitted Version shares the Recording Session goes back, and the dialog says why", () => {
    const t = tester([
      newRecorderClip("a", "s1", [10, 20]),
      newRecorderClip("b", "s1", [25, 30]),
    ]);
    t.send({
      type: "mic-settings-submitted",
      clipId: "f-b" as FrontendId,
      micOffsetMs: 200,
      micEq: OBS_EQ,
    });
    const [save] = t.getEffects() as Extract<
      clipStateReducer.Effect,
      { type: "update-mic-offset" }
    >[];

    t.send({
      type: "mic-offset-save-failed",
      effect: save!,
      message: MIC_OFFSET_SHARED_WITH_FROZEN_VERSION_MESSAGE,
    });

    expect(played(t)).toEqual([
      "/view-video?videoPath=%2Frec%2Fs1%2Fmic.mkv#t=9.85,19.85",
      "/view-video?videoPath=%2Frec%2Fs1%2Fmic.mkv#t=24.85,29.85",
    ]);
    expect(t.getState().micOffsetRefusal).toEqual({
      clipId: "f-b",
      message: MIC_OFFSET_SHARED_WITH_FROZEN_VERSION_MESSAGE,
    });
    expect(t.getState().error).toBeNull();

    t.send({ type: "mic-offset-refusal-dismissed" });
    expect(t.getState().micOffsetRefusal).toBeNull();
  });
});
