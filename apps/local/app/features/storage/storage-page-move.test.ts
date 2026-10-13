import { describe, expect, it, vi } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import type { StorageBucket, StorageMovePlan } from "@/packages/storage/client";
import {
  createInitialStoragePageState,
  moveConfirmation,
  rowMoveActions,
  storagePageReducer,
  storageRows,
} from "./storage-page-reducer";

/** The Storage page's move confirmation (#2109). */

const D = "/mnt/d";
const E = "/mnt/e";
const GB = 1024 ** 3;

const buckets: StorageBucket[] = [
  { id: "course:a", kind: "course", name: "Course A" },
  { id: "clip-mockups", kind: "clip-mockups", name: "Clip Mockups" },
  {
    id: "overlay-render-cache",
    kind: "overlay-render-cache",
    name: "Overlay Render Cache",
  },
];

const counted = (eOnline = true) => {
  const tester = new ReducerTester(
    storagePageReducer,
    createInitialStoragePageState()
  );
  vi.mocked(tester.getExec()).mockReturnValue({ stop: () => {} } as never);
  tester
    .send({ type: "page-opened" })
    .send({
      type: "roots-measured",
      roots: [
        {
          root: D,
          label: "D:",
          online: true,
          totalBytes: 2000 * GB,
          freeBytes: 164 * GB,
          dirtyBit: "clean",
        },
        eOnline
          ? {
              root: E,
              label: "E:",
              online: true,
              totalBytes: 2000 * GB,
              freeBytes: 1380 * GB,
              dirtyBit: "dirty",
            }
          : { root: E, label: "E:", online: false, reason: "not mounted" },
      ],
    })
    .send({ type: "buckets-listed", buckets })
    .send({
      type: "sizes-counted",
      sizes: [
        {
          bucketId: "course:a",
          location: D,
          kind: "footage",
          bytes: 100 * GB,
          files: 1,
        },
        {
          bucketId: "course:a",
          location: E,
          kind: "exported-videos",
          bytes: 20 * GB,
          files: 1,
        },
        {
          bucketId: "clip-mockups",
          location: D,
          kind: "other",
          bytes: 6 * GB,
          files: 1,
        },
        {
          bucketId: "overlay-render-cache",
          location: D,
          kind: "other",
          bytes: 1 * GB,
          files: 1,
        },
      ],
    })
    .send({ type: "scan-completed" });
  return tester.resetExec();
};

const plan = (overrides: Partial<StorageMovePlan> = {}): StorageMovePlan => ({
  bucketId: "course:a",
  bucketName: "Course A",
  kind: "footage",
  target: E,
  targetLabel: "E:",
  files: 10,
  bytes: 100 * GB,
  filesToCopy: 8,
  bytesToCopy: 80 * GB,
  filesOnTarget: 2,
  conflicts: 0,
  freeBytes: 1380 * GB,
  refusals: [],
  ...overrides,
});

const rowOf = (tester: ReturnType<typeof counted>, id: string) =>
  storageRows(tester.getState()).find((r) => r.bucket.id === id)!;

describe("the Storage page's move buttons", () => {
  it("offer each kind a bucket can move, to each drive that lacks some of it", () => {
    const tester = counted();
    const actions = rowMoveActions(
      tester.getState(),
      rowOf(tester, "course:a")
    );
    expect(actions.map((a) => [a.kind, a.target.label])).toEqual([
      ["footage", "E:"],
      ["exported-videos", "D:"],
    ]);
    expect(
      rowMoveActions(tester.getState(), rowOf(tester, "clip-mockups")).map(
        (a) => [a.kind, a.target.label]
      )
    ).toEqual([["clip-mockups", "E:"]]);
    expect(
      rowMoveActions(tester.getState(), rowOf(tester, "overlay-render-cache"))
    ).toEqual([]);
  });

  it("say an Offline drive takes nothing", () => {
    const tester = counted(false);
    const [footage] = rowMoveActions(
      tester.getState(),
      rowOf(tester, "course:a")
    );
    expect(footage).toMatchObject({
      kind: "footage",
      refusal: "E: is Offline",
    });
  });
});

