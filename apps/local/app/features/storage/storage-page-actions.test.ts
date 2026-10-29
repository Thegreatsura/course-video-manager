import { describe, expect, it, vi } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import type { StorageBucket } from "@/packages/storage/client";
import {
  createInitialStoragePageState,
  storagePageReducer,
} from "./storage-page-reducer";

/**
 * The Storage page's row action menus, its following of storage Jobs
 * (#2157), and when it counts again (#2423). Reducer only: no DOM.
 */

const D = "/mnt/d";
const E = "/mnt/e";
const GB = 1024 ** 3;

const course: StorageBucket = { id: "course:a", kind: "course", name: "A" };
const unused: StorageBucket = {
  id: "unused-footage",
  kind: "unused-footage",
  name: "Unused Footage",
};

const MIN = 60 * 1000;

const counted = () => {
  const tester = new ReducerTester(
    storagePageReducer,
    createInitialStoragePageState()
  );
  vi.mocked(tester.getExec()).mockReturnValue({ stop: () => {} } as never);
  return tester
    .send({ type: "page-opened", now: 0, cached: null })
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
        {
          root: E,
          label: "E:",
          online: true,
          totalBytes: 2000 * GB,
          freeBytes: 1400 * GB,
          dirtyBit: "clean",
        },
      ],
    })
    .send({ type: "buckets-listed", buckets: [course, unused] })
    .send({
      type: "sizes-counted",
      sizes: [
        {
          bucketId: course.id,
          location: D,
          kind: "footage",
          bytes: 5 * GB,
          files: 3,
        },
        {
          bucketId: course.id,
          location: D,
          kind: "exported-videos",
          bytes: GB,
          files: 1,
        },
        {
          bucketId: unused.id,
          location: D,
          kind: "footage",
          bytes: 2 * GB,
          files: 2,
        },
      ],
    })
    .send({ type: "scan-completed", at: 0 })
    .resetExec();
};

