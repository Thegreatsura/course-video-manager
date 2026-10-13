import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import type { InsertionPoint } from "@/services/clip-service";
import {
  clipStateReducer,
  type ClipOnDatabase,
  type DatabaseId,
  type FrontendId,
} from "./clip-state-reducer";
import type { CvmRecorderMessage } from "./cvm-recorder-wire";

/**
 * The Take, through the clip reducer, the same for both Recorders: each
 * Recorder's facts drive the same scenario, and the editor must end up in
 * the same place. A Recorder here is only how its facts are spelled.
 */

type Tester = ReducerTester<
  clipStateReducer.State,
  clipStateReducer.Action,
  clipStateReducer.Effect
>;

type Recorder = {
  name: string;
  /** Recording Session `n` (1 by default) starts. */
  startRecording: (t: Tester, n?: number) => void;
  startTake: (t: Tester, n: number, session?: number) => void;
  /** The Recorder saves the take's Clip where it was told to, and says so. */
  saveTake: (t: Tester, clipId: string, session?: number) => void;
  /** Recording Session `n` stops, and everything it heard is in. */
  stopRecording: (t: Tester, n?: number) => void;
};

const dbClip = (id: string) =>
  fromPartial<DB_Clip>({
    id: id as DatabaseId,
    videoFilename: "footage.mkv",
    sourceStartTime: 1,
    sourceEndTime: 2,
    scene: null,
    profile: null,
    pauseType: "none",
    zoomType: "none",
    diagramSnapshotId: null,
    transcriptionStatus: "queued",
  });
type DB_Clip = Extract<
  CvmRecorderMessage,
  { type: "clips-saved" }
>["clips"][number];

const obsFile = (n = 1) => `/obs/take-${n}.mkv`;
const obs: Recorder = {
  name: "OBS",
  startRecording: (t, n) =>
    t.send({
      type: "recording-started",
      outputPath: obsFile(n),
      silenceLength: "short",
    }),
  startTake: (t, n) =>
    t.send({
      type: "take-started",
      soundDetectionId: `sound-${n}`,
      scene: "Camera",
      profile: "Landscape",
      at: 0,
    }),
  saveTake: (t, clipId, session) =>
    t.send({
      type: "new-database-clips",
      clips: [dbClip(clipId)],
      outputPath: obsFile(session),
      transcriptionJobId: `job-${clipId}`,
    }),
  stopRecording: (t, n) => {
    t.send({ type: "recording-stopped" });
    const session = t
      .getState()
      .sessions.find((s) => s.outputPath === obsFile(n))!;
    t.send({ type: "session-polling-complete", sessionId: session.id });
  },
};

const sessionId = (n = 1) => `session-${n}`;
const SESSION = sessionId(1);
const heard = (message: CvmRecorderMessage) =>
  ({ type: "cvm-recorder-message-heard", message, receivedAt: 0 }) as const;

/**
 * The app server's side of the CVM recorder (`recorder-client/
 * client.server.ts`): where it saves the next Clip. The editor tells it
 * (`send-recorder-insertion-point`), and it moves after each Clip it saves.
 */
type AppServer = { point: InsertionPoint | undefined; heard: number };
const appServers = new WeakMap<Tester, AppServer>();
const appServer = (t: Tester): AppServer => {
  let server = appServers.get(t);
  if (!server) appServers.set(t, (server = { point: undefined, heard: 0 }));
  const effects = t.getEffects();
  for (const effect of effects.slice(server.heard))
    if (effect.type === "send-recorder-insertion-point")
      server.point = effect.insertionPoint;
  server.heard = effects.length;
  return server;
};
/** Where the app server will save the CVM recorder's next Clip. */
const serverPoint = (t: Tester): InsertionPoint => {
  const point = appServer(t).point;
  if (!point) throw new Error("The app server was never told where");
  return point;
};
/** The point names a Clip the editor has deleted: saving there failed (#2163). */
const namesDeletedClip = (t: Tester, point: InsertionPoint) =>
  point.type === "after-clip" &&
  t
    .getState()
    .items.some(
      (i) =>
        i.type === "on-database" &&
        i.databaseId === point.databaseClipId &&
        i.shouldArchive
    );
const cvm: Recorder = {
  name: "CVM recorder",
  startRecording: (t, n) =>
    t.send(
      heard({
        type: "recording-started",
        recordingSessionId: sessionId(n),
        silenceLength: "short",
        micFile: "mic.mkv",
      })
    ),
  startTake: (t, n, session) =>
    t.send({
      type: "take-started",
      recordingSessionId: sessionId(session),
      soundDetectionId: `cvm-recorder-speech-${n}`,
      scene: null,
      profile: null,
      at: 0,
    }),
  saveTake: (t, clipId, session) => {
    const placedAt = serverPoint(t);
    if (namesDeletedClip(t, placedAt))
      throw new Error(
        `The app server was left saving after a deleted Clip: ${JSON.stringify(placedAt)}`
      );
    appServer(t).point = { type: "after-clip", databaseClipId: clipId };
    t.send(
      heard({
        type: "clips-saved",
        recordingSessionId: sessionId(session),
        clips: [dbClip(clipId)],
        placedAt,
        transcriptionJobId: `job-${clipId}`,
      })
    ).send(
      heard({ type: "speech-ended", recordingSessionId: sessionId(session) })
    );
  },
  stopRecording: (t, n) =>
    t.send(
      heard({
        type: "recording-stopped",
        recordingSessionId: sessionId(n),
        errors: [],
        crashed: false,
        framesLost: { camera: 0, screen: 0 },
      })
    ),
};

