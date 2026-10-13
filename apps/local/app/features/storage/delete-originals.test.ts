import { describe, expect, it, vi } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import type {
  StorageBucket,
  StorageFileFound,
  StorageOriginalsResult,
} from "@/packages/storage/client";
import {
  bucketPageReducer,
  createInitialBucketPageState,
  originalsOffers,
} from "./bucket-page-reducer";

const D = "/mnt/d";
const E = "/mnt/e";
const GB = 1024 ** 3;

const course: StorageBucket = { id: "course:a", kind: "course", name: "A" };

const file = (
  path: string,
  location: string,
  bytes: number,
  role: StorageFileFound["role"] = "footage"
): StorageFileFound => ({ path, location, bytes, role, companionOf: null });

/** The per-bucket page, listed: two takes moved to E:, one only on D:. */
const listed = (bucket: StorageBucket = course) => {
  const tester = new ReducerTester(
    bucketPageReducer,
    createInitialBucketPageState(bucket.id)
  );
  vi.mocked(tester.getExec()).mockReturnValue({ stop: () => {} } as never);
  tester
    .send({ type: "page-opened" })
    .send({
      type: "roots-measured",
      roots: [D, E].map((root) => ({
        root,
        label: root === D ? "D:" : "E:",
        online: true,
        totalBytes: 2000 * GB,
        freeBytes: 100 * GB,
        dirtyBit: "clean" as const,
      })),
    })
    .send({ type: "bucket-identified", bucket })
    .send({
      type: "files-found",
      files: [
        file("raw-footage/a.mkv", D, 5 * GB),
        file("raw-footage/a.mkv", E, 5 * GB),
        file("raw-footage/b.mkv", D, 2 * GB),
        file("raw-footage/b.mkv", E, 2 * GB),
        // A half-copied one (different size) and one only on D:.
        file("raw-footage/c.mkv", D, 3 * GB),
        file("raw-footage/c.mkv", E, 1 * GB),
        file("raw-footage/d.mkv", D, 4 * GB),
        file("finished-videos/x.mp4", D, 1 * GB, "exported-video"),
      ],
    })
    .send({ type: "scan-completed" });
  return tester.resetExec();
};

const result = (
  over: Partial<StorageOriginalsResult> = {}
): StorageOriginalsResult => ({
  bucketId: "course:a",
  bucketName: "A",
  from: D,
  dryRun: true,
  deleted: { files: 2, bytes: 7 * GB },
  kept: { files: 2, bytes: 7 * GB },
  left: [],
  ...over,
});

describe("bucketPageReducer: Delete originals (#2110)", () => {
  it("offers each root with files that have a same-size copy elsewhere, only once listed", () => {
    const tester = listed();
    expect(originalsOffers(tester.getState())).toEqual([
      { location: D, files: 2, bytes: 7 * GB },
      { location: E, files: 2, bytes: 7 * GB },
    ]);
    // Not while listing, and not for a bucket whose files are never moved.
    expect(originalsOffers(createInitialBucketPageState("course:a"))).toEqual(
      []
    );
    const renders = listed({
      id: "overlay-render-cache",
      kind: "overlay-render-cache",
      name: "Overlay Render Cache",
    });
    expect(originalsOffers(renders.getState())).toEqual([]);
  });

  it("asks the server, confirms with the count and GB, starts the Job once, and lists again once dismissed", () => {
    const tester = listed();
    tester.send({ type: "delete-originals-clicked", from: D });
    expect(tester.getState().originals).toEqual({
      status: "planning",
      bucket: course,
      from: D,
    });
    expect(tester.getEffects()).toEqual([
      { type: "plan-delete-originals", bucketId: "course:a", from: D },
    ]);

    // Nothing starts before the plan is in and confirmed.
    tester.send({ type: "delete-originals-confirmed" });
    tester.send({ type: "originals-planned", result: result() });
    expect(tester.getState().originals?.status).toBe("confirming");
    expect(tester.getEffects()).toHaveLength(1);

    tester
      .send({ type: "delete-originals-confirmed" })
      .send({ type: "delete-originals-confirmed" }); // a double click
    expect(tester.getState().originals?.status).toBe("starting");
    expect(tester.getEffects()).toEqual([
      { type: "plan-delete-originals", bucketId: "course:a", from: D },
      { type: "start-delete-originals", bucketId: "course:a", from: D },
    ]);
    // Cancel can't take it back once it is being started.
    tester.send({ type: "delete-originals-cancelled" });
    expect(tester.getState().originals?.status).toBe("starting");

    tester.send({ type: "delete-originals-started", jobId: "job-1" });
    expect(tester.getState().originals).toEqual({
      status: "started",
      bucket: course,
      from: D,
      plan: result(),
      jobId: "job-1",
    });
    // The Job deletes; the page keeps its listing until dismissed.
    expect(tester.getState().status).toBe("complete");

    tester.send({ type: "delete-originals-dismissed" });
    const state = tester.getState();
    expect(state.originals).toBeNull();
    expect(state.status).toBe("listing");
    expect(state.files).toEqual({});
    expect(tester.getEffects().at(-1)).toEqual({
      type: "listen-to-listing",
      bucketId: "course:a",
    });
  });

  it("is never offered for a root with no copies, and nothing to delete can't be confirmed", () => {
    const tester = listed();
    tester.send({ type: "delete-originals-clicked", from: "/mnt/f" });
    expect(tester.getState().originals).toBeNull();
    expect(tester.getEffects()).toEqual([]);

    tester.send({ type: "delete-originals-clicked", from: D });
    tester.send({
      type: "originals-planned",
      result: result({ deleted: { files: 0, bytes: 0 } }),
    });
    tester.send({ type: "delete-originals-confirmed" });
    expect(tester.getState().originals?.status).toBe("confirming");
    expect(tester.getEffects()).toHaveLength(1);

    tester.send({ type: "delete-originals-cancelled" });
    expect(tester.getState().originals).toBeNull();
  });

  it("a refusal is shown, and a Purge can't start while originals are being deleted (or the other way round)", () => {
    const tester = listed();
    // Ticked, then "Delete originals": the Purge waits.
    tester.send({
      type: "export-checkbox-toggled",
      path: "finished-videos/x.mp4",
    });
    expect(tester.getState().selected).toEqual(["finished-videos/x.mp4"]);
    tester.send({ type: "delete-originals-clicked", from: D });
    tester.send({ type: "purge-selected-clicked" });
    expect(tester.getState().purge).toBeNull();

    tester.send({
      type: "delete-originals-failed",
      bucketId: "course:a",
      from: D,
      message: "Not deleted: an export is queued or running",
    });
    expect(tester.getState().originals).toMatchObject({
      status: "failed",
      message: "Not deleted: an export is queued or running",
    });
    // Refused before anything went: no relisting.
    expect(tester.getState().status).toBe("complete");

    // A Purge under way: "Delete originals" waits.
    tester.send({ type: "delete-originals-dismissed" });
    tester.send({ type: "purge-selected-clicked" });
    expect(tester.getState().purge?.status).toBe("planning");
    tester.send({ type: "delete-originals-clicked", from: D });
    expect(tester.getState().originals).toBeNull();
  });

  it("a late answer for another root changes nothing", () => {
    const tester = listed();
    tester.send({ type: "delete-originals-clicked", from: D });
    tester.send({ type: "originals-planned", result: result({ from: E }) });
    expect(tester.getState().originals?.status).toBe("planning");
  });
});
