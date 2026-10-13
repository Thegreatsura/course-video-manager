import { describe, expect, it, vi } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import type {
  StorageBucket,
  StorageFileFound,
  StoragePurgeResult,
} from "@/packages/storage/client";
import {
  bucketPageReducer,
  createInitialBucketPageState,
  selectedBytes,
} from "./bucket-page-reducer";
import {
  createInitialStoragePageState,
  rowCanBePurged,
  storagePageReducer,
  storageRows,
} from "./storage-page-reducer";

const D = "/mnt/d";
const E = "/mnt/e";
const GB = 1024 ** 3;

const course: StorageBucket = { id: "course:a", kind: "course", name: "A" };
const buckets: StorageBucket[] = [
  course,
  { id: "shorts", kind: "shorts", name: "Shorts" },
  { id: "unused-footage", kind: "unused-footage", name: "Unused Footage" },
  {
    id: "shared-footage",
    kind: "shared-footage",
    name: "Shared Footage",
    sharedBy: ["A", "B"],
  },
  {
    id: "orphaned-exports",
    kind: "orphaned-exports",
    name: "Exported Videos of no current Video",
  },
  {
    id: "standalone-videos",
    kind: "standalone-videos",
    name: "Standalone Videos",
  },
];

const plan = (over: Partial<StoragePurgeResult> = {}): StoragePurgeResult => ({
  bucketId: "course:a",
  dryRun: true,
  videos: 3,
  deleted: [
    { location: D, files: 4, bytes: 20 * GB },
    { location: E, files: 2, bytes: 8 * GB },
  ],
  skipped: [
    {
      videoId: "v9",
      title: "Intro",
      reason: "Footage not found (E: offline?): raw-footage/a.mkv",
      bytes: 3 * GB,
    },
  ],
  left: [],
  ...over,
});

const purged = plan({ dryRun: false });

/** The Storage page, open, with every bucket counted. */
const storagePage = (opts: { complete: boolean } = { complete: true }) => {
  const tester = new ReducerTester(
    storagePageReducer,
    createInitialStoragePageState()
  );
  vi.mocked(tester.getExec()).mockReturnValue({ stop: () => {} } as never);
  tester
    .send({ type: "page-opened" })
    .send({ type: "buckets-listed", buckets })
    .send({
      type: "sizes-counted",
      sizes: (
        [
          ["course:a", "footage", 100 * GB],
          ["course:a", "exported-videos", 31 * GB],
          ["shorts", "exported-videos", 2 * GB],
          ["unused-footage", "footage", 104 * GB],
          ["shared-footage", "footage", 55 * GB],
          ["orphaned-exports", "exported-videos", 23 * GB],
          ["standalone-videos", "footage", 5 * GB],
        ] as const
      ).map(([bucketId, kind, bytes]) => ({
        bucketId,
        location: D,
        kind,
        bytes,
        files: 1,
      })),
    });
  if (opts.complete) tester.send({ type: "scan-completed" });
  return tester.resetExec();
};

