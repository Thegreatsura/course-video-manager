import { describe, expect, it, vi } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import type {
  StorageBucket,
  StorageFileFound,
  StorageFileRole,
} from "@/packages/storage/client";
import {
  bucketPageReducer,
  createInitialBucketPageState,
  fileActions,
} from "./bucket-page-reducer";

/**
 * The per-bucket page's per-file action menus, ticking and deleting many
 * files at once, following the bucket's storage Jobs (#2157), and when it
 * lists again (#2423). Reducer only: no DOM.
 */

const D = "/mnt/d";
const E = "/mnt/e";
const GB = 1024 ** 3;

const MIN = 60 * 1000;

const found = (
  path: string,
  location: string,
  bytes: number,
  role: StorageFileRole = "footage",
  companionOf: string | null = null
): StorageFileFound => ({ path, location, bytes, role, companionOf });

const listed = (
  bucket: StorageBucket,
  files: StorageFileFound[],
  eOnline = true
) => {
  const tester = new ReducerTester(
    bucketPageReducer,
    createInitialBucketPageState(bucket.id)
  );
  vi.mocked(tester.getExec()).mockReturnValue({ stop: () => {} } as never);
  tester
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
        eOnline
          ? {
              root: E,
              label: "E:",
              online: true,
              totalBytes: 2000 * GB,
              freeBytes: 1400 * GB,
              dirtyBit: "clean",
            }
          : {
              root: E,
              label: "E:",
              online: false,
              reason: "unplugged",
              remountCommand: null,
            },
      ],
    })
    .send({ type: "bucket-identified", bucket })
    .send({ type: "files-found", files })
    .send({ type: "scan-completed", at: 0 });
  return tester.resetExec();
};

const course: StorageBucket = { id: "course:a", kind: "course", name: "A" };
const unused: StorageBucket = {
  id: "unused-footage",
  kind: "unused-footage",
  name: "Unused Footage",
};
const renders: StorageBucket = {
  id: "overlay-render-cache",
  kind: "overlay-render-cache",
  name: "Overlay Render Cache",
};

const menu = (tester: ReturnType<typeof listed>, path: string) =>
  fileActions(tester.getState(), tester.getState().files[path]!).map((a) =>
    a.description === undefined
      ? ([a.label, a.refusal] as const)
      : ([`${a.label} (${a.description})`, a.refusal] as const)
  );

describe("a file's action menu", () => {
  it("offers what a Course's Exported Video allows: delete, move, show", () => {
    const t = listed(course, [
      found("finished-videos/x.mp4", D, GB, "exported-video"),
    ]);
    expect(menu(t, "finished-videos/x.mp4")).toEqual([
      ["Delete Exported Video", null],
      ["Move to E:", null],
      ["Reveal in File System (D:)", null],
    ]);
  });

  it("never offers to delete a Course's Footage; Delete original only where a same-size copy is elsewhere", () => {
    const t = listed(course, [
      found("raw-footage/a.mkv", D, GB),
      found("raw-footage/a.mkv", E, GB),
      found("raw-footage/half.mkv", D, GB),
      found("raw-footage/half.mkv", E, GB / 2),
    ]);
    expect(menu(t, "raw-footage/a.mkv")).toEqual([
      ["Delete Original on D:", null],
      ["Delete Original on E:", null],
      ["Reveal in File System (D:)", null],
      ["Reveal in File System (E:)", null],
    ]);
    expect(menu(t, "raw-footage/half.mkv")).toEqual([
      ["Reveal in File System (D:)", null],
      ["Reveal in File System (E:)", null],
    ]);
  });

  it("offers a move to an Offline drive only as refused, and refuses the click", () => {
    const t = listed(course, [found("raw-footage/a.mkv", D, GB)], false);
    expect(menu(t, "raw-footage/a.mkv")).toEqual([
      ["Move to E:", "E: is Offline"],
      ["Reveal in File System (D:)", null],
    ]);
    t.send({
      type: "file-action-clicked",
      path: "raw-footage/a.mkv",
      choice: { type: "move", target: E },
    });
    expect(t.getEffects()).toEqual([]);
    expect(t.getState().action).toBeNull();
  });

  it("deletes Unused Footage, every copy, confirming at once with no dry run", () => {
    const t = listed(unused, [
      found("raw-footage/u.mkv", D, GB),
      found("raw-footage/u.mkv", E, GB),
    ]);
    expect(menu(t, "raw-footage/u.mkv")[0]).toEqual(["Delete", null]);
    t.send({
      type: "file-action-clicked",
      path: "raw-footage/u.mkv",
      choice: { type: "delete" },
    });
    expect(t.getEffects()).toEqual([]);
    expect(t.getState().action).toEqual({
      status: "confirming",
      requestId: 1,
      request: {
        type: "delete-unused",
        files: [
          { location: D, path: "raw-footage/u.mkv" },
          { location: E, path: "raw-footage/u.mkv" },
        ],
      },
      plan: {
        type: "delete",
        byLocation: [
          { location: D, files: 1, bytes: GB },
          { location: E, files: 1, bytes: GB },
        ],
      },
    });
  });

  it("deletes one Other bucket file, and per-file moves name the file", () => {
    const t = listed(renders, [
      found("overlay-renders/a.mov", D, GB, "overlay-render"),
    ]);
    t.send({
      type: "file-action-clicked",
      path: "overlay-renders/a.mov",
      choice: { type: "delete" },
    });
    expect(t.getState().action).toMatchObject({
      request: {
        type: "delete-bucket",
        files: [{ location: D, path: "overlay-renders/a.mov" }],
      },
    });

    const c = listed(course, [found("raw-footage/a.mkv", D, GB)]);
    c.send({
      type: "file-action-clicked",
      path: "raw-footage/a.mkv",
      choice: { type: "move", target: E },
    });
    expect(c.getEffects()[0]).toMatchObject({
      request: {
        type: "move",
        kind: "footage",
        target: E,
        paths: ["raw-footage/a.mkv"],
      },
    });
  });

  it("Reveal in File System asks for the file and starts no action", () => {
    const t = listed(course, [found("raw-footage/a.mkv", D, GB)]);
    t.send({
      type: "file-action-clicked",
      path: "raw-footage/a.mkv",
      choice: { type: "reveal", location: D },
    });
    expect(t.getEffects()).toEqual([
      { type: "reveal-file", location: D, path: "raw-footage/a.mkv" },
    ]);
    expect(t.getState().action).toBeNull();
    t.send({ type: "reveal-failed", message: "no explorer" });
    expect(t.getState().notice).toBe("no explorer");
  });
});

