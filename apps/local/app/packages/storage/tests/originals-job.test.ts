import fs from "node:fs";
import path from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import {
  realStorageOriginalsDisk,
  startDeleteOriginals,
  type StorageOriginalsDisk,
} from "../originals";
import { deleteOtherStorageBucket } from "../delete";
import { purgeExportedVideos } from "../purge";
import { planStorageMove, startStorageMove } from "../move";
import {
  base,
  d,
  db,
  deleteOriginals,
  e,
  failureOf,
  roots,
  seedMovedCourse,
  testDb,
  tree,
  valueOf,
} from "./originals-test-harness";

describe("deleteStorageOriginals: never beside other work", () => {
  const job = (kind: string, status: "queued" | "running") =>
    testDb.insert(schema.jobs).values({
      kind,
      title: `${kind} job`,
      lane: "default",
      params: {},
      status,
      maxAttempts: 1,
    });

  it("refuses while a move, an export, a Publish, a transcription or a voice is queued or running", async () => {
    const { bucketId } = await seedMovedCourse();
    const before = tree(d);
    for (const kind of [
      "storage-move",
      "export",
      "batch-export",
      "render-vertical",
      "publish",
      "transcribe-footage",
      "transcribe-clips",
      "clip-mockup-voice",
    ]) {
      for (const status of ["queued", "running"] as const) {
        await testDb.delete(schema.jobs);
        await job(kind, status);
        const refused = failureOf(await deleteOriginals({ bucketId }));
        expect(refused.reason, `${kind} ${status}`).toBe("export-running");
      }
    }
    expect(tree(d)).toEqual(before);
  });

  it("refuses while a Recording Session is recording", async () => {
    const { bucketId, videoId } = await seedMovedCourse();
    await testDb.insert(schema.recordingSessions).values({
      videoId,
      cameraFilePath: "raw-footage/s/camera.mkv",
      screenFilePath: "raw-footage/s/screen.mkv",
      micFilePath: "raw-footage/s/mic.wav",
      status: "recording",
    });
    expect(failureOf(await deleteOriginals({ bucketId })).reason).toBe(
      "recording-active"
    );
    expect(tree(d)).toContain("raw-footage/take-1.mkv");
  });

  it("refuses while a move is being started (the Storage page's write hold), and a move refuses while it runs", async () => {
    const { bucketId } = await seedMovedCourse();
    const before = tree(d);
    const seen: string[] = [];
    await Effect.runPromise(
      startStorageMove({
        db: db(),
        roots,
        bucketId: "unused-footage",
        kind: "footage",
        target: e,
        enqueue: () =>
          Effect.promise(async () => {
            seen.push(failureOf(await deleteOriginals({ bucketId })).reason!);
          }),
      })
    );
    expect(seen).toEqual(["storage-busy"]);
    expect(tree(d)).toEqual(before);

    // And the other way round: a move is not started mid-delete.
    const moveRefusals: string[] = [];
    const disk: StorageOriginalsDisk = {
      unlink: async (file) => {
        if (moveRefusals.length === 0) {
          const started = await Effect.runPromiseExit(
            startStorageMove({
              db: db(),
              roots,
              bucketId: "unused-footage",
              kind: "footage",
              target: e,
              enqueue: () => Effect.succeed("queued"),
            })
          );
          const refusals = (
            failureOf(started) as { refusals?: { reason: string }[] }
          ).refusals;
          moveRefusals.push(...(refusals ?? []).map((r) => r.reason));
        }
        return realStorageOriginalsDisk.unlink(file);
      },
    };
    valueOf(await deleteOriginals({ bucketId, disk }));
    expect(moveRefusals).toEqual(["storage-busy"]);
  });

  it("an export queued part-way stops the run: what is left is reported, still on D:", async () => {
    const { bucketId } = await seedMovedCourse();
    let unlinks = 0;
    const disk: StorageOriginalsDisk = {
      unlink: async (file) => {
        unlinks += 1;
        await realStorageOriginalsDisk.unlink(file);
        if (unlinks === 1) await job("export", "queued");
      },
    };
    const result = valueOf(await deleteOriginals({ bucketId, disk }));
    expect(result.deleted.files).toBe(1);
    expect(result.left.length).toBe(4);
    for (const l of result.left) {
      expect(l.message).toMatch(/stopped before deleting it/);
    }
    expect(unlinks).toBe(1);
    expect(tree(d).length).toBe(5); // 4 of the Course's + Unused Footage
  });
});