describe("storagePageReducer: Purging a bucket's Exported Videos (#2111)", () => {
  it("asks the server what goes, confirms with the GB and the skipped Videos, purges once, then counts again", () => {
    const tester = storagePage();

    tester.send({ type: "purge-bucket-clicked", bucketId: "course:a" });
    expect(tester.getState().purge).toEqual({
      status: "planning",
      bucket: course,
      exportPaths: null,
    });
    expect(tester.getEffects()).toEqual([
      { type: "plan-purge", bucketId: "course:a", exportPaths: null },
    ]);

    // Confirming before the plan is in does nothing.
    tester.send({ type: "purge-confirmed" });
    tester.send({ type: "purge-planned", result: plan() });
    expect(tester.getState().purge).toEqual({
      status: "confirming",
      bucket: course,
      exportPaths: null,
      plan: plan(),
    });

    tester.send({ type: "purge-confirmed" });
    tester.send({ type: "purge-confirmed" }); // a double click
    expect(tester.getState().purge?.status).toBe("purging");
    expect(tester.getEffects()).toEqual([
      { type: "plan-purge", bucketId: "course:a", exportPaths: null },
      { type: "purge-exports", bucketId: "course:a", exportPaths: null },
    ]);

    tester.send({ type: "exports-purged", result: purged });
    const state = tester.getState();
    expect(state.purge).toEqual({
      status: "purged",
      bucket: course,
      result: purged,
    });
    expect(state.status).toBe("scanning");
    expect(storageRows(state)).toEqual([]);
    expect(tester.getEffects().at(-1)).toEqual({ type: "listen-to-scan" });

    // The result stays over the new count until dismissed.
    tester.send({ type: "buckets-listed", buckets });
    expect(tester.getState().purge?.status).toBe("purged");
    tester.send({ type: "purge-dismissed" });
    expect(tester.getState().purge).toBeNull();
  });

  it("offers the Purge on a Course, Standalone Videos or Shorts that has Exported Videos, and nowhere else", () => {
    const state = storagePage().getState();
    const offered = storageRows(state)
      .filter(rowCanBePurged)
      .map((r) => r.bucket.id)
      .sort();
    // Standalone Videos has Footage but no Exported Videos here.
    expect(offered).toEqual(["course:a", "shorts"]);

    const tester = storagePage();
    for (const bucketId of [
      "unused-footage",
      "shared-footage",
      "orphaned-exports",
      "standalone-videos",
      "nope",
    ]) {
      tester.send({ type: "purge-bucket-clicked", bucketId });
    }
    expect(tester.getState().purge).toBeNull();
    expect(tester.getEffects()).toEqual([]);
  });

  it("offers nothing until the count is complete", () => {
    const tester = storagePage({ complete: false });
    tester.send({ type: "purge-bucket-clicked", bucketId: "course:a" });
    expect(tester.getState().purge).toBeNull();
    expect(tester.getEffects()).toEqual([]);
  });

  it("nothing to delete (every Video skipped): the confirm does nothing", () => {
    const tester = storagePage();
    tester
      .send({ type: "purge-bucket-clicked", bucketId: "course:a" })
      .send({
        type: "purge-planned",
        result: plan({ videos: 0, deleted: [] }),
      })
      .resetExec()
      .send({ type: "purge-confirmed" });
    expect(tester.getState().purge?.status).toBe("confirming");
    expect(tester.getEffects()).toEqual([]);
  });

  it("cancel while asking or confirming; a late plan is ignored", () => {
    const tester = storagePage();
    tester
      .send({ type: "purge-bucket-clicked", bucketId: "course:a" })
      .send({ type: "purge-cancelled" });
    expect(tester.getState().purge).toBeNull();
    tester.send({ type: "purge-planned", result: plan() });
    expect(tester.getState().purge).toBeNull();
  });

  it("can't be cancelled once the files are going", () => {
    const tester = storagePage();
    tester
      .send({ type: "purge-bucket-clicked", bucketId: "course:a" })
      .send({ type: "purge-planned", result: plan() })
      .send({ type: "purge-confirmed" })
      .send({ type: "purge-cancelled" });
    expect(tester.getState().purge?.status).toBe("purging");
  });

  it("shows a refusal (an export running) and doesn't count again", () => {
    const tester = storagePage();
    tester
      .send({ type: "purge-bucket-clicked", bucketId: "course:a" })
      .resetExec()
      .send({
        type: "purge-failed",
        bucketId: "course:a",
        message: "Not deleted: an export is queued or running (Intro).",
      });
    expect(tester.getState().purge).toEqual({
      status: "failed",
      bucket: course,
      message: "Not deleted: an export is queued or running (Intro).",
    });
    expect(tester.getState().status).toBe("complete");
    expect(tester.getEffects()).toEqual([]);
  });

  it("one at a time: no Purge during an Other bucket's delete, and no delete during a Purge", () => {
    const tester = storagePage();
    tester.send({ type: "purge-bucket-clicked", bucketId: "course:a" });
    tester.send({ type: "purge-bucket-clicked", bucketId: "shorts" });
    tester.send({
      type: "delete-bucket-clicked",
      bucketId: "orphaned-exports",
    });
    expect(tester.getState().purge?.bucket.id).toBe("course:a");
    expect(tester.getState().deletion).toBeNull();
  });
});

// --- the per-bucket page -----------------------------------------------------

const file = (
  path: string,
  bytes: number,
  role: StorageFileFound["role"],
  location = D
): StorageFileFound => ({
  path,
  location,
  bytes,
  role,
  companionOf:
    role === "export-companion" ? path.replace(/\.sha256$/, "") : null,
});

const EXPORT_1 = "finished-videos/a-h1.mp4";
const EXPORT_2 = "finished-videos/a-h2.mp4";

