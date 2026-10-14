import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { eq } from "drizzle-orm";
import { NodeContext } from "@effect/platform-node";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";
import { DrizzleService } from "@/services/drizzle-service.server";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import * as schema from "@/db/schema";
import type { StorageRoots } from "@/packages/storage";
import { STORAGE_DELETED_EVENT, TRASH_FOLDER } from "@/packages/storage/client";
import { listStorageTrash } from "@/packages/storage/trash";
import type { JobContext } from "../job-kind";
import { storageDeleteJobKind } from "./storage-delete";
import {
  resetTrashExpirySweep,
  sweepExpiredTrash,
} from "../trash-expiry-sweep";

/**
 * The `storage-delete` Sidecar Job's other operations (#2157): the Trash for
 * Unused Footage, a Purge and an Other bucket's delete, run as the Sidecar
 * runs them, against PGlite and two temp directories as Storage Roots (never
 * a real drive).
 */

let testDb: TestDb;
let dbLayer: Layer.Layer<JobOperationsService | DrizzleService>;
let base: string;
let d: string;
let e: string;
const previousRoots = process.env.STORAGE_ROOTS;

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
  dbLayer = JobOperationsService.Default.pipe(
    Layer.provideMerge(Layer.succeed(DrizzleService, testDb as never))
  );
});

afterAll(() => {
  if (previousRoots === undefined) delete process.env.STORAGE_ROOTS;
  else process.env.STORAGE_ROOTS = previousRoots;
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  base = fs.mkdtempSync(path.join(os.tmpdir(), "storage-delete-ops-"));
  d = path.join(base, "d");
  e = path.join(base, "e");
  fs.mkdirSync(d);
  fs.mkdirSync(e);
  process.env.STORAGE_ROOTS = `${d},${e}`;
});

afterEach(() => {
  for (const dir of [d, e]) {
    if (!fs.existsSync(dir)) continue;
    for (const p of fs.readdirSync(dir, { recursive: true }) as string[]) {
      const full = path.join(dir, p);
      if (fs.lstatSync(full).isDirectory()) fs.chmodSync(full, 0o755);
    }
  }
  fs.rmSync(base, { recursive: true, force: true });
});

const roots = (): StorageRoots => [d, e];

const put = (dir: string, relative: string, content: Buffer | string) => {
  const full = path.join(dir, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
};

const OLD = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

/** A file last changed a month ago: old enough to be offered as Unused. */
const putOld = (dir: string, relative: string, content: string) => {
  put(dir, relative, content);
  fs.utimesSync(path.join(dir, relative), OLD, OLD);
};

const files = (dir: string) =>
  fs.existsSync(dir)
    ? (fs.readdirSync(dir, { recursive: true }) as string[])
        .filter((p) => fs.lstatSync(path.join(dir, p)).isFile())
        .map((p) => p.split(path.sep).join("/"))
        .sort()
    : [];

const run = <A, E>(effect: Effect.Effect<A, E, any>) =>
  Effect.runPromiseExit(
    effect.pipe(
      Effect.provide(Layer.mergeAll(dbLayer, NodeContext.layer))
    ) as Effect.Effect<A, E, never>
  );

const newJob = async (params: Record<string, unknown>) => {
  const exit = await run(
    Effect.flatMap(JobOperationsService, (ops) =>
      ops.enqueueJob({
        id: null,
        kind: "storage-delete",
        title: "Delete originals",
        lane: "default",
        params,
        maxAttempts: 1,
        dependsOn: null,
        subject: null,
      })
    )
  );
  if (!Exit.isSuccess(exit)) throw new Error("could not enqueue");
  return exit.value.id;
};

const ctxFor = (jobId: string): JobContext => ({
  jobId,
  attempt: 1,
  maxAttempts: 1,
  enqueue: () => Effect.die("this kind starts no other Job"),
  emit: (type, data) =>
    Effect.flatMap(JobOperationsService, (ops) =>
      ops.appendJobEvent({ jobId, type, data })
    ).pipe(Effect.orDie, Effect.provide(dbLayer)),
});

const eventsOf = async (jobId: string) => {
  const exit = await run(
    Effect.flatMap(JobOperationsService, (ops) => ops.listJobEvents(jobId))
  );
  if (!Exit.isSuccess(exit)) throw new Error("could not read events");
  return exit.value;
};

const failureOf = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) throw new Error("expected the Job to fail");
  return Option.getOrThrow(Cause.failureOption(exit.cause)) as {
    _tag: string;
    message: string;
  };
};

beforeEach(async () => {
  const [video] = await testDb
    .insert(schema.videos)
    .values({ title: "v", originalFootagePath: "" })
    .returning();
  await testDb.insert(schema.clips).values({
    videoId: video!.id,
    videoFilename: "raw-footage/used.mkv",
    sourceStartTime: 0,
    sourceEndTime: 1,
    order: "a0",
    text: "",
    archived: true,
  });
  putOld(d, "raw-footage/used.mkv", "used");
  putOld(d, "raw-footage/unused.mkv", "unused");
  putOld(e, "raw-footage/old/unused-e.mkv", "unused on e");
});

