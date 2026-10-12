import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  clipStateReducer,
  type ClipOnDatabase,
  type DatabaseId,
  type FrontendId,
} from "./clip-state-reducer";
import {
  canStop,
  createInitialCvmRecorderState,
  cvmRecorderReducer,
} from "./cvm-recorder-reducer";
import type { CvmRecorderMessage } from "./cvm-recorder-wire";

/**
 * An editor loaded (or reloaded) while the CVM recorder is mid-take: its
 * Clips so far come from the loader, and the take from what the app server
 * says first to every editor that listens (`recorder-status`, then the
 * scene). It never heard `recording-started`.
 */

const SESSION = "session-1";

const saved = (id: string): ClipOnDatabase =>
  fromPartial({
    type: "on-database",
    frontendId: `f-${id}` as FrontendId,
    databaseId: id as DatabaseId,
  });

/** What the app server says to an editor subscribing mid-take. */
const onSubscribe: CvmRecorderMessage[] = [
  {
    type: "recorder-status",
    reachable: true,
    problem: null,
    recordingSessionId: SESSION,
    previews: {
      camera: "http://r/preview/camera",
      screen: "http://r/preview/screen",
    },
    still: "http://r/still",
  },
  { type: "scene-changed", scene: "Camera" },
];

/** The editor's two reducers, each hearing every message, as useCvmRecorder does. */
const loadEditor = (items: ClipOnDatabase[]) => {
  const recorder = new ReducerTester(
    cvmRecorderReducer,
    createInitialCvmRecorderState()
  );
  const clips = new ReducerTester(clipStateReducer, {
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
  const hear = (message: CvmRecorderMessage) => {
    recorder.send({ type: "recorder-message-heard", message });
    clips.send({
      type: "cvm-recorder-message-heard",
      message,
      receivedAt: 1_000,
    });
  };
  return { recorder, clips, hear };
};

const databaseIds = (items: { type: string; databaseId?: string }[]) =>
  items.map((i) => i.databaseId ?? i.type);

describe("an editor that loads mid-recording", () => {
  it("shows the recording in progress, the current scene, and the Clips so far, and adds the next", () => {
    const editor = loadEditor([saved("a"), saved("b")]);
    onSubscribe.forEach(editor.hear);

    const recorder = editor.recorder.getState();
    expect(recorder.phase).toBe("recording");
    expect(canStop(recorder)).toBe(true);
    expect(recorder.scene).toBe("Camera");

    const clips = editor.clips.getState();
    expect(databaseIds(clips.items)).toEqual(["a", "b"]);
    expect(clips.sessions).toMatchObject([
      { id: SESSION, status: "recording", cvmRecorder: true },
    ]);

    editor.hear({
      type: "clips-saved",
      recordingSessionId: SESSION,
      clips: [
        fromPartial({
          id: "c" as DatabaseId,
          videoFilename: "/mnt/d/r/mic.mkv",
          sourceStartTime: 2.15,
          sourceEndTime: 5.23,
          pauseType: "none",
          zoomType: "none",
          diagramSnapshotId: null,
          transcriptionStatus: "queued",
        }),
      ],
      placedAt: { type: "after-clip", databaseClipId: "b" },
      transcriptionJobId: "job-1",
    });
    expect(databaseIds(editor.clips.getState().items)).toEqual(["a", "b", "c"]);
  });

  it("tells a restarted app server its insertion point again when it hears the take it is already in", () => {
    const editor = loadEditor([saved("a"), saved("b")]);
    onSubscribe.forEach(editor.hear);
    const before = editor.clips.getEffects().length;

    // The app server restarted: the editor's EventSource reconnects.
    editor.hear(onSubscribe[0]!);

    expect(editor.clips.getEffects().slice(before)).toContainEqual({
      type: "send-recorder-insertion-point",
      insertionPoint: { type: "after-clip", databaseClipId: "b" },
    });
  });
});