describe("a Storage page row's action menu", () => {
  it("moves a Course's Footage to E: through a confirmation and a Job", () => {
    const t = counted();
    t.send({
      type: "row-action-clicked",
      bucketId: course.id,
      choice: { type: "move", kind: "footage", target: E },
    })
      .send({
        type: "storage-action-planned",
        requestId: 1,
        plan: {
          type: "move",
          plan: {
            bucketId: course.id,
            bucketName: "A",
            kind: "footage",
            target: E,
            targetLabel: "E:",
            files: 3,
            bytes: 5 * GB,
            filesToCopy: 3,
            bytesToCopy: 5 * GB,
            filesOnTarget: 0,
            conflicts: 0,
            freeBytes: 1400 * GB,
            refusals: [],
          },
        },
      })
      .send({ type: "storage-action-confirmed" });
    expect(t.getEffects().map((e) => e.type)).toEqual([
      "plan-storage-action",
      "start-storage-action",
    ]);
    expect(t.getEffects()[0]).toMatchObject({
      request: { type: "move", kind: "footage", target: E, paths: null },
    });
  });

  it("a move with a refusal can't be confirmed", () => {
    const t = counted();
    t.send({
      type: "row-action-clicked",
      bucketId: course.id,
      choice: { type: "move", kind: "footage", target: E },
    })
      .send({
        type: "storage-action-planned",
        requestId: 1,
        plan: {
          type: "move",
          plan: {
            bucketId: course.id,
            bucketName: "A",
            kind: "footage",
            target: E,
            targetLabel: "E:",
            files: 3,
            bytes: 5 * GB,
            filesToCopy: 3,
            bytesToCopy: 5 * GB,
            filesOnTarget: 0,
            conflicts: 0,
            freeBytes: 1 * GB,
            refusals: [{ reason: "no-room", message: "E: has 1.0 GB free" }],
          },
        },
      })
      .send({ type: "storage-action-confirmed" });
    expect(t.getEffects().map((e) => e.type)).toEqual(["plan-storage-action"]);
  });

  it("a delete confirms at once with what was counted, no dry run; only where the row offers it", () => {
    const t = counted();
    t.send({
      type: "row-action-clicked",
      bucketId: course.id,
      choice: { type: "delete-unused" },
    }).send({
      type: "row-action-clicked",
      bucketId: unused.id,
      choice: { type: "purge" },
    });
    expect(t.getState().action).toBeNull();
    t.send({
      type: "row-action-clicked",
      bucketId: unused.id,
      choice: { type: "delete-unused" },
    });
    expect(t.getEffects()).toEqual([]);
    expect(t.getState().action).toEqual({
      status: "confirming",
      requestId: 1,
      request: { type: "delete-unused", files: null },
      plan: {
        type: "delete",
        byLocation: [{ location: D, files: 2, bytes: 2 * GB }],
      },
    });
  });

  it("one action at a time", () => {
    const t = counted();
    t.send({
      type: "row-action-clicked",
      bucketId: course.id,
      choice: { type: "purge" },
    }).send({
      type: "row-action-clicked",
      bucketId: unused.id,
      choice: { type: "delete-unused" },
    });
    expect(t.getState().action?.request.type).toBe("purge");
  });

  it("a delete that took exactly what was counted is taken off the rows, with no count again", () => {
    const t = counted();
    t.send({
      type: "row-action-clicked",
      bucketId: course.id,
      choice: { type: "purge" },
    })
      .send({ type: "storage-action-confirmed" })
      .send({ type: "storage-action-started", requestId: 1, jobId: "j" })
      .send({ type: "storage-jobs-observed", jobs: [{ id: "j", live: true }] })
      .resetExec()
      .send({
        type: "storage-jobs-observed",
        jobs: [
          {
            id: "j",
            live: false,
            deleted: {
              bucketId: course.id,
              operation: "purge-exports",
              location: null,
              deleted: { files: 1, bytes: GB },
              kept: { files: 0, bytes: 0 },
              left: [],
            },
          },
        ],
      });
    expect(t.getState().status).toBe("complete");
    expect(t.getState().totals[course.id]?.[D]).toEqual({
      footage: 5 * GB,
      "exported-videos": 0,
      other: 0,
    });
    expect(t.getEffects()).toEqual([
      { type: "forget-listing", bucketId: course.id },
      {
        type: "save-scan",
        scan: expect.objectContaining({ fetchedAt: 0 }),
      },
    ]);
  });

  it("counts again when a Job it saw running settles and its result can't be taken off the rows", () => {
    const t = counted();
    t.send({ type: "storage-jobs-observed", jobs: [{ id: "j", live: true }] });
    expect(t.getEffects()).toEqual([]);
    t.send({ type: "storage-jobs-observed", jobs: [{ id: "j", live: false }] });
    expect(t.getEffects()).toEqual([{ type: "listen-to-scan" }]);
    expect(t.getState().status).toBe("scanning");
  });

  it("a start the server refuses says why, and can be dismissed", () => {
    const t = counted();
    t.send({
      type: "row-action-clicked",
      bucketId: unused.id,
      choice: { type: "delete-unused" },
    })
      .send({ type: "storage-action-confirmed" })
      .send({
        type: "storage-action-failed",
        requestId: 1,
        message: "Not done: a Recording Session is recording",
      });
    expect(t.getState().action).toMatchObject({
      status: "failed",
      message: "Not done: a Recording Session is recording",
    });
    t.send({ type: "storage-action-dismissed" });
    expect(t.getState().action).toBeNull();
  });
});

describe("when the Storage page counts again (#2423)", () => {
  it("opening it shows a count under five minutes old, and counts again once it is older", () => {
    const cached = counted().getState();
    const scan = {
      fetchedAt: 0,
      roots: cached.roots,
      buckets: cached.buckets,
      totals: cached.totals,
      counts: cached.counts,
      unreadableRoots: {},
    };
    const fresh = new ReducerTester(
      storagePageReducer,
      createInitialStoragePageState()
    ).send({ type: "page-opened", now: 4 * MIN, cached: scan });
    expect(fresh.getEffects()).toEqual([]);
    expect(fresh.getState()).toMatchObject({
      status: "complete",
      fetchedAt: 0,
    });

    const stale = new ReducerTester(
      storagePageReducer,
      createInitialStoragePageState()
    ).send({ type: "page-opened", now: 5 * MIN, cached: scan });
    expect(stale.getEffects()).toEqual([{ type: "listen-to-scan" }]);
  });

  it("never counts again on its own; a refocus counts only a stale count; Refresh counts at once", () => {
    const t = counted();
    t.send({ type: "window-refocused", now: 4 * MIN });
    expect(t.getEffects()).toEqual([]);
    t.send({ type: "window-refocused", now: 6 * MIN });
    expect(t.getEffects()).toEqual([{ type: "listen-to-scan" }]);

    const r = counted().send({ type: "refresh-clicked" });
    expect(r.getEffects()).toEqual([{ type: "listen-to-scan" }]);
  });

  it("a refocus never counts again under an open confirmation", () => {
    const t = counted().send({
      type: "row-action-clicked",
      bucketId: unused.id,
      choice: { type: "delete-unused" },
    });
    t.send({ type: "window-refocused", now: 60 * MIN });
    expect(t.getEffects()).toEqual([]);
    expect(t.getState().status).toBe("complete");
  });
});