const runJob = async (params: Record<string, unknown>) => {
  const jobId = await newJob(params);
  const exit = await run(
    storageDeleteJobKind.runRaw(params as never, ctxFor(jobId))
  );
  // As the Sidecar would settle it: a finished Job holds nothing back.
  await testDb
    .update(schema.jobs)
    .set({ status: Exit.isSuccess(exit) ? "succeeded" : "failed" })
    .where(eq(schema.jobs.id, jobId));
  return { jobId, exit };
};

describe("a storage-delete Job (the Trash)", () => {
  it("moves Unused Footage to the Trash on its own drive, keeps archived-Clip Footage, and reports it", async () => {
    const { jobId, exit } = await runJob({ operation: "trash-unused" });
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(files(path.join(d, "raw-footage"))).toEqual(["used.mkv"]);
    expect(files(path.join(e, "raw-footage"))).toEqual([]);
    expect(
      files(path.join(d, TRASH_FOLDER)).map((p) => p.replace(/^[^/]+\//, ""))
    ).toEqual(["raw-footage/unused.mkv"]);
    expect(
      files(path.join(e, TRASH_FOLDER)).map((p) => p.replace(/^[^/]+\//, ""))
    ).toEqual(["raw-footage/old/unused-e.mkv"]);
    const events = await eventsOf(jobId);
    expect(
      events.find((ev) => ev.type === STORAGE_DELETED_EVENT)?.data
    ).toMatchObject({
      operation: "trash-unused",
      deleted: { files: 2 },
      left: [],
    });
  });

  it("restores a trashed file, then Empty trash deletes the rest for good", async () => {
    await runJob({ operation: "trash-unused" });
    const entries = await Effect.runPromise(
      listStorageTrash({ roots: roots() })
    );
    const onE = entries.find((x) => x.location === e)!;
    const restored = await runJob({
      operation: "restore-trash",
      files: [{ location: onE.location, batch: onE.batch, path: onE.path }],
    });
    expect(Exit.isSuccess(restored.exit)).toBe(true);
    expect(files(path.join(e, "raw-footage"))).toEqual(["old/unused-e.mkv"]);

    const emptied = await runJob({ operation: "empty-trash" });
    expect(Exit.isSuccess(emptied.exit)).toBe(true);
    expect(files(path.join(d, TRASH_FOLDER))).toEqual([]);
    expect(files(path.join(d, "raw-footage"))).toEqual(["used.mkv"]);
  });

  it("deletes one Other bucket's named file, nothing else", async () => {
    put(d, "overlay-renders/a.mov", "a");
    put(d, "overlay-renders/b.mov", "b");
    const { exit } = await runJob({
      operation: "delete-bucket",
      bucketId: "overlay-render-cache",
      files: [{ location: d, path: "overlay-renders/a.mov" }],
    });
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(files(path.join(d, "overlay-renders"))).toEqual(["b.mov"]);
  });

  it("refuses to trash while a recording is active, moving nothing", async () => {
    await testDb.insert(schema.recordingSessions).values({
      cameraFilePath: "raw-footage/rec/camera.mkv",
      screenFilePath: "raw-footage/rec/screen.mkv",
      micFilePath: "raw-footage/rec/mic.mkv",
      status: "recording",
    });
    const { exit } = await runJob({ operation: "trash-unused" });
    expect(failureOf(exit)._tag).toBe("StorageTrashRefusedError");
    expect(files(path.join(d, "raw-footage"))).toEqual([
      "unused.mkv",
      "used.mkv",
    ]);
  });

  it("cancelled before it starts, trashes nothing and ends cancelled", async () => {
    const jobId = await newJob({ operation: "trash-unused" });
    await run(
      Effect.flatMap(JobOperationsService, (ops) =>
        Effect.zipRight(
          ops.claimNextJob({ lane: "default", holder: "h", leaseMs: 30_000 }),
          ops.requestJobCancel({ jobId, kinds: ["storage-delete"] })
        )
      )
    );
    const exit = await run(
      storageDeleteJobKind.runRaw(
        { operation: "trash-unused" } as never,
        ctxFor(jobId)
      )
    );
    expect(failureOf(exit)._tag).toBe("JobCancelledError");
    expect(files(path.join(d, "raw-footage"))).toEqual([
      "unused.mkv",
      "used.mkv",
    ]);
  });
});

describe("the Trash expiry sweep", () => {
  it("queues one expire-trash Job when a batch is over 14 days old, then waits an hour", async () => {
    resetTrashExpirySweep();
    put(d, `${TRASH_FOLDER}/20260101T000000Z-old/raw-footage/x.mkv`, "x");
    put(d, `${TRASH_FOLDER}/29990101T000000Z-new/raw-footage/y.mkv`, "y");
    await run(sweepExpiredTrash);
    await run(sweepExpiredTrash);
    const jobs = await testDb.select().from(schema.jobs);
    expect(jobs.map((j) => j.params)).toEqual([{ operation: "expire-trash" }]);

    const { exit } = await (async () => {
      const job = jobs[0]!;
      const exit = await run(
        storageDeleteJobKind.runRaw(
          { operation: "expire-trash" } as never,
          ctxFor(job.id)
        )
      );
      return { exit };
    })();
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(files(path.join(d, TRASH_FOLDER))).toEqual([
      "29990101T000000Z-new/raw-footage/y.mkv",
    ]);
  });
});
