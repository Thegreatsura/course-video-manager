import { describe, expect, it, vi } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import type { StorageBucket } from "@/packages/storage/client";
import {
  createInitialStoragePageState,
  storagePageReducer,
} from "./storage-page-reducer";

/**
 * The Storage page's row action menus and its following of storage Jobs
 * (#2157). Reducer only: no DOM.
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

const counted = () => {
  const tester = new ReducerTester(
    storagePageReducer,
    createInitialStoragePageState()
  );
  vi.mocked(tester.getExec()).mockReturnValue({ stop: () => {} } as never);
  return tester
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
    .send({ type: "scan-completed" })
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

  it("offers the Trash only on Unused Footage, and a Purge only where there are Exported Videos", () => {
    const t = counted();
    t.send({
      type: "row-action-clicked",
      bucketId: course.id,
      choice: { type: "trash-unused" },
    }).send({
      type: "row-action-clicked",
      bucketId: unused.id,
      choice: { type: "purge" },
    });
    expect(t.getEffects()).toEqual([]);
    t.send({
      type: "row-action-clicked",
      bucketId: unused.id,
      choice: { type: "trash-unused" },
    });
    expect(t.getEffects()).toEqual([
      {
        type: "plan-storage-action",
        requestId: 1,
        request: { type: "trash-unused", files: null },
      },
    ]);
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
      choice: { type: "trash-unused" },
    });
    expect(t.getEffects()).toHaveLength(1);
  });

  it("counts again (and lists the Trash) when a Job it saw running settles", () => {
    const t = counted();
    t.send({ type: "storage-jobs-observed", jobs: [{ id: "j", live: true }] });
    expect(t.getEffects()).toEqual([]);
    t.send({ type: "storage-jobs-observed", jobs: [{ id: "j", live: false }] });
    expect(t.getEffects()).toEqual([
      { type: "load-trash" },
      { type: "listen-to-scan" },
    ]);
    expect(t.getState().status).toBe("scanning");
  });

  it("a start the server refuses says why, and can be dismissed", () => {
    const t = counted();
    t.send({
      type: "row-action-clicked",
      bucketId: unused.id,
      choice: { type: "trash-unused" },
    }).send({
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