describe("the move confirmation", () => {
  it("asks the server for the plan, then shows the size, the free space and what is left", () => {
    const tester = counted().send({
      type: "move-clicked",
      bucketId: "course:a",
      kind: "footage",
      target: E,
    });
    expect(tester.getExec()).toHaveBeenCalledWith({
      type: "plan-move",
      bucketId: "course:a",
      kind: "footage",
      target: E,
    });
    expect(moveConfirmation(tester.getState())).toBeNull();

    tester.send({ type: "move-planned", plan: plan() });
    expect(moveConfirmation(tester.getState())).toMatchObject({
      bytesToCopy: 80 * GB,
      freeBytes: 1380 * GB,
      freeAfter: 1300 * GB,
      blocked: false,
      reasons: [],
    });
  });

  it("is blocked when there is no room, or any other refusal, and can't be confirmed", () => {
    const tester = counted()
      .send({
        type: "move-clicked",
        bucketId: "course:a",
        kind: "footage",
        target: E,
      })
      .send({
        type: "move-planned",
        plan: plan({
          freeBytes: 50 * GB,
          refusals: [
            {
              reason: "no-room",
              message: "E: has 50.0 GB free; this move needs 80.0 GB",
            },
            {
              reason: "export-running",
              message: "An export is queued or running",
            },
          ],
        }),
      })
      .resetExec()
      .send({ type: "move-confirmed" });
    expect(moveConfirmation(tester.getState())).toMatchObject({
      blocked: true,
      freeAfter: -30 * GB,
      reasons: [
        "E: has 50.0 GB free; this move needs 80.0 GB",
        "An export is queued or running",
      ],
    });
    expect(tester.getExec()).not.toHaveBeenCalled();
    expect(tester.getState().move?.status).toBe("confirming");
  });

  it("confirmed, starts the Job and remembers it", () => {
    const tester = counted()
      .send({
        type: "move-clicked",
        bucketId: "course:a",
        kind: "footage",
        target: E,
      })
      .send({ type: "move-planned", plan: plan() })
      .resetExec()
      .send({ type: "move-confirmed" });
    expect(tester.getExec()).toHaveBeenCalledWith({
      type: "start-move",
      bucketId: "course:a",
      kind: "footage",
      target: E,
    });
    expect(moveConfirmation(tester.getState())?.starting).toBe(true);
    tester.send({ type: "move-started", jobId: "job-1" });
    expect(tester.getState().move).toMatchObject({
      status: "started",
      jobId: "job-1",
    });
    tester.send({ type: "move-dismissed" });
    expect(tester.getState().move).toBeNull();
  });

  it("ignores a plan for a move it no longer shows, and a second click while one is open", () => {
    const tester = counted()
      .send({
        type: "move-clicked",
        bucketId: "course:a",
        kind: "footage",
        target: E,
      })
      .send({ type: "move-cancelled" })
      .send({ type: "move-planned", plan: plan() });
    expect(tester.getState().move).toBeNull();

    tester
      .send({
        type: "move-clicked",
        bucketId: "course:a",
        kind: "footage",
        target: E,
      })
      .resetExec()
      .send({
        type: "move-clicked",
        bucketId: "clip-mockups",
        kind: "clip-mockups",
        target: E,
      });
    expect(tester.getExec()).not.toHaveBeenCalled();
  });

  it("a refusal from the server when starting is shown, and dismissed", () => {
    const tester = counted()
      .send({
        type: "move-clicked",
        bucketId: "course:a",
        kind: "footage",
        target: E,
      })
      .send({ type: "move-planned", plan: plan() })
      .send({ type: "move-confirmed" })
      .send({ type: "move-start-failed", message: "Not moved: E: is Offline" });
    expect(tester.getState().move).toMatchObject({
      status: "failed",
      message: "Not moved: E: is Offline",
    });
    tester.send({ type: "move-dismissed" });
    expect(tester.getState().move).toBeNull();
  });
});
