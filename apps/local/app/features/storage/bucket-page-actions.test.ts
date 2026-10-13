import { describe, expect, it, vi } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import type {
  StorageBucket,
  StorageFileFound,
  StorageFileRole,
  StorageTrashEntry,
} from "@/packages/storage/client";
import {
  bucketPageReducer,
  createInitialBucketPageState,
  fileActions,
} from "./bucket-page-reducer";

/**
 * The per-bucket page's per-file action menus, the Trash, and following the
 * bucket's storage Jobs (#2157). Reducer only: no DOM.
 */

const D = "/mnt/d";
const E = "/mnt/e";
const GB = 1024 ** 3;

const found = (
  path: string,
  location: string,
  bytes: number,
  role: StorageFileRole = "footage"
): StorageFileFound => ({ path, location, bytes, role, companionOf: null });

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
              freeBytes: 1400 * GB,
              dirtyBit: "clean",
            }
          : { root: E, label: "E:", online: false, reason: "unplugged" },
      ],
    })
    .send({ type: "bucket-identified", bucket })
    .send({ type: "files-found", files })
    .send({ type: "scan-completed" });
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

  it("deletes Unused Footage by moving every copy to the Trash", () => {
    const t = listed(unused, [
      found("raw-footage/u.mkv", D, GB),
      found("raw-footage/u.mkv", E, GB),
    ]);
    expect(menu(t, "raw-footage/u.mkv")[0]).toEqual(["Move to Trash", null]);
    t.send({
      type: "file-action-clicked",
      path: "raw-footage/u.mkv",
      choice: { type: "delete" },
    });
    expect(t.getEffects()).toEqual([
      {
        type: "plan-storage-action",
        requestId: 1,
        request: {
          type: "trash-unused",
          files: [
            { location: D, path: "raw-footage/u.mkv" },
            { location: E, path: "raw-footage/u.mkv" },
          ],
        },
      },
    ]);
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
    expect(t.getEffects()[0]).toMatchObject({
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

describe("a storage action on the per-bucket page", () => {
  const plan = {
    type: "purge" as const,
    result: {
      bucketId: "course:a",
      dryRun: true,
      videos: 1,
      deleted: [{ location: D, files: 1, bytes: GB }],
      skipped: [],
      left: [],
    },
  };

  it("plans, confirms, starts a Job, then lists again once that Job settles", () => {
    const t = listed(course, [
      found("finished-videos/x.mp4", D, GB, "exported-video"),
    ]);
    t.send({ type: "export-checkbox-toggled", path: "finished-videos/x.mp4" })
      .send({ type: "purge-selected-clicked" })
      .send({ type: "storage-action-planned", requestId: 1, plan })
      .send({ type: "storage-action-confirmed" })
      .send({ type: "storage-action-started", requestId: 1, jobId: "j1" });
    expect(t.getEffects()).toEqual([
      {
        type: "plan-storage-action",
        requestId: 1,
        request: {
          type: "purge",
          bucket: course,
          exportPaths: ["finished-videos/x.mp4"],
        },
      },
      {
        type: "start-storage-action",
        requestId: 1,
        request: {
          type: "purge",
          bucket: course,
          exportPaths: ["finished-videos/x.mp4"],
        },
      },
    ]);
    expect(t.getState().action).toBeNull();
    expect(t.getState().selected).toEqual([]);
    expect(t.getState().watchedJobs).toEqual({ j1: true });

    t.resetExec();
    t.send({ type: "storage-jobs-observed", jobs: [{ id: "j1", live: true }] });
    expect(t.getEffects()).toEqual([]);
    t.send({
      type: "storage-jobs-observed",
      jobs: [{ id: "j1", live: false }],
    });
    expect(t.getEffects()).toEqual([
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

  it("can't confirm a plan that would do nothing, and ignores a late plan", () => {
    const t = listed(course, [
      found("finished-videos/x.mp4", D, GB, "exported-video"),
    ]);
    t.send({ type: "export-checkbox-toggled", path: "finished-videos/x.mp4" })
      .send({ type: "purge-selected-clicked" })
      .send({ type: "storage-action-planned", requestId: 99, plan });
    expect(t.getState().action?.status).toBe("planning");
    t.send({
      type: "storage-action-planned",
      requestId: 1,
      plan: { ...plan, result: { ...plan.result, deleted: [] } },
    }).send({ type: "storage-action-confirmed" });
    expect(t.getState().action?.status).toBe("confirming");
    expect(t.getEffects()).toHaveLength(1);
  });
});

describe("the Trash on Unused Footage's page", () => {
  const entry: StorageTrashEntry = {
    location: E,
    batch: "20261013T120000Z-j1",
    path: "raw-footage/u.mkv",
    bytes: GB,
    trashedAt: "2026-10-13T12:00:00.000Z",
    expiresAt: "2026-10-27T12:00:00.000Z",
  };

  it("lists the Trash when the page opens, and Restore asks to put a file back", () => {
    const tester = new ReducerTester(
      bucketPageReducer,
      createInitialBucketPageState("unused-footage")
    );
    tester.send({ type: "page-opened" });
    expect(tester.getEffects()).toEqual([
      { type: "load-trash" },
      { type: "listen-to-listing", bucketId: "unused-footage" },
    ]);
    tester
      .send({ type: "trash-listed", entries: [entry] })
      .resetExec()
      .send({ type: "restore-clicked", entries: [entry] });
    expect(tester.getEffects()).toEqual([
      {
        type: "plan-storage-action",
        requestId: 1,
        request: {
          type: "restore-trash",
          files: [{ location: E, batch: entry.batch, path: entry.path }],
        },
      },
    ]);
  });

  it("Empty trash is offered only with something in it", () => {
    const t = listed(unused, []);
    t.send({ type: "empty-trash-clicked" });
    expect(t.getEffects()).toEqual([]);
    t.send({ type: "trash-listed", entries: [entry] }).send({
      type: "empty-trash-clicked",
    });
    expect(t.getEffects()).toEqual([
      {
        type: "plan-storage-action",
        requestId: 1,
        request: { type: "empty-trash" },
      },
    ]);
  });
});