describe("Delete originals runs as a storage-delete Job", () => {
  const liveJob = async (
    kind: string,
    params: Record<string, unknown> = {}
  ) => {
    const [row] = await testDb
      .insert(schema.jobs)
      .values({
        kind,
        title: `${kind} job`,
        lane: "default",
        params,
        status: "running",
        maxAttempts: 1,
      })
      .returning();
    return row!.id;
  };

  it("starting it reads no drive and deletes nothing: the Job walks and verifies (#2429)", async () => {
    const { bucketId } = await seedMovedCourse();
    const before = tree(d);
    // D: gone: a start that walked it would be refused as Offline.
    const away = `${d}-away`;
    fs.renameSync(d, away);
    const enqueued: string[] = [];
    const exit = await Effect.runPromiseExit(
      startDeleteOriginals({
        db: db(),
        roots,
        bucketId,
        from: d,
        enqueue: ({ bucketName }) =>
          Effect.sync(() => {
            enqueued.push(bucketName);
            return { id: "job-1" };
          }),
      })
    );
    fs.renameSync(away, d);
    expect(valueOf(exit)).toEqual({ id: "job-1" });
    expect(enqueued).toEqual(["Crash Course"]);
    // Nothing is deleted until the Job runs.
    expect(tree(d)).toEqual(before);
  });

  it("starting it is refused while other work runs, and enqueues nothing", async () => {
    const { bucketId } = await seedMovedCourse();
    let enqueued = 0;
    await liveJob("storage-delete", { operation: "originals", bucketId });
    const exit = await Effect.runPromiseExit(
      startDeleteOriginals({
        db: db(),
        roots,
        bucketId,
        from: d,
        enqueue: () => Effect.sync(() => ++enqueued),
      })
    );
    expect(failureOf(exit).reason).toBe("export-running");
    expect(enqueued).toBe(0);
  });

  it("while a storage-delete Job is queued or running, a move, a Purge and an Other delete refuse", async () => {
    const { bucketId } = await seedMovedCourse();
    await liveJob("storage-delete", { operation: "originals", bucketId });
    const plan = await Effect.runPromise(
      planStorageMove({
        db: db(),
        roots,
        bucketId: "unused-footage",
        kind: "footage",
        target: e,
      })
    );
    expect(plan.refusals.map((r) => r.reason)).toContain("storage-busy");
    const purged = failureOf(
      await Effect.runPromiseExit(
        purgeExportedVideos({ db: db(), roots, bucketId, dryRun: true })
      )
    );
    expect(purged.message).toMatch(/a delete is queued or running/);
    const deletedOther = failureOf(
      await Effect.runPromiseExit(
        deleteOtherStorageBucket({
          db: db(),
          roots,
          bucketId: "overlay-render-cache",
          scratchDir: path.join(base, "scratch"),
        })
      )
    );
    expect(deletedOther.reason).toBe("export-running");
  });

  it("the Job does not refuse itself: its own running row is not other work", async () => {
    const { bucketId } = await seedMovedCourse();
    const self = await liveJob("storage-delete", {
      operation: "originals",
      bucketId,
    });
    const result = valueOf(
      await deleteOriginals({ bucketId, selfJobId: self })
    );
    expect(result.deleted.files).toBe(5);
    // A second one is other work.
    await liveJob("storage-delete", { operation: "originals", bucketId });
    expect(
      failureOf(await deleteOriginals({ bucketId, selfJobId: self })).reason
    ).toBe("export-running");
  });

  it("Cancel stops before the next file; what was deleted was a verified duplicate", async () => {
    const { bucketId } = await seedMovedCourse();
    let unlinks = 0;
    let cancel = false;
    const disk: StorageOriginalsDisk = {
      unlink: async (file) => {
        unlinks += 1;
        await realStorageOriginalsDisk.unlink(file);
        cancel = true;
      },
    };
    const failure = failureOf(
      await deleteOriginals({ bucketId, disk, cancelRequested: () => cancel })
    );
    expect(failure._tag).toBe("StorageOriginalsCancelledError");
    expect(failure.message).toMatch(/1 originals were deleted/);
    expect(unlinks).toBe(1);
    expect(tree(d).length).toBe(5);
  });

  it("reports its progress by bytes, ending below 100 (the Job says 100 when done)", async () => {
    const { bucketId } = await seedMovedCourse();
    const seen: number[] = [];
    valueOf(
      await deleteOriginals({ bucketId, onProgress: (p) => seen.push(p) })
    );
    expect(seen.length).toBeGreaterThan(1);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(seen.at(-1)).toBe(99);
  });
});
