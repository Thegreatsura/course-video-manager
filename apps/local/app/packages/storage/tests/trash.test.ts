import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Effect, Exit } from "effect";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Database } from "@cvm/core/services/drizzle-service.server";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";
import type { StorageRoots } from "../index";
import { classifyStorageFile } from "../buckets";
import { loadStorageOwnership } from "../scan";
import { TRASH_FOLDER, trashDoneFiles } from "../client";
import {
  emptyStorageTrash,
  listStorageTrash,
  restoreTrashedFootage,
  trashHasExpired,
  trashUnusedFootage,
} from "../trash";

/**
 * The trash for Unused Footage (#2157). Storage Roots are real temp
 * directories (`d`, `e`) inside `base`; `outside` is a folder beside them
 * that links point at. Nothing outside `base` is ever touched.
 */

let testDb: TestDb;
let base: string;
let d: string;
let e: string;
let outside: string;
let roots: StorageRoots;

const db = () => testDb as unknown as Database;
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-13T12:00:00Z");
const OLD = new Date(NOW.getTime() - 30 * DAY);

const put = (dir: string, relative: string, opts: { age?: Date } = {}) => {
  const full = path.join(dir, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, Buffer.from(relative));
  const at = opts.age ?? OLD;
  fs.utimesSync(full, at, at);
  return full;
};

const exists = (dir: string, relative: string) =>
  fs.existsSync(path.join(dir, relative));

/** Every file under `dir`, relative to it; links listed as themselves. */
const tree = (dir: string): string[] => {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const go = (sub: string) => {
    for (const entry of fs.readdirSync(path.join(dir, sub), {
      withFileTypes: true,
    })) {
      const rel = path.posix.join(sub, entry.name);
      if (entry.isDirectory()) go(rel);
      else out.push(rel);
    }
  };
  go("");
  return out.sort();
};

const trashed = (dir: string) =>
  tree(path.join(dir, TRASH_FOLDER)).map((p) =>
    p.split("/").slice(1).join("/")
  );