describe("deleting many files at once (#2423)", () => {
  const files = [
    found("finished-videos/big.mp4", D, 3 * GB, "exported-video"),
    found(
      "finished-videos/big.mp4.sha256",
      D,
      1,
      "export-companion",
      "finished-videos/big.mp4"
    ),
    found("finished-videos/mid.mp4", D, 2 * GB, "exported-video"),
    found("finished-videos/small.mp4", E, GB, "exported-video"),
    found("raw-footage/a.mkv", D, 5 * GB),
  ];

  it("ticks only files with a Delete; shift-click ticks the range; the header ticks them all, then none", () => {
    const t = listed(course, files);
    t.send({ type: "file-ticked", path: "raw-footage/a.mkv", shift: false })
      .send({
        type: "file-ticked",
        path: "finished-videos/big.mp4",
        shift: false,
      })
      .send({
        type: "file-ticked",
        path: "finished-videos/small.mp4",
        shift: true,
      });
    expect(t.getState().selected).toEqual([
      "finished-videos/big.mp4",
      "finished-videos/mid.mp4",
      "finished-videos/small.mp4",
    ]);
    t.send({
      type: "file-ticked",
      path: "finished-videos/mid.mp4",
      shift: false,
    });
    expect(t.getState().selected).toEqual([
      "finished-videos/big.mp4",
      "finished-videos/small.mp4",
    ]);
    t.send({ type: "tick-all-clicked" });
    expect(t.getState().selected).toEqual([
      "finished-videos/big.mp4",
      "finished-videos/mid.mp4",
      "finished-videos/small.mp4",
    ]);
    t.send({ type: "tick-all-clicked" });
    expect(t.getState().selected).toEqual([]);
  });

  it("one confirmation for the ticked files, with their count and size, then takes exactly them off the list", () => {
    const t = listed(course, files);
    t.send({ type: "tick-all-clicked" }).send({
      type: "delete-selected-clicked",
    });
    expect(t.getEffects()).toEqual([]);
    expect(t.getState().action).toMatchObject({
      status: "confirming",
      request: {
        type: "purge",
        exportPaths: [
          "finished-videos/big.mp4",
          "finished-videos/mid.mp4",
          "finished-videos/small.mp4",
        ],
      },
      // An Exported Video goes with its companion.
      plan: {
        type: "delete",
        byLocation: [
          { location: D, files: 3, bytes: 5 * GB + 1 },
          { location: E, files: 1, bytes: GB },
        ],
      },
    });
    t.send({ type: "storage-action-confirmed" })
      .send({ type: "storage-action-started", requestId: 1, jobId: "j1" })
      .send({ type: "storage-jobs-observed", jobs: [{ id: "j1", live: true }] })
      .resetExec()
      .send({
        type: "storage-jobs-observed",
        jobs: [
          {
            id: "j1",
            live: false,
            deleted: {
              bucketId: course.id,
              operation: "purge-exports",
              location: null,
              deleted: { files: 4, bytes: 6 * GB + 1 },
              kept: { files: 0, bytes: 0 },
              left: [],
            },
          },
        ],
      });
    expect(Object.keys(t.getState().files)).toEqual(["raw-footage/a.mkv"]);
    expect(t.getState().status).toBe("complete");
    expect(t.getEffects()).toEqual([
      {
        type: "forget-from-scan",
        bucketId: course.id,
        removed: [
          { location: D, kind: "exported-videos", bytes: 5 * GB + 1, files: 3 },
          { location: E, kind: "exported-videos", bytes: GB, files: 1 },
        ],
      },
      {
        type: "save-listing",
        bucketId: course.id,
        listing: expect.objectContaining({ fetchedAt: 0 }),
      },
    ]);
  });

  it("lists again when the Job kept or left any file", () => {
    const t = listed(course, files);
    t.send({
      type: "file-ticked",
      path: "finished-videos/mid.mp4",
      shift: false,
    })
      .send({ type: "delete-selected-clicked" })
      .send({ type: "storage-action-confirmed" })
      .send({ type: "storage-action-started", requestId: 1, jobId: "j1" })
      .send({ type: "storage-jobs-observed", jobs: [{ id: "j1", live: true }] })
      .resetExec()
      .send({
        type: "storage-jobs-observed",
        jobs: [
          {
            id: "j1",
            live: false,
            deleted: {
              bucketId: course.id,
              operation: "purge-exports",
              location: null,
              deleted: { files: 0, bytes: 0 },
              kept: { files: 1, bytes: 2 * GB },
              left: [],
            },
          },
        ],
      });
    expect(t.getEffects()).toEqual([
      { type: "forget-scan" },
      { type: "listen-to-listing", bucketId: course.id },
    ]);
    expect(t.getState().status).toBe("listing");
  });
});