const saved = (id: string): ClipOnDatabase =>
  fromPartial({
    type: "on-database",
    frontendId: `f-${id}` as FrontendId,
    databaseId: id as DatabaseId,
    pauseType: "none",
  });

const tester = (items: ClipOnDatabase[]): Tester =>
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

const shown = (t: Tester) =>
  t
    .getState()
    .items.filter((i) => !("shouldArchive" in i && i.shouldArchive))
    .map((i) => (i.type === "on-database" ? i.databaseId : i.type));

const archived = (t: Tester) =>
  t
    .getState()
    .items.filter((i) => "shouldArchive" in i && i.shouldArchive)
    .map((i) => (i.type === "on-database" ? i.databaseId : i.type));

describe.each([obs, cvm])("a take on the $name", (recorder) => {
  it("shows the take as an Optimistic Clip at the insertion point, filled in where it stands", () => {
    const t = tester([saved("a"), saved("b")]);
    t.send({ type: "set-insertion-point-after", clipId: "f-a" as FrontendId });
    recorder.startRecording(t);

    recorder.startTake(t, 1);
    expect(shown(t)).toEqual(["a", "optimistically-added", "b"]);

    recorder.saveTake(t, "c1");
    expect(shown(t)).toEqual(["a", "c1", "b"]);
    const c1 = t.getState().items[1]!;
    expect(t.getState().insertionPoint).toEqual({
      type: "after-clip",
      frontendClipId: c1.frontendId,
    });
  });

  it("Stream Deck delete during a take archives that take, not the Clip before it, and keeps its Footage", () => {
    const t = tester([saved("a")]);
    recorder.startRecording(t);
    recorder.startTake(t, 1);

    t.send({ type: "delete-latest-inserted-clip" });
    expect(shown(t)).toEqual(["a"]);
    expect(t.getEffects().map((e) => e.type)).not.toContain("archive-clips");

    // The take is saved anyway, and arrives archived: never deleted.
    recorder.saveTake(t, "c1");
    expect(shown(t)).toEqual(["a"]);
    expect(archived(t)).toEqual(["c1"]);
    expect(t.getEffects()).toContainEqual({
      type: "archive-clips",
      clipIds: ["c1"],
    });
    expect(t.getState().insertionPoint).toEqual({ type: "end" });
  });

  it("restores a take deleted mid-take in place, and the next take lands at the insertion point", () => {
    const t = tester([saved("a"), saved("b")]);
    t.send({ type: "set-insertion-point-after", clipId: "f-a" as FrontendId });
    recorder.startRecording(t);

    recorder.startTake(t, 1);
    t.send({ type: "delete-latest-inserted-clip" });
    recorder.saveTake(t, "c1");

    // The next take goes where the insertion point went back to: after a.
    recorder.startTake(t, 2);
    recorder.saveTake(t, "c2");
    expect(shown(t)).toEqual(["a", "c2", "b"]);

    const c1 = t
      .getState()
      .items.find((i) => i.type === "on-database" && i.databaseId === "c1")!;
    t.send({ type: "restore-clip", clipId: c1.frontendId });
    expect(t.getEffects().at(-1)).toEqual({
      type: "unarchive-clips",
      clipIds: ["c1"],
    });
    // In place: where it was saved, which the Recorder's order matches.
    expect(shown(t)).toEqual(["a", "c2", "c1", "b"]);
    const c2 = t.getState().items[1]!;
    expect(t.getState().insertionPoint).toEqual({
      type: "after-clip",
      frontendClipId: c2.frontendId,
    });
  });

  it("restoring a take before it is saved means it is saved live", () => {
    const t = tester([saved("a")]);
    recorder.startRecording(t);
    recorder.startTake(t, 1);
    t.send({ type: "delete-latest-inserted-clip" });

    const take = t.getState().items[1]!;
    t.send({ type: "restore-clip", clipId: take.frontendId });
    recorder.saveTake(t, "c1");

    expect(shown(t)).toEqual(["a", "c1"]);
    expect(t.getEffects().map((e) => e.type)).not.toContain("archive-clips");
  });

  // #2163: a Clip deleted mid-take, then more speech, a Stop and a new take.
  it("after a take deleted mid-take, every later take saves where the editor shows it, through Stop and the next Recording Session", () => {
    const t = tester([saved("a")]);
    recorder.startRecording(t);
    recorder.startTake(t, 1);
    t.send({ type: "delete-latest-inserted-clip" });
    recorder.saveTake(t, "c1");
    expect(archived(t)).toEqual(["c1"]);

    recorder.startTake(t, 2);
    recorder.saveTake(t, "c2");
    recorder.startTake(t, 3);
    recorder.saveTake(t, "c3");
    expect(shown(t)).toEqual(["a", "c2", "c3"]);

    recorder.stopRecording(t);
    expect(t.getState().sessions.map((s) => s.status)).toEqual(["done"]);

    recorder.startRecording(t, 2);
    recorder.startTake(t, 4, 2);
    recorder.saveTake(t, "c4", 2);
    expect(shown(t)).toEqual(["a", "c2", "c3", "c4"]);
    expect(archived(t)).toEqual(["c1"]);
  });

  it("a saved take deleted straight after, then more speech, saves the next take where the editor shows it", () => {
    const t = tester([saved("a")]);
    recorder.startRecording(t);
    recorder.startTake(t, 1);
    recorder.saveTake(t, "c1");
    t.send({ type: "delete-latest-inserted-clip" });
    expect(archived(t)).toEqual(["c1"]);

    recorder.startTake(t, 2);
    recorder.saveTake(t, "c2");
    expect(shown(t)).toEqual(["a", "c2"]);
  });
});

