import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vitest";
import { clipRestoreRefusal } from "@cvm/core/features/videos/recorder";
import {
  clipStateReducer,
  type ClipOnDatabase,
  type DatabaseId,
  type FrontendId,
} from "./clip-state-reducer";
import { ReducerTester } from "@/test-utils/reducer-tester";

/**
 * Archiving every Clip unlocks a Video's Recorder; once it has switched, a
 * Clip filmed with the other Recorder may not be restored (#2043). The editor
 * blocks that restore up front, and rolls back any restore the server refuses.
 */

const newRecorderClip = fromPartial<ClipOnDatabase>({
  type: "on-database",
  frontendId: "fe-new" as FrontendId,
  databaseId: "db-new" as DatabaseId,
  recordingSession: fromPartial({ id: "session-1" }),
  shouldArchive: true,
});

const obsClip = fromPartial<ClipOnDatabase>({
  type: "on-database",
  frontendId: "fe-obs" as FrontendId,
  databaseId: "db-obs" as DatabaseId,
  recordingSession: null,
  shouldArchive: true,
});

const createTester = () =>
  new ReducerTester(clipStateReducer, {
    clipIdsWithTranscriptWords: new Set<DatabaseId>(),
    items: [newRecorderClip, obsClip],
    insertionPoint: { type: "end" },
    insertionOrder: 0,
    error: null,
    sessions: [],
    clipTranscriptionJobs: {},
    jobEventCursor: 0,
    micOffsetRefusal: null,
  });

const isArchived = (
  tester: ReturnType<typeof createTester>,
  frontendId: string
) =>
  (
    tester.getState().items.find((i) => i.frontendId === frontendId) as
      ClipOnDatabase | undefined
  )?.shouldArchive === true;

const refusal = clipRestoreRefusal("obs", { recordingSessionId: "session-1" })!;

describe("restoring a Clip filmed with the other Recorder", () => {
  it("is blocked up front: the Clip stays archived and the refusal is shown", () => {
    const tester = createTester().send({
      type: "restore-clip",
      clipId: newRecorderClip.frontendId,
      videoRecorder: "obs",
    });

    expect(isArchived(tester, newRecorderClip.frontendId)).toBe(true);
    expect(tester.getState().error).toBeNull();
    expect(tester.getEffects()).toEqual([
      { type: "show-clip-restore-refused-toast", message: refusal },
    ]);
  });

  it("restores a Clip filmed with the Video's own Recorder", () => {
    const tester = createTester().send({
      type: "restore-clip",
      clipId: obsClip.frontendId,
      videoRecorder: "obs",
    });

    expect(isArchived(tester, obsClip.frontendId)).toBe(false);
    expect(tester.getEffects()).toEqual([
      { type: "unarchive-clips", clipIds: ["db-obs"] },
    ]);
  });

  it("rolls back a restore the server refuses, and shows why", () => {
    // The editor thought the Video still recorded with the New recorder (say,
    // another tab switched it), so it sent the restore.
    const tester = createTester()
      .send({
        type: "restore-clip",
        clipId: newRecorderClip.frontendId,
        videoRecorder: "new-recorder",
      })
      .send({
        type: "clip-restore-failed",
        clipIds: ["db-new" as DatabaseId],
        message: refusal,
      });

    expect(isArchived(tester, newRecorderClip.frontendId)).toBe(true);
    expect(tester.getState().error).toBeNull();
    expect(tester.getEffects()).toEqual([
      { type: "unarchive-clips", clipIds: ["db-new"] },
      { type: "show-clip-restore-refused-toast", message: refusal },
    ]);
  });

  it("rolls back any other failed restore and treats it as fatal", () => {
    const tester = createTester()
      .send({
        type: "restore-clip",
        clipId: obsClip.frontendId,
        videoRecorder: "obs",
      })
      .send({
        type: "clip-restore-failed",
        clipIds: ["db-obs" as DatabaseId],
        message: "ClipService request failed: 500 Internal server error",
      });

    expect(isArchived(tester, obsClip.frontendId)).toBe(true);
    expect(tester.getState().error).toMatchObject({
      effectType: "unarchive-clips",
      message: "ClipService request failed: 500 Internal server error",
    });
    expect(tester.getEffects()).toEqual([
      { type: "unarchive-clips", clipIds: ["db-obs"] },
    ]);
  });
});