beforeAll(async () => {
  ({ testDb } = await createTestDb());
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  base = fs.mkdtempSync(path.join(os.tmpdir(), "storage-trash-"));
  d = path.join(base, "d");
  e = path.join(base, "e");
  outside = path.join(base, "outside");
  fs.mkdirSync(d);
  fs.mkdirSync(e);
  fs.mkdirSync(outside);
  roots = [d, e];
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

let order = 0;

const seedVideo = async () => {
  const [video] = await testDb
    .insert(schema.videos)
    .values({ title: "v", originalFootagePath: "", format: "landscape" })
    .returning();
  return video!.id;
};

const seedClip = async (opts: {
  videoId: string;
  stored: string;
  archived?: boolean;
  recordingSessionId?: string;
}) => {
  await testDb.insert(schema.clips).values({
    videoId: opts.videoId,
    videoFilename: opts.stored,
    sourceStartTime: 0,
    sourceEndTime: 1,
    order: `a${order++}`,
    text: "",
    archived: opts.archived ?? false,
    recordingSessionId: opts.recordingSessionId ?? null,
  });
};

const seedSession = async (opts: {
  folder: string;
  startedAt: Date;
  status?: "recording" | "stopped" | "crashed";
  videoId?: string | null;
}) => {
  const [session] = await testDb
    .insert(schema.recordingSessions)
    .values({
      videoId: opts.videoId ?? null,
      cameraFilePath: `${opts.folder}/camera.mkv`,
      screenFilePath: `${opts.folder}/screen.mkv`,
      micFilePath: `${opts.folder}/mic.mkv`,
      status: opts.status ?? "stopped",
      startedAt: opts.startedAt,
    })
    .returning();
  for (const f of ["camera.mkv", "screen.mkv", "mic.mkv"]) {
    put(d, `${opts.folder}/${f}`);
  }
  return session!.id;
};

const seedJob = async (kind: string, status: "queued" | "running") => {
  const [job] = await testDb
    .insert(schema.jobs)
    .values({
      kind,
      title: `A ${kind} Job`,
      lane: "default",
      params: {},
      status,
      maxAttempts: 1,
    })
    .returning();
  return job!.id;
};

const trash = (opts: Partial<Parameters<typeof trashUnusedFootage>[0]> = {}) =>
  Effect.runPromise(
    trashUnusedFootage({ db: db(), roots, now: NOW, batchId: "job1", ...opts })
  );

const trashExit = (
  opts: Partial<Parameters<typeof trashUnusedFootage>[0]> = {}
) =>
  Effect.runPromiseExit(
    trashUnusedFootage({ db: db(), roots, now: NOW, ...opts })
  );

const failureOf = <A, E>(exit: Exit.Exit<A, E>) => {
  if (Exit.isSuccess(exit)) throw new Error("expected a failure");
  const failure = exit.cause._tag === "Fail" ? exit.cause.error : null;
  if (failure === null) throw new Error(`unexpected cause ${exit.cause._tag}`);
  return failure;
};

describe("which Footage is Unused", () => {
  it("keeps Footage a live Clip uses, and Footage only an archived Clip uses", async () => {
    const videoId = await seedVideo();
    await seedClip({ videoId, stored: "raw-footage/live.mkv" });
    await seedClip({
      videoId,
      stored: `${d}/raw-footage/archived.mkv`,
      archived: true,
    });
    put(d, "raw-footage/live.mkv");
    put(d, "raw-footage/archived.mkv");
    put(d, "raw-footage/archived.mkv.transcript.json");
    put(d, "raw-footage/unused.mkv");
    put(e, "raw-footage/unused-on-e.mkv");

    const result = await trash();

    expect(exists(d, "raw-footage/live.mkv")).toBe(true);
    expect(exists(d, "raw-footage/archived.mkv")).toBe(true);
    expect(exists(d, "raw-footage/archived.mkv.transcript.json")).toBe(true);
    expect(exists(d, "raw-footage/unused.mkv")).toBe(false);
    expect(exists(e, "raw-footage/unused-on-e.mkv")).toBe(false);
    // Into the trash on its OWN root, at its root-relative path.
    expect(trashed(d)).toEqual(["raw-footage/unused.mkv"]);
    expect(trashed(e)).toEqual(["raw-footage/unused-on-e.mkv"]);
    expect(trashDoneFiles(result)).toBe(2);
    expect(result.left).toEqual([]);
  });

  it("keeps a file named on the page that a Clip uses, and says why", async () => {
    const videoId = await seedVideo();
    await seedClip({ videoId, stored: "raw-footage/used.mkv", archived: true });
    put(d, "raw-footage/used.mkv");
    put(d, "raw-footage/unused.mkv");
    put(d, "raw-footage/other-unused.mkv");

    const result = await trash({
      files: [
        { location: d, path: "raw-footage/used.mkv" },
        { location: d, path: "raw-footage/unused.mkv" },
      ],
    });

    expect(exists(d, "raw-footage/used.mkv")).toBe(true);
    expect(exists(d, "raw-footage/unused.mkv")).toBe(false);
    // Not named: untouched.
    expect(exists(d, "raw-footage/other-unused.mkv")).toBe(true);
    expect(result.kept).toEqual([
      expect.objectContaining({ path: "raw-footage/used.mkv" }),
    ]);
  });

  it("keeps Footage changed in the last 7 days", async () => {
    put(d, "raw-footage/today.mkv", { age: new Date(NOW.getTime() - DAY) });
    put(d, "raw-footage/old.mkv");

    const result = await trash();

    expect(exists(d, "raw-footage/today.mkv")).toBe(true);
    expect(exists(d, "raw-footage/old.mkv")).toBe(false);
    expect(result.kept).toEqual([
      expect.objectContaining({
        path: "raw-footage/today.mkv",
        reason: "it changed less than 7 days ago",
      }),
    ]);
  });

  it("never offers a Recording Session under 7 days old, or anything in its folder", async () => {
    await seedSession({
      folder: "raw-footage/rec-young",
      startedAt: new Date(NOW.getTime() - 2 * DAY),
    });
    put(d, "raw-footage/rec-young/recorder.log");
    await seedSession({ folder: "raw-footage/rec-old", startedAt: OLD });

    await trash();

    expect(tree(path.join(d, "raw-footage/rec-young"))).toEqual([
      "camera.mkv",
      "mic.mkv",
      "recorder.log",
      "screen.mkv",
    ]);
    // Old, stopped, no Clip: Unused.
    expect(exists(d, "raw-footage/rec-old")).toBe(false);
    expect(trashed(d)).toContain("raw-footage/rec-old/camera.mkv");
  });

  it("keeps a Recording Session an archived Clip uses, and everything in its folder", async () => {
    const videoId = await seedVideo();
    const sessionId = await seedSession({
      folder: "raw-footage/rec-a",
      startedAt: OLD,
      videoId,
    });
    await seedClip({
      videoId,
      stored: "raw-footage/rec-a/camera.mkv",
      archived: true,
      recordingSessionId: sessionId,
    });
    put(d, "raw-footage/rec-a/recorder.log");

    await trash();

    expect(tree(path.join(d, "raw-footage/rec-a"))).toEqual([
      "camera.mkv",
      "mic.mkv",
      "recorder.log",
      "screen.mkv",
    ]);
    expect(trashed(d)).toEqual([]);
  });

  it("keeps an AV Calibration's files", async () => {
    const folder = "raw-footage/av-calibrations/20261001 cal";
    await testDb.insert(schema.avCalibrations).values({
      outcome: "passed",
      noiseFloorDb: -60,
      speechLufs: -18,
      thresholdDb: -34,
      recorderMic: "mic",
      scriptVersion: 1,
      micFilePath: `${folder}/mic.wav`,
      browserTracePath: `${folder}/trace.json`,
    });
    put(d, `${folder}/mic.wav`);
    put(d, `${folder}/trace.json`);
    put(d, `${folder}/camera.mkv`);

    await trash();

    expect(tree(path.join(d, folder))).toEqual([
      "camera.mkv",
      "mic.wav",
      "trace.json",
    ]);
  });

  it("files an old clipless Recording Session under Unused Footage in the scan", async () => {
    await seedSession({ folder: "raw-footage/rec-old", startedAt: OLD });
    await seedSession({
      folder: "raw-footage/rec-new",
      startedAt: new Date(NOW.getTime() - DAY),
    });
    await seedSession({
      folder: "raw-footage/rec-live",
      startedAt: OLD,
      status: "recording",
    });
    const ownership = await Effect.runPromise(
      loadStorageOwnership(db(), roots, NOW)
    );
    expect(
      classifyStorageFile(ownership, "raw-footage/rec-old/camera.mkv")?.bucketId
    ).toBe("unused-footage");
    expect(
      classifyStorageFile(ownership, "raw-footage/rec-new/camera.mkv")?.bucketId
    ).toBe("standalone-videos");
    expect(
      classifyStorageFile(ownership, "raw-footage/rec-live/camera.mkv")
        ?.bucketId
    ).toBe("standalone-videos");
  });
});

describe("path safety", () => {
  it("never follows a link to a file outside the root", async () => {
    const target = put(outside, "precious.mkv");
    fs.mkdirSync(path.join(d, "raw-footage"), { recursive: true });
    fs.symlinkSync(target, path.join(d, "raw-footage/link.mkv"));

    const result = await trash({
      files: [{ location: d, path: "raw-footage/link.mkv" }],
    });

    expect(fs.existsSync(target)).toBe(true);
    expect(
      fs.lstatSync(path.join(d, "raw-footage/link.mkv")).isSymbolicLink()
    ).toBe(true);
    expect(result.left).toEqual([
      expect.objectContaining({ path: "raw-footage/link.mkv" }),
    ]);
    expect(trashed(d)).toEqual([]);
  });

  it("never walks into a linked folder, even when a file in it is named", async () => {
    put(outside, "sub/precious.mkv");
    fs.mkdirSync(path.join(d, "raw-footage"), { recursive: true });
    fs.symlinkSync(path.join(outside, "sub"), path.join(d, "raw-footage/sub"));

    const all = await trash();
    const named = await trash({
      files: [{ location: d, path: "raw-footage/sub/precious.mkv" }],
    });

    expect(exists(outside, "sub/precious.mkv")).toBe(true);
    expect(trashDoneFiles(all)).toBe(0);
    expect(trashDoneFiles(named)).toBe(0);
    expect(named.left).toHaveLength(1);
  });

  it("touches nothing when raw-footage/ itself is a link elsewhere", async () => {
    put(outside, "footage/precious.mkv");
    fs.symlinkSync(path.join(outside, "footage"), path.join(d, "raw-footage"));

    const result = await trash();

    expect(exists(outside, "footage/precious.mkv")).toBe(true);
    expect(trashDoneFiles(result)).toBe(0);
  });

  it("refuses a path that climbs out of raw-footage/", async () => {
    put(d, "finished-videos/x.mp4");
    put(d, "raw-footage/a.mkv");

    const result = await trash({
      files: [
        { location: d, path: "raw-footage/../finished-videos/x.mp4" },
        { location: outside, path: "raw-footage/a.mkv" },
      ],
    });

    expect(exists(d, "finished-videos/x.mp4")).toBe(true);
    expect(exists(d, "raw-footage/a.mkv")).toBe(true);
    expect(result.left).toHaveLength(2);
  });

  it("refuses to put the trash anywhere but the root itself", async () => {
    put(d, "raw-footage/a.mkv");
    fs.mkdirSync(path.join(outside, "trash"));
    fs.symlinkSync(path.join(outside, "trash"), path.join(d, TRASH_FOLDER));

    const result = await trash();

    expect(exists(d, "raw-footage/a.mkv")).toBe(true);
    expect(tree(path.join(outside, "trash"))).toEqual([]);
    expect(result.left).toHaveLength(1);
  });

  it("touches nothing outside a verify run's own folder", async () => {
    put(d, "raw-footage/a.mkv");
    const result = await trash({ confineTo: outside });
    expect(exists(d, "raw-footage/a.mkv")).toBe(true);
    expect(trashDoneFiles(result)).toBe(0);
  });
});

describe("refusals", () => {
  it("refuses while recording, and moves nothing", async () => {
    await seedSession({
      folder: "raw-footage/rec",
      startedAt: NOW,
      status: "recording",
    });
    put(d, "raw-footage/a.mkv");

    const failure = failureOf(await trashExit());

    expect(failure).toMatchObject({ reason: "recording-active" });
    expect(exists(d, "raw-footage/a.mkv")).toBe(true);
  });

  it.each([
    "export",
    "publish",
    "storage-move",
    "storage-delete",
    "transcribe-footage",
  ])("refuses while a %s Job is live", async (kind) => {
    await seedJob(kind, "queued");
    put(d, "raw-footage/a.mkv");

    const failure = failureOf(await trashExit());

    expect(failure).toMatchObject({ reason: "storage-job-running" });
    expect(exists(d, "raw-footage/a.mkv")).toBe(true);
  });

  it("does not refuse itself: the delete Job running it", async () => {
    const jobId = await seedJob("storage-delete", "running");
    put(d, "raw-footage/a.mkv");

    const result = await trash({ selfJobId: jobId });

    expect(trashDoneFiles(result)).toBe(1);
  });

  it("a dry run moves nothing and says what would go", async () => {
    put(d, "raw-footage/a.mkv");
    const result = await trash({ dryRun: true });
    expect(trashDoneFiles(result)).toBe(1);
    expect(exists(d, "raw-footage/a.mkv")).toBe(true);
    expect(exists(d, TRASH_FOLDER)).toBe(false);
  });
});

describe("restore, empty and expiry", () => {
  it("restores a trashed file to where it was, on its own root", async () => {
    put(e, "raw-footage/take/a.mkv");
    await trash();
    expect(exists(e, "raw-footage/take/a.mkv")).toBe(false);

    const [entry] = await Effect.runPromise(listStorageTrash({ roots }));
    expect(entry).toMatchObject({
      location: e,
      path: "raw-footage/take/a.mkv",
      trashedAt: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + 14 * DAY).toISOString(),
    });

    const result = await Effect.runPromise(
      restoreTrashedFootage({ db: db(), roots, files: [entry!] })
    );

    expect(trashDoneFiles(result)).toBe(1);
    expect(
      fs.readFileSync(path.join(e, "raw-footage/take/a.mkv"), "utf8")
    ).toBe("raw-footage/take/a.mkv");
    expect(trashed(e)).toEqual([]);
  });

  it("never overwrites: a restore whose place is taken stays in the trash", async () => {
    put(d, "raw-footage/a.mkv");
    await trash();
    const [entry] = await Effect.runPromise(listStorageTrash({ roots }));
    put(e, "raw-footage/a.mkv");

    const result = await Effect.runPromise(
      restoreTrashedFootage({ db: db(), roots, files: [entry!] })
    );

    expect(trashDoneFiles(result)).toBe(0);
    expect(result.left).toHaveLength(1);
    expect(trashed(d)).toEqual(["raw-footage/a.mkv"]);
  });

  it("refuses to restore a path outside the trash", async () => {
    put(d, "finished-videos/x.mp4");
    const result = await Effect.runPromise(
      restoreTrashedFootage({
        db: db(),
        roots,
        files: [
          {
            location: d,
            batch: "20261013T120000Z-job1",
            path: "raw-footage/../../finished-videos/x.mp4",
          },
          { location: d, batch: "../..", path: "raw-footage/x.mkv" },
        ],
      })
    );
    expect(result.left).toHaveLength(2);
    expect(exists(d, "finished-videos/x.mp4")).toBe(true);
  });

  it("deletes for good only batches over 14 days old; Empty trash deletes all", async () => {
    put(d, "raw-footage/old.mkv");
    await trash({ now: new Date(NOW.getTime() - 15 * DAY), batchId: "old" });
    put(d, "raw-footage/new.mkv");
    await trash({ batchId: "new" });
    // Something in the trash folder CVM didn't make is never touched.
    put(d, `${TRASH_FOLDER}/not-ours/keep.mkv`);

    expect(await Effect.runPromise(trashHasExpired({ roots, now: NOW }))).toBe(
      true
    );
    const expired = await Effect.runPromise(
      emptyStorageTrash({ db: db(), roots, now: NOW, olderThanRetention: true })
    );
    expect(trashDoneFiles(expired)).toBe(1);
    expect(trashed(d).sort()).toEqual(["keep.mkv", "raw-footage/new.mkv"]);
    expect(await Effect.runPromise(trashHasExpired({ roots, now: NOW }))).toBe(
      false
    );

    const emptied = await Effect.runPromise(
      emptyStorageTrash({ db: db(), roots, now: NOW })
    );
    expect(trashDoneFiles(emptied)).toBe(1);
    expect(tree(path.join(d, TRASH_FOLDER))).toEqual(["not-ours/keep.mkv"]);
  });

  it("never follows a link inside the trash when emptying it", async () => {
    put(d, "raw-footage/a.mkv");
    await trash();
    const [entry] = await Effect.runPromise(listStorageTrash({ roots }));
    const target = put(outside, "precious.mkv");
    fs.symlinkSync(
      target,
      path.join(d, TRASH_FOLDER, entry!.batch, "raw-footage/link.mkv")
    );

    const result = await Effect.runPromise(
      emptyStorageTrash({ db: db(), roots, now: NOW })
    );

    expect(fs.existsSync(target)).toBe(true);
    expect(trashDoneFiles(result)).toBe(1);
    expect(result.left).toEqual([
      expect.objectContaining({ path: "raw-footage/link.mkv" }),
    ]);
  });
});