describe("a storage action on the per-bucket page", () => {
  const movePlan = {
    type: "move" as const,
    plan: {
      bucketId: course.id,
      bucketName: "A",
      kind: "footage" as const,
      target: E,
      targetLabel: "E:",
      files: 1,
      bytes: GB,
      filesToCopy: 1,
      bytesToCopy: GB,
      filesOnTarget: 0,
      conflicts: 0,
      freeBytes: 1400 * GB,
      refusals: [],
    },
  };

  it("a move plans, confirms, starts a Job, then lists again once that Job settles", () => {
    const t = listed(course, [found("raw-footage/a.mkv", D, GB)]);
    t.send({
      type: "file-action-clicked",
      path: "raw-footage/a.mkv",
      choice: { type: "move", target: E },
    })
      .send({ type: "storage-action-planned", requestId: 1, plan: movePlan })
      .send({ type: "storage-action-confirmed" })
      .send({ type: "storage-action-started", requestId: 1, jobId: "j1" });
    expect(t.getEffects().map((e) => e.type)).toEqual([
      "plan-storage-action",
      "start-storage-action",
    ]);
    expect(t.getState().action).toBeNull();
    expect(t.getState().watchedJobs).toEqual({ j1: true });

    t.resetExec();
    t.send({ type: "storage-jobs-observed", jobs: [{ id: "j1", live: true }] });
    expect(t.getEffects()).toEqual([]);
    t.send({
      type: "storage-jobs-observed",
      jobs: [{ id: "j1", live: false }],
    });
    expect(t.getEffects()).toEqual([
      { type: "forget-scan" },
      { type: "listen-to-listing", bucketId: "course:a" },
    ]);
    expect(t.getState().status).toBe("listing");
  });

  it("a Job first seen already settled (from before the page opened) lists nothing again", () => {
    const t = listed(course, []);
    t.send({
      type: "storage-jobs-observed",
      jobs: [{ id: "old", live: false }],
    });
    expect(t.getEffects()).toEqual([]);
  });

  it("ignores a late plan", () => {
    const t = listed(course, [found("raw-footage/a.mkv", D, GB)]);
    t.send({
      type: "file-action-clicked",
      path: "raw-footage/a.mkv",
      choice: { type: "move", target: E },
    }).send({ type: "storage-action-planned", requestId: 99, plan: movePlan });
    expect(t.getState().action?.status).toBe("planning");
  });
});

describe("when the per-bucket page lists again (#2423)", () => {
  const listing = {
    fetchedAt: 0,
    roots: null,
    bucket: course,
    files: {},
    unreadableRoots: {},
  };

  it("opening it shows a listing under five minutes old, and lists again once it is older", () => {
    const fresh = new ReducerTester(
      bucketPageReducer,
      createInitialBucketPageState(course.id)
    ).send({ type: "page-opened", now: 4 * MIN, cached: listing });
    expect(fresh.getEffects()).toEqual([]);
    expect(fresh.getState()).toMatchObject({
      status: "complete",
      bucket: course,
    });

    const stale = new ReducerTester(
      bucketPageReducer,
      createInitialBucketPageState(course.id)
    ).send({ type: "page-opened", now: 5 * MIN, cached: listing });
    expect(stale.getEffects()).toEqual([
      { type: "listen-to-listing", bucketId: course.id },
    ]);
  });

  it("a refocus lists only a stale listing; Refresh lists at once", () => {
    const t = listed(course, []);
    t.send({ type: "window-refocused", now: 4 * MIN });
    expect(t.getEffects()).toEqual([]);
    t.send({ type: "window-refocused", now: 5 * MIN });
    expect(t.getEffects()).toEqual([
      { type: "listen-to-listing", bucketId: course.id },
    ]);
    const r = listed(course, []).send({ type: "refresh-clicked" });
    expect(r.getEffects()).toEqual([
      { type: "listen-to-listing", bucketId: course.id },
    ]);
  });
});
