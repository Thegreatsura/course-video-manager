import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NodeContext } from "@effect/platform-node";
import { Cause, Effect, Layer, Logger, ManagedRuntime } from "effect";
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
} from "@/test-utils/pglite";
import type { StorageRoots } from "../index";
import type { StorageScanMessage } from "../buckets";
import { streamStorageScan } from "../scan";

let testDb: TestDb;
let base: string;
let d: string;
let e: string;
let scratch: string;
let roots: StorageRoots;

const db = () => testDb as unknown as Database;

/** Write a file of `bytes` bytes under a root (or any folder). */
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
  base = fs.mkdtempSync(path.join(os.tmpdir(), "storage-scan-"));
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

/** A Course with one Version, Section and Lesson; returns the Lesson id. */
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

const seedVideo = async (opts: {
  lessonId?: string;
  format?: "landscape" | "short";
  footage: string[];
}) => {
  const [video] = await testDb
    .insert(schema.videos)
    .values({
      title: "v",
      originalFootagePath: "",
      lessonId: opts.lessonId ?? null,
      format: opts.format ?? "landscape",
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

/** Run the scan to the end, keeping every message. */
const scan = async () => {
  const messages: StorageScanMessage[] = [];
  await Effect.runPromise(
    streamStorageScan({
      db: db(),
      roots,
      scratchDir: scratch,
      emit: (m) => messages.push(m),
    }).pipe(Effect.provide(NodeContext.layer))
  );
  return messages;
};

/** bucket id → location → kind → bytes, added up from the deltas. */
const totals = (messages: StorageScanMessage[]) => {
  const out: Record<string, Record<string, Record<string, number>>> = {};
  for (const m of messages) {
    if (m.type !== "sizes-counted") continue;
    for (const s of m.sizes) {
      const byLocation = (out[s.bucketId] ??= {});
      const byKind = (byLocation[s.location] ??= {});
      byKind[s.kind] = (byKind[s.kind] ?? 0) + s.bytes;
    }
  }
  return out;
};

describe("streamStorageScan", () => {
  it("counts every file in its Storage Bucket, per root and per kind", async () => {
    const a = await seedCourse("Course A");
    const b = await seedCourse("Course B");
    const videoA = await seedVideo({
      lessonId: a.lessonId,
      // A legacy absolute path reads as its root-relative form.
      footage: [path.join(d, "raw-footage/a.mkv"), "raw-footage/shared.mkv"],
    });
    await seedVideo({
      lessonId: b.lessonId,
      footage: ["raw-footage/shared.mkv"],
    });
    const standalone = await seedVideo({ footage: ["raw-footage/s.mkv"] });
    const short = await seedVideo({
      format: "short",
      footage: ["raw-footage/short.mkv"],
    });

    // Course A's current Exported Video, named by its Export Hash.
    const [exportedA] = (await listVideosForExportHash(db())).filter(
      (v) => v.id === videoA
    );
    const hash = computeExportHash(
      toExportClips(exportedA!.clips),
      exportedA!.format,
      roots
    );
    const currentA = `${a.courseId}-${hash}.mp4`;

    put(d, "raw-footage/a.mkv", 100);
    put(d, "raw-footage/a.mkv.transcript.json", 5);
    put(e, "raw-footage/a.mkv", 100); // mid-move: on both roots
    put(e, "raw-footage/shared.mkv", 200);
    put(d, "raw-footage/s.mkv", 30);
    put(d, "raw-footage/short.mkv", 40);
    put(d, "raw-footage/nested/unused.mkv", 70);
    put(d, `finished-videos/${currentA}`, 300);
    put(d, `finished-videos/${currentA}.sha256`, 1);
    // A stale export (no Video's current Export Hash): orphaned.
    put(e, `finished-videos/${standalone}-${"0".repeat(32)}.mp4`, 9);
    put(d, `finished-videos/${short}.mp4`, 20);
    put(d, `finished-videos/${a.courseId}-${"f".repeat(32)}.mp4`, 11);
    put(d, "clip-mockups/m/1.png", 3);
    put(e, "overlay-renders/r.png", 4);
    put(d, "not-cvm/elsewhere.mkv", 999); // outside CVM's folders: not walked
    put(scratch, "abc.mp4", 7);

    const messages = await scan();

    expect(messages[0]).toMatchObject({
      type: "roots-measured",
      roots: [
        { root: d, online: true },
        { root: e, online: true },
      ],
    });
    const listed = messages.find((m) => m.type === "buckets-listed");
    expect(
      listed?.type === "buckets-listed" &&
        listed.buckets.find((bucket) => bucket.id === "shared-footage")
    ).toEqual({
      id: "shared-footage",
      kind: "shared-footage",
      name: "Shared Footage",
      sharedBy: ["Course A", "Course B"],
    });
    expect(messages.at(-1)).toEqual({ type: "scan-completed" });

    expect(totals(messages)).toEqual({
      [`course:${a.courseId}`]: {
        [d]: { footage: 105, "exported-videos": 301 },
        [e]: { footage: 100 },
      },
      "shared-footage": { [e]: { footage: 200 } },
      "standalone-videos": { [d]: { footage: 30 } },
      shorts: { [d]: { footage: 40, "exported-videos": 20 } },
      "unused-footage": { [d]: { footage: 70 } },
      "orphaned-exports": {
        [d]: { "exported-videos": 11 },
        [e]: { "exported-videos": 9 },
      },
      "clip-mockups": { [d]: { other: 3 } },
      "overlay-render-cache": { [e]: { other: 4 } },
      "export-scratch": { [scratch]: { other: 7 } },
    });
  });

  it("shows an unreadable root as Offline, with no sizes for it", async () => {
    await seedVideo({ footage: ["raw-footage/s.mkv"] });
    put(d, "raw-footage/s.mkv", 30);
    put(e, "raw-footage/s.mkv", 30);
    fs.rmSync(e, { recursive: true });

    const messages = await scan();

    expect(messages[0]).toMatchObject({
      type: "roots-measured",
      roots: [
        { root: d, online: true },
        { root: e, online: false },
      ],
    });
    expect(totals(messages)).toEqual({
      "standalone-videos": { [d]: { footage: 30 } },
    });
  });

  it("stops the walk when the page closes the stream", async () => {
    for (let i = 0; i < 500; i++) put(d, `raw-footage/${i}.mkv`, 1);
    const lines: string[] = [];
    const logger = Logger.make(({ message, cause }) => {
      lines.push([String(message), Cause.pretty(cause)].join("\n"));
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
        streamStorageScan({
          db: db(),
          roots,
          emit: (m) => sendEvent(m.type, m),
        }),
    });

    const reader = response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain("event: roots-measured");
    // The page leaves.
    await reader.cancel();

    await expect
      .poll(() => lines.some((l) => l.includes("[storage] scan aborted")))
      .toBe(true);
    expect(lines.some((l) => l.includes("[storage] scan finished"))).toBe(
      false
    );
    await runtime.dispose();
  });
});