describe("a take on the CVM recorder, as the app server sees it", () => {
  it("has the server save the take where its Optimistic Clip stands, wherever the insertion point moves meanwhile", () => {
    const t = tester([saved("a"), saved("b")]);
    t.send({ type: "set-insertion-point-after", clipId: "f-a" as FrontendId });
    cvm.startRecording(t);
    expect(serverPoint(t)).toEqual({ type: "after-clip", databaseClipId: "a" });

    cvm.startTake(t, 1);
    t.send({ type: "set-insertion-point-after", clipId: "f-b" as FrontendId });
    expect(serverPoint(t)).toEqual({ type: "after-clip", databaseClipId: "a" });

    cvm.saveTake(t, "c1");
    expect(shown(t)).toEqual(["a", "c1", "b"]);
    // Saved, the take no longer holds the server's point: the editor's does.
    expect(serverPoint(t)).toEqual({ type: "after-clip", databaseClipId: "b" });
    // The app server enqueued the transcription with the Clip.
    expect(t.getEffects().map((e) => e.type)).not.toContain("transcribe-clips");
    expect(t.getState().clipTranscriptionJobs).toEqual({
      c1: { jobId: "job-c1", started: false },
    });
  });

  it("an old Recording Session's held Clips and events, arriving during the next, land without touching it (#2163)", () => {
    const t = tester([saved("a")]);
    cvm.startRecording(t, 1);
    cvm.startTake(t, 1, 1);
    // Session 1 stopped, but its last events were held behind a failed save.
    t.send(
      heard({
        type: "recorder-status",
        reachable: true,
        problem: null,
        recordingSessionId: null,
        previews: { camera: "c", screen: "s" },
        still: "still",
      })
    );
    cvm.startRecording(t, 2);
    cvm.startTake(t, 2, 2);
    const take = t.getState().items.at(-1)!;

    // The held save goes through: its Footage becomes a Clip all the same.
    cvm.saveTake(t, "c1", 1);
    cvm.stopRecording(t, 1);

    // Session 1's take, orphaned at its Stop, stays; session 2's is untouched.
    expect(shown(t)).toEqual([
      "a",
      "c1",
      "optimistically-added",
      "optimistically-added",
    ]);
    expect(t.getState().items.at(-1)).toEqual(take);
    expect(t.getState().recordingClipFrontendId).toBe(take.frontendId);
    expect(t.getState().sessions.map((s) => [s.id, s.status] as const)).toEqual(
      [
        [sessionId(1), "done"],
        [sessionId(2), "recording"],
      ]
    );

    cvm.saveTake(t, "c2", 2);
    expect(shown(t).at(-1)).toBe("c2");
  });

  it("orphans a take whose speech made no Clip", () => {
    const t = tester([saved("a")]);
    cvm.startRecording(t);
    cvm.startTake(t, 1);
    t.send(heard({ type: "speech-ended", recordingSessionId: SESSION }));

    expect(t.getState().items[1]).toMatchObject({
      type: "optimistically-added",
      isOrphaned: true,
    });
    expect(t.getState().recordingClipFrontendId).toBeNull();

    t.send(
      heard({
        type: "recording-stopped",
        recordingSessionId: SESSION,
        errors: [],
        crashed: false,
        framesLost: { camera: 0, screen: 0 },
      })
    );
    expect(t.getState().sessions).toMatchObject([
      { id: SESSION, status: "done", cvmRecorder: true },
    ]);
  });
});
