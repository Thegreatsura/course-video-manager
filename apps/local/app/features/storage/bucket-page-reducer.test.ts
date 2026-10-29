import { describe, expect, it, vi } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import type { StorageFileFound } from "@/packages/storage/client";
import {
  bucketFiles,
  bucketPageReducer,
  bucketTotals,
  createInitialBucketPageState,
} from "./bucket-page-reducer";

const D = "/mnt/d";
const E = "/mnt/e";
const GB = 1024 ** 3;

const footage = (
  path: string,
  location: string,
  bytes: number
): StorageFileFound => ({
  path,
  location,
  bytes,
  role: "footage",
  companionOf: null,
});

const start = (bucketId = "course:a") => {
  const listener = { stop: () => {} } as never;
  const tester = new ReducerTester(
    bucketPageReducer,
    createInitialBucketPageState(bucketId)
  );
  vi.mocked(tester.getExec()).mockReturnValue(listener);
  tester.send({ type: "page-opened", now: 0, cached: null });
  const effects = tester.getEffects();
  tester.resetExec();
  tester
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
    .send({
      type: "bucket-identified",
      bucket: { id: bucketId, kind: "course", name: "Course A" },
    });
  return { tester, effects };
};

const rows = (state: bucketPageReducer.State) =>
  bucketFiles(state).map((f) => [f.path, f.bytes, Object.keys(f.copies)]);

describe("bucketPageReducer", () => {
  it("opened twice (Strict Mode remount), only the newest listener listens", () => {
    const first = { stop: () => {} } as never;
    const tester = new ReducerTester(
      bucketPageReducer,
      createInitialBucketPageState("shared-footage")
    );
    expect(tester.getState().listing).toBeNull();
    vi.mocked(tester.getExec()).mockReturnValue(first);
    tester
      .send({ type: "page-opened", now: 0, cached: null })
      .send({ type: "page-opened", now: 0, cached: null });

    expect(tester.getEffects()).toEqual([
      { type: "listen-to-listing", bucketId: "shared-footage" },
      { type: "listen-to-listing", bucketId: "shared-footage" },
    ]);
    expect(tester.getExec().stop).toHaveBeenCalledWith(first);
  });

  it("listens to the bucket's listing once the page opens", () => {
    const { tester, effects } = start("shared-footage");
    expect(effects).toEqual([
      { type: "listen-to-listing", bucketId: "shared-footage" },
    ]);
    expect(tester.getState().bucket?.name).toBe("Course A");
    expect(tester.getState().status).toBe("listing");
  });

  it("lists streamed files largest first, a file on both roots shown on both", () => {
    const { tester } = start();
    tester.send({
      type: "files-found",
      files: [
        footage("raw-footage/small.mkv", D, 1 * GB),
        footage("raw-footage/big.mkv", D, 5 * GB),
      ],
    });
    expect(rows(tester.getState())).toEqual([
      ["raw-footage/big.mkv", 5 * GB, [D]],
      ["raw-footage/small.mkv", 1 * GB, [D]],
    ]);

    // Later batches re-order the list and add a second copy (mid-move).
    tester.send({
      type: "files-found",
      files: [
        footage("raw-footage/huge.mkv", E, 9 * GB),
        footage("raw-footage/small.mkv", E, 1 * GB),
      ],
    });
    expect(rows(tester.getState())).toEqual([
      ["raw-footage/huge.mkv", 9 * GB, [E]],
      ["raw-footage/big.mkv", 5 * GB, [D]],
      ["raw-footage/small.mkv", 1 * GB, [D, E]],
    ]);
    expect(bucketTotals(tester.getState())).toEqual([
      { location: D, bytes: 6 * GB, files: 2 },
      { location: E, bytes: 10 * GB, files: 2 },
    ]);
  });

  it("a root that can't be read shows no files, even ones found before it failed", () => {
    const { tester } = start();
    tester
      .send({
        type: "files-found",
        files: [
          footage("raw-footage/a.mkv", D, 2 * GB),
          footage("raw-footage/a.mkv", E, 2 * GB),
          footage("raw-footage/b.mkv", E, 1 * GB),
        ],
      })
      .send({ type: "root-unreadable", root: E, message: "EIO" })
      // A late batch from the failed root is ignored too.
      .send({
        type: "files-found",
        files: [footage("raw-footage/c.mkv", E, 3 * GB)],
      });

    expect(rows(tester.getState())).toEqual([
      ["raw-footage/a.mkv", 2 * GB, [D]],
    ]);
    expect(tester.getState().unreadableRoots).toEqual({ [E]: "EIO" });
  });

  it("stops listening once the listing completes, and ignores the closed stream after it", () => {
    const { tester } = start();
    tester
      .send({
        type: "files-found",
        files: [footage("raw-footage/a.mkv", D, GB)],
      })
      .send({ type: "scan-completed", at: 0 })
      .send({
        type: "listing-failed",
        message: "The connection to the listing was lost",
      });

    expect(tester.getState().status).toBe("complete");
    expect(tester.getState().failure).toBeNull();
    expect(tester.getState().listing).toBeNull();
  });

  it("an unknown bucket or a dropped connection says why", () => {
    const { tester } = start("course:gone");
    tester.send({
      type: "listing-failed",
      message: 'No Storage Bucket "course:gone"',
    });
    expect(tester.getState()).toMatchObject({
      status: "failed",
      failure: 'No Storage Bucket "course:gone"',
      listing: null,
    });
  });
});
