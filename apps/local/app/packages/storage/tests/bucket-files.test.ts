import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NodeContext } from "@effect/platform-node";
import { Cause, Effect, Exit, Layer, Logger, ManagedRuntime } from "effect";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { createSSEResponse } from "@/lib/create-sse-response.server";
import { computeExportHash, toExportClips } from "@/services/export-hash";
import { listVideosForExportHash } from "@cvm/core/services/db-export-hash-videos.server";
import type { Database } from "@cvm/core/services/drizzle-service.server";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";
import type { StorageRoots } from "../index";
import {
  addFoundFiles,
  largestFirst,
  type StorageBucketFilesMessage,
} from "../buckets";
import { streamStorageBucketFiles } from "../scan";

let testDb: TestDb;
let base: string;
let d: string;
let e: string;
let scratch: string;
let roots: StorageRoots;

const db = () => testDb as unknown as Database;

const put = (dir: string, relative: string, bytes: number) => {
  const full = path.join(dir, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, Buffer.alloc(bytes));
};

beforeAll(async () => {
  ({ testDb } = await createTestDb());
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  base = fs.mkdtempSync(path.join(os.tmpdir(), "storage-bucket-files-"));
  d = path.join(base, "d");
  e = path.join(base, "e");
  scratch = path.join(base, "scratch");
  fs.mkdirSync(d);
  fs.mkdirSync(e);
  roots = [d, e];
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

let order = 0;

const seedCourse = async (name: string) => {
  const [course] = await testDb
    .insert(schema.courses)
    .values({ name })
    .returning();
  const [version] = await testDb
    .insert(schema.courseVersions)
    .values({ repoId: course!.id, name: "v1" })
    .returning();
  const [section] = await testDb
    .insert(schema.sections)
    .values({ repoVersionId: version!.id, order: 1 })
    .returning();
  const [lesson] = await testDb
    .insert(schema.lessons)
    .values({ sectionId: section!.id, order: 1 })
    .returning();
  return { courseId: course!.id, lessonId: lesson!.id };
};

const seedVideo = async (opts: { lessonId?: string; footage: string[] }) => {
  const [video] = await testDb
    .insert(schema.videos)
    .values({
      title: "v",
      originalFootagePath: "",
      lessonId: opts.lessonId ?? null,
    })
    .returning();
  for (const stored of opts.footage) {
    await testDb.insert(schema.clips).values({
      videoId: video!.id,
      videoFilename: stored,
      sourceStartTime: 0,
      sourceEndTime: 1,
      order: `a${order++}`,
      text: "",
    });
  }
  return video!.id;
};

/** List one bucket to the end, keeping every message. */
const list = async (bucketId: string) => {
  const messages: StorageBucketFilesMessage[] = [];
  const exit = await Effect.runPromiseExit(
    streamStorageBucketFiles({
      db: db(),
      roots,
      bucketId,
      scratchDir: scratch,
      readDirtyBit: () => Effect.succeed("clean"),
      emit: (m) => messages.push(m),
    }).pipe(Effect.provide(NodeContext.layer))
  );
  return { messages, exit };
};

/** What the per-bucket page shows: the streamed files, largest first. */
const listed = (messages: StorageBucketFilesMessage[]) =>
  largestFirst(
    addFoundFiles(
      {},
      messages.flatMap((m) => (m.type === "files-found" ? m.files : []))
    )
  );

describe("streamStorageBucketFiles", () => {
  it("lists a bucket's files with size, kind and root(s), largest first", async () => {
    const a = await seedCourse("Course A");
    const other = await seedCourse("Course B");
    const videoA = await seedVideo({
      lessonId: a.lessonId,
      // A legacy absolute path reads as its root-relative form.
      footage: [path.join(d, "raw-footage/a.mkv")],
    });
    await seedVideo({
      lessonId: other.lessonId,
      footage: ["raw-footage/b.mkv"],
    });
    await testDb.insert(schema.recordingSessions).values({
      videoId: videoA,
      cameraFilePath: "raw-footage/session/camera.mkv",
      screenFilePath: "raw-footage/session/screen.mkv",
      micFilePath: "raw-footage/session/mic.wav",
    });
    const [exportedA] = (await listVideosForExportHash(db())).filter(
      (v) => v.id === videoA
    );
    const hash = computeExportHash(
      toExportClips(exportedA!.clips),
      exportedA!.format,
      roots
    );
    const current = `finished-videos/${a.courseId}-${hash}.mp4`;

    put(d, "raw-footage/a.mkv", 100);
    put(e, "raw-footage/a.mkv", 100); // mid-move: on both roots
    put(d, "raw-footage/a.mkv.transcript.json", 5);
    put(e, "raw-footage/session/camera.mkv", 60);
    put(e, "raw-footage/session/mic.wav", 6);
    put(d, current, 300);
    put(d, `${current}.sha256`, 1);
    put(d, "raw-footage/b.mkv", 999); // Course B's: not listed
    put(d, "raw-footage/unused.mkv", 999); // Unused Footage: not listed

    const { messages, exit } = await list(`course:${a.courseId}`);

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(messages.find((m) => m.type === "bucket-identified")).toEqual({
      type: "bucket-identified",
      bucket: { id: `course:${a.courseId}`, kind: "course", name: "Course A" },
    });
    expect(messages.at(-1)).toEqual({ type: "scan-completed" });
    expect(listed(messages)).toEqual([
      {
        path: current,
        role: "exported-video",
        companionOf: null,
        copies: { [d]: 300 },
        bytes: 300,
      },
      {
        path: "raw-footage/a.mkv",
        role: "footage",
        companionOf: null,
        copies: { [d]: 100, [e]: 100 },
        bytes: 100,
      },
      {
        path: "raw-footage/session/camera.mkv",
        role: "recording-session",
        companionOf: null,
        copies: { [e]: 60 },
        bytes: 60,
      },
      {
        path: "raw-footage/session/mic.wav",
        role: "recording-session",
        companionOf: null,
        copies: { [e]: 6 },
        bytes: 6,
      },
      {
        path: "raw-footage/a.mkv.transcript.json",
        role: "footage-companion",
        companionOf: "raw-footage/a.mkv",
        copies: { [d]: 5 },
        bytes: 5,
      },
      {
        path: `${current}.sha256`,
        role: "export-companion",
        companionOf: current,
        copies: { [d]: 1 },
        bytes: 1,
      },
    ]);
  });

  it("names the Courses that use Shared Footage", async () => {
    const a = await seedCourse("Course A");
    const b = await seedCourse("Course B");
    await seedVideo({ lessonId: a.lessonId, footage: ["raw-footage/s.mkv"] });
    await seedVideo({ lessonId: b.lessonId, footage: ["raw-footage/s.mkv"] });
    put(e, "raw-footage/s.mkv", 200);

    const { messages } = await list("shared-footage");

    expect(messages.find((m) => m.type === "bucket-identified")).toMatchObject({
      bucket: { name: "Shared Footage", sharedBy: ["Course A", "Course B"] },
    });
    expect(listed(messages).map((f) => [f.path, f.copies])).toEqual([
      ["raw-footage/s.mkv", { [e]: 200 }],
    ]);
  });

  it("lists export scratch, which is on no root", async () => {
    put(scratch, "job/abc.mp4", 7);
    put(d, "raw-footage/unused.mkv", 9);

    const { messages } = await list("export-scratch");

    expect(listed(messages)).toEqual([
      {
        path: "job/abc.mp4",
        role: "export-scratch",
        companionOf: null,
        copies: { [scratch]: 7 },
        bytes: 7,
      },
    ]);
  });

  it("fails for a bucket that does not exist", async () => {
    const { messages, exit } = await list("course:gone");

    expect(Exit.isFailure(exit)).toBe(true);
    expect(
      Exit.isFailure(exit) && Cause.failureOption(exit.cause)
    ).toMatchObject({
      _tag: "Some",
      value: { _tag: "StorageBucketNotFoundError", bucketId: "course:gone" },
    });
    expect(messages.some((m) => m.type === "files-found")).toBe(false);
  });

  it("stops the walk when the page closes the stream", async () => {
    for (let i = 0; i < 500; i++) put(d, `raw-footage/${i}.mkv`, 1);
    const lines: string[] = [];
    const logger = Logger.make(({ message }) => {
      lines.push(String(message));
    });
    const runtime = ManagedRuntime.make(
      Layer.merge(
        NodeContext.layer,
        Logger.replace(Logger.defaultLogger, logger)
      )
    );
    const response = createSSEResponse({
      runtime,
      program: (sendEvent) =>
        streamStorageBucketFiles({
          db: db(),
          roots,
          bucketId: "unused-footage",
          readDirtyBit: () => Effect.succeed("clean"),
          emit: (m) => sendEvent(m.type, m),
        }),
    });

    const reader = response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain("event: roots-measured");
    await reader.cancel();

    await expect
      .poll(() =>
        lines.some((l) => l.includes("listing unused-footage aborted"))
      )
      .toBe(true);
    expect(
      lines.some((l) => l.includes("listing unused-footage finished"))
    ).toBe(false);
    await runtime.dispose();
  });
});