const bucketPage = (bucket: StorageBucket = course) => {
  const tester = new ReducerTester(
    bucketPageReducer,
    createInitialBucketPageState(bucket.id)
  );
  vi.mocked(tester.getExec()).mockReturnValue({ stop: () => {} } as never);
  tester
    .send({ type: "page-opened" })
    .send({ type: "bucket-identified", bucket })
    .send({
      type: "files-found",
      files: [
        file("raw-footage/a.mkv", 100 * GB, "footage"),
        file("raw-footage/s/camera.mkv", 50 * GB, "recording-session"),
        file(EXPORT_1, 3 * GB, "exported-video"),
        file(EXPORT_1, 3 * GB, "exported-video", E),
        file(`${EXPORT_1}.sha256`, 100, "export-companion"),
        file(EXPORT_2, 2 * GB, "exported-video"),
      ],
    })
    .send({ type: "scan-completed" });
  return tester.resetExec();
};

describe("bucketPageReducer: ticking Exported Videos and deleting them (#2111)", () => {
  it("ticks only Exported Videos, never Footage, a Recording Session or a companion", () => {
    const tester = bucketPage();
    for (const path of [
      "raw-footage/a.mkv",
      "raw-footage/s/camera.mkv",
      `${EXPORT_1}.sha256`,
      "finished-videos/not-listed.mp4",
      EXPORT_2,
      EXPORT_1,
    ]) {
      tester.send({ type: "export-checkbox-toggled", path });
    }
    expect(tester.getState().selected).toEqual([EXPORT_2, EXPORT_1]);
    expect(selectedBytes(tester.getState())).toBe(5 * GB);

    tester.send({ type: "export-checkbox-toggled", path: EXPORT_2 });
    expect(tester.getState().selected).toEqual([EXPORT_1]);
  });

  it("ticks nothing in a bucket whose Exported Videos can't be Purged", () => {
    const tester = bucketPage({
      id: "orphaned-exports",
      kind: "orphaned-exports",
      name: "Exported Videos of no current Video",
    });
    tester.send({ type: "export-checkbox-toggled", path: EXPORT_1 });
    tester.send({ type: "purge-selected-clicked" });
    expect(tester.getState().selected).toEqual([]);
    expect(tester.getEffects()).toEqual([]);
  });

  it("deletes the ticked ones: plan, confirm, purge, then lists again with nothing ticked", () => {
    const tester = bucketPage();
    tester
      .send({ type: "purge-selected-clicked" }) // nothing ticked: nothing
      .send({ type: "export-checkbox-toggled", path: EXPORT_1 })
      .send({ type: "purge-selected-clicked" });
    expect(tester.getEffects()).toEqual([
      { type: "plan-purge", bucketId: "course:a", exportPaths: [EXPORT_1] },
    ]);

    // Ticking is frozen while the Purge is under way.
    tester.send({ type: "export-checkbox-toggled", path: EXPORT_2 });
    expect(tester.getState().selected).toEqual([EXPORT_1]);

    const result = plan({ videos: 1 });
    tester
      .send({ type: "purge-planned", result })
      .send({ type: "purge-confirmed" })
      .send({ type: "exports-purged", result: { ...result, dryRun: false } });
    const state = tester.getState();
    expect(state.purge?.status).toBe("purged");
    expect(state.selected).toEqual([]);
    expect(state.files).toEqual({});
    expect(state.status).toBe("listing");
    expect(tester.getEffects()).toEqual([
      { type: "plan-purge", bucketId: "course:a", exportPaths: [EXPORT_1] },
      { type: "purge-exports", bucketId: "course:a", exportPaths: [EXPORT_1] },
      { type: "listen-to-listing", bucketId: "course:a" },
    ]);
  });

  it("no delete until the listing is complete", () => {
    const tester = new ReducerTester(
      bucketPageReducer,
      createInitialBucketPageState("course:a")
    );
    vi.mocked(tester.getExec()).mockReturnValue({ stop: () => {} } as never);
    tester
      .send({ type: "page-opened" })
      .send({ type: "bucket-identified", bucket: course })
      .send({
        type: "files-found",
        files: [file(EXPORT_1, 3 * GB, "exported-video")],
      })
      .resetExec()
      .send({ type: "export-checkbox-toggled", path: EXPORT_1 })
      .send({ type: "purge-selected-clicked" });
    expect(tester.getState().selected).toEqual([EXPORT_1]);
    expect(tester.getEffects()).toEqual([]);
  });
});
