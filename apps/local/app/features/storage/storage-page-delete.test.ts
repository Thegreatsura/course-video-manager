import { describe, expect, it, vi } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import type {
  StorageBucket,
  StorageDeleteResult,
} from "@/packages/storage/client";
import {
  createInitialStoragePageState,
  storagePageReducer,
  storageRows,
} from "./storage-page-reducer";

const D = "/mnt/d";
const SCRATCH = "/tmp/video-processing";
const GB = 1024 ** 3;

const buckets: StorageBucket[] = [
  { id: "course:a", kind: "course", name: "Course A" },
  { id: "unused-footage", kind: "unused-footage", name: "Unused Footage" },
  { id: "clip-mockups", kind: "clip-mockups", name: "Clip Mockups" },
  {
    id: "overlay-render-cache",
    kind: "overlay-render-cache",
    name: "Overlay Render Cache",
  },
  { id: "export-scratch", kind: "export-scratch", name: "Export scratch" },
];

/** The page is open and has counted every bucket. */
const counted = (opts: { complete: boolean } = { complete: true }) => {
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
      ],
    })
    .send({ type: "buckets-listed", buckets })
    .send({
      type: "sizes-counted",
      sizes: [
        ["course:a", "footage", 100 * GB],
        ["unused-footage", "footage", 104 * GB],
        ["clip-mockups", "other", 6 * GB],
        ["overlay-render-cache", "other", 1.5 * GB],
      ].map(([bucketId, kind, bytes]) => ({
        bucketId: bucketId as string,
        location: D,
        kind: kind as "footage" | "other",
        bytes: bytes as number,
        files: 1,
      })),
    })
    .send({
      type: "sizes-counted",
      sizes: [
        {
          bucketId: "export-scratch",
          location: SCRATCH,
          kind: "other",
          bytes: 3 * GB,
          files: 2,
        },
      ],
    });
  if (opts.complete) tester.send({ type: "scan-completed" });
  return tester.resetExec();
};

const deleted: StorageDeleteResult = {
  bucketId: "overlay-render-cache",
  deleted: [{ location: D, files: 40, bytes: 1.5 * GB }],
  left: [{ path: "overlay-renders/x.mov", location: D, message: "EBUSY" }],
};

describe("storagePageReducer: deleting an Other bucket (#2112)", () => {
  it("confirms with the GB freed, deletes, then counts again from nothing", () => {
    const tester = counted();

    tester.send({
      type: "delete-bucket-clicked",
      bucketId: "overlay-render-cache",
    });
    expect(tester.getState().deletion).toEqual({
      status: "confirming",
      bucket: buckets[3],
      bytes: 1.5 * GB,
    });
    expect(tester.getEffects()).toEqual([]);

    tester.send({ type: "delete-confirmed" });
    expect(tester.getState().deletion?.status).toBe("deleting");
    // Confirming twice (a double click) deletes once.
    tester.send({ type: "delete-confirmed" });
    expect(tester.getEffects()).toEqual([
      { type: "delete-bucket", bucketId: "overlay-render-cache" },
    ]);

    tester.send({ type: "bucket-deleted", result: deleted });
    const state = tester.getState();
    expect(state.deletion).toEqual({
      status: "deleted",
      bucket: buckets[3],
      result: deleted,
    });
    expect(state.status).toBe("scanning");
    expect(storageRows(state)).toEqual([]);
    expect(tester.getEffects()).toEqual([
      { type: "delete-bucket", bucketId: "overlay-render-cache" },
      { type: "listen-to-scan" },
    ]);

    // The new count streams in under the result, which stays until dismissed.
    tester.send({ type: "buckets-listed", buckets });
    expect(tester.getState().deletion?.status).toBe("deleted");
    tester.send({ type: "deletion-dismissed" });
    expect(tester.getState().deletion).toBeNull();
  });

  it("offers no delete for Clip Mockups, any Footage or a Course", () => {
    const tester = counted();

    for (const bucketId of ["clip-mockups", "unused-footage", "course:a"]) {
      tester.send({ type: "delete-bucket-clicked", bucketId });
      tester.send({ type: "delete-confirmed" });
    }

    expect(tester.getState().deletion).toBeNull();
    expect(tester.getEffects()).toEqual([]);
  });

  it("offers a delete only once the count is complete", () => {
    const tester = counted({ complete: false });

    tester.send({ type: "delete-bucket-clicked", bucketId: "export-scratch" });
    expect(tester.getState().deletion).toBeNull();

    tester.send({ type: "scan-completed" }).send({
      type: "delete-bucket-clicked",
      bucketId: "export-scratch",
    });
    expect(tester.getState().deletion).toMatchObject({
      status: "confirming",
      bytes: 3 * GB,
    });
  });

  it("cancelling deletes nothing", () => {
    const tester = counted();

    tester
      .send({ type: "delete-bucket-clicked", bucketId: "export-scratch" })
      .send({ type: "delete-cancelled" })
      .send({ type: "delete-confirmed" });

    expect(tester.getState().deletion).toBeNull();
    expect(tester.getEffects()).toEqual([]);
  });

  it("a refusal (an export is running) says why, keeps the count, and can be dismissed", () => {
    const tester = counted();
    const message =
      "Not deleted: an export is queued or running (Export: Intro).";

    tester
      .send({ type: "delete-bucket-clicked", bucketId: "export-scratch" })
      .send({ type: "delete-confirmed" })
      .send({
        type: "bucket-delete-failed",
        bucketId: "export-scratch",
        message,
      });

    const state = tester.getState();
    expect(state.deletion).toEqual({
      status: "failed",
      bucket: buckets[4],
      message,
    });
    expect(state.status).toBe("complete");
    expect(storageRows(state)).toHaveLength(5);
    expect(tester.getEffects()).toEqual([
      { type: "delete-bucket", bucketId: "export-scratch" },
    ]);

    tester.send({ type: "deletion-dismissed" });
    expect(tester.getState().deletion).toBeNull();
  });
});
