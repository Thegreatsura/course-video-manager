import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { MOVE_PARTIAL_SUFFIX } from "../move";
import {
  realStorageOriginalsDisk,
  type StorageOriginalsDisk,
} from "../originals";
import { findStoragePathSync } from "../server";
import {
  base,
  bytes,
  d,
  deleteOriginals,
  e,
  exportNameOf,
  failureOf,
  put,
  read,
  roots,
  seedMovedCourse,
  seedVideo,
  sha,
  testDb,
  tree,
  valueOf,
} from "./originals-test-harness";

const COURSE_FILES_ON_D = [
  "raw-footage/sub/take-2.mkv",
  "raw-footage/take-1.mkv",
  "raw-footage/take-1.mkv.transcript.json",
];

describe("deleteStorageOriginals", () => {
  it("deletes only the bucket's files with a verified copy on another root; Unused Footage's only copy stays", async () => {
    const { bucketId, exportName } = await seedMovedCourse();
    const eBefore = tree(e).map((f) => [f, sha(read(e, f))]);

    const result = valueOf(await deleteOriginals({ bucketId }));
    expect(result.deleted).toEqual({
      files: 5,
      bytes: 5000 + 2 + 3000 + 4000 + 6,
    });
    expect(result.kept).toEqual({ files: 0, bytes: 0 });
    expect(result.left).toEqual([]);

    // Only the other bucket's file (its only copy) is left on D:.
    expect(tree(d)).toEqual(["raw-footage/unused.mkv"]);
    // E: is exactly what it was: every copy intact.
    expect(tree(e).map((f) => [f, sha(read(e, f))])).toEqual(eBefore);
    expect(tree(e)).toEqual([
      `finished-videos/${exportName}`,
      `finished-videos/${exportName}.sha256`,
      ...COURSE_FILES_ON_D,
    ]);
  });

  it("after deleting originals the files resolve from the other root, and no row or Export Hash changes", async () => {
    const { bucketId, videoId, exportName } = await seedMovedCourse();
    const rowsBefore = await testDb.select().from(schema.clips);
    const exportBefore = await exportNameOf(videoId);

    valueOf(await deleteOriginals({ bucketId }));

    expect(await testDb.select().from(schema.clips)).toEqual(rowsBefore);
    expect(await exportNameOf(videoId)).toBe(exportBefore);
    expect(exportBefore).toBe(exportName);
    for (const stored of [
      path.join(d, "raw-footage/take-1.mkv"),
      "raw-footage/sub/take-2.mkv",
      `finished-videos/${exportName}`,
    ]) {
      const found = findStoragePathSync(stored, roots);
      expect(found?.startsWith(`${e}${path.sep}`)).toBe(true);
    }
  });

  it("can never delete the last copy: once D:'s originals are gone, deleting E:'s deletes nothing", async () => {
    const { bucketId } = await seedMovedCourse();
    valueOf(await deleteOriginals({ bucketId }));
    const eBefore = tree(e);

    const result = valueOf(await deleteOriginals({ bucketId, from: e }));
    expect(result.deleted).toEqual({ files: 0, bytes: 0 });
    expect(result.kept.files).toBe(5);
    expect(tree(e)).toEqual(eBefore);

    // Unused Footage, never moved, is only on D:: kept too.
    const unused = valueOf(
      await deleteOriginals({ bucketId: "unused-footage" })
    );
    expect(unused.deleted.files).toBe(0);
    expect(unused.kept.files).toBe(1);
    expect(fs.existsSync(path.join(d, "raw-footage/unused.mkv"))).toBe(true);
  });

  it("a size mismatch keeps the original", async () => {
    const { bucketId } = await seedMovedCourse();
    // E:'s copy is cut short.
    fs.truncateSync(path.join(e, "raw-footage/take-1.mkv"), 4000);

    const dry = valueOf(await deleteOriginals({ bucketId, dryRun: true }));
    expect(dry.deleted.files).toBe(4);
    const result = valueOf(await deleteOriginals({ bucketId }));
    expect(result.deleted.files).toBe(4);
    expect(result.left).toEqual([
      {
        path: "raw-footage/take-1.mkv",
        message: expect.stringMatching(/4000 bytes, not 5000/),
      },
    ]);
    expect(sha(read(d, "raw-footage/take-1.mkv"))).toBe(sha(bytes(5000, 1)));
  });

  it("a checksum mismatch (same size) keeps the original, though the dry run counted it", async () => {
    const { bucketId } = await seedMovedCourse();
    // E:'s copy rots: same size, one byte different.
    const bad = Buffer.from(bytes(3000, 2));
    bad[1500] = (bad[1500]! + 1) % 256;
    fs.writeFileSync(path.join(e, "raw-footage/sub/take-2.mkv"), bad);

    // The dry run reads no contents: it counts it, to be checked.
    const dry = valueOf(await deleteOriginals({ bucketId, dryRun: true }));
    expect(dry.deleted.files).toBe(5);
    expect(tree(d)).toContain("raw-footage/sub/take-2.mkv");

    const result = valueOf(await deleteOriginals({ bucketId }));
    expect(result.deleted.files).toBe(4);
    expect(result.left).toEqual([
      {
        path: "raw-footage/sub/take-2.mkv",
        message: expect.stringMatching(/checksum mismatch/),
      },
    ]);
    expect(sha(read(d, "raw-footage/sub/take-2.mkv"))).toBe(
      sha(bytes(3000, 2))
    );
  });

  it("never trusts a stored checksum: a wrong `.sha256` beside an export changes nothing, the bytes decide", async () => {
    const { bucketId, exportName } = await seedMovedCourse();
    // Both companions say the same (wrong) thing; the export itself differs.
    const bad = Buffer.from(bytes(4000, 4));
    bad[0] = (bad[0]! + 1) % 256;
    fs.writeFileSync(path.join(e, `finished-videos/${exportName}`), bad);

    const result = valueOf(await deleteOriginals({ bucketId }));
    expect(result.left.map((l) => l.path)).toEqual([
      `finished-videos/${exportName}`,
    ]);
    expect(tree(d)).toContain(`finished-videos/${exportName}`);
  });

  it("a file Windows holds open is reported, and the rest still go", async () => {
    const { bucketId } = await seedMovedCourse();
    const disk: StorageOriginalsDisk = {
      unlink: async (file) => {
        if (file.endsWith("take-1.mkv")) {
          throw Object.assign(new Error(`EBUSY: resource busy, ${file}`), {
            code: "EBUSY",
          });
        }
        return realStorageOriginalsDisk.unlink(file);
      },
    };
    const result = valueOf(await deleteOriginals({ bucketId, disk }));
    expect(result.deleted.files).toBe(4);
    expect(result.left).toEqual([
      {
        path: "raw-footage/take-1.mkv",
        message: expect.stringMatching(/in use or locked \(EBUSY\)/),
      },
    ]);
    expect(tree(d)).toEqual([
      "raw-footage/take-1.mkv",
      "raw-footage/unused.mkv",
    ]);
  });

  it("a file the filesystem won't delete (a read-only folder) is reported, and the rest still go", async () => {
    const { bucketId } = await seedMovedCourse();
    fs.chmodSync(path.join(d, "raw-footage/sub"), 0o555);
    const result = valueOf(await deleteOriginals({ bucketId }));
    expect(result.deleted.files).toBe(4);
    expect(result.left.map((l) => l.path)).toEqual([
      "raw-footage/sub/take-2.mkv",
    ]);
    expect(tree(d)).toContain("raw-footage/sub/take-2.mkv");
  });

  it("never follows a link: a symlinked copy is not a copy, and a symlinked original is never deleted", async () => {
    const { bucketId } = await seedMovedCourse();
    // E:'s "copy" of take-1 is a link to D:'s original.
    fs.rmSync(path.join(e, "raw-footage/take-1.mkv"));
    fs.symlinkSync(
      path.join(d, "raw-footage/take-1.mkv"),
      path.join(e, "raw-footage/take-1.mkv")
    );
    // On D:, take-2 is a link to a file outside every root.
    const outside = put(base, "elsewhere/take-2.mkv", bytes(3000, 2));
    fs.rmSync(path.join(d, "raw-footage/sub/take-2.mkv"));
    fs.symlinkSync(outside, path.join(d, "raw-footage/sub/take-2.mkv"));

    const result = valueOf(await deleteOriginals({ bucketId }));
    expect(result.left.map((l) => l.path).sort()).toEqual([
      "raw-footage/sub/take-2.mkv",
      "raw-footage/take-1.mkv",
    ]);
    expect(sha(read(d, "raw-footage/take-1.mkv"))).toBe(sha(bytes(5000, 1)));
    expect(
      fs.lstatSync(path.join(d, "raw-footage/sub/take-2.mkv")).isSymbolicLink()
    ).toBe(true);
    expect(sha(fs.readFileSync(outside))).toBe(sha(bytes(3000, 2)));
  });

  it("a hard link is the same file, not a copy: kept", async () => {
    const { bucketId } = await seedMovedCourse();
    fs.rmSync(path.join(e, "raw-footage/take-1.mkv"));
    fs.linkSync(
      path.join(d, "raw-footage/take-1.mkv"),
      path.join(e, "raw-footage/take-1.mkv")
    );
    const result = valueOf(await deleteOriginals({ bucketId }));
    expect(result.left).toEqual([
      {
        path: "raw-footage/take-1.mkv",
        message: expect.stringMatching(/may be this very file/),
      },
    ]);
    expect(fs.existsSync(path.join(d, "raw-footage/take-1.mkv"))).toBe(true);
  });

  it("refuses roots that are the same place on disk (a link, a nested root), deleting nothing", async () => {
    const { bucketId } = await seedMovedCourse();
    const before = tree(d);
    // The same root under a second name.
    const alias = path.join(base, "d-again");
    fs.symlinkSync(d, alias);
    const same = failureOf(
      await deleteOriginals({ bucketId, roots: [d, alias] })
    );
    expect(same.reason).toBe("same-root");
    // A root inside the other.
    fs.mkdirSync(path.join(d, "inner"));
    const nested = failureOf(
      await deleteOriginals({ bucketId, roots: [d, path.join(d, "inner")] })
    );
    expect(nested.reason).toBe("same-root");
    // The folder itself linked from another root.
    const f = path.join(base, "f");
    fs.mkdirSync(f);
    fs.symlinkSync(path.join(d, "raw-footage"), path.join(f, "raw-footage"));
    const linked = failureOf(
      await deleteOriginals({ bucketId, roots: [d, f] })
    );
    expect(linked.reason).toBe("same-root");
    expect(tree(d)).toEqual(before);
  });

  it("a partial copy left by a move is not a copy", async () => {
    const { bucketId } = await seedMovedCourse();
    fs.renameSync(
      path.join(e, "raw-footage/take-1.mkv"),
      path.join(e, `raw-footage/take-1.mkv${MOVE_PARTIAL_SUFFIX}`)
    );
    const result = valueOf(await deleteOriginals({ bucketId }));
    expect(result.kept.files).toBe(1);
    expect(fs.existsSync(path.join(d, "raw-footage/take-1.mkv"))).toBe(true);
  });

  it("the dry run counts files and bytes and deletes nothing", async () => {
    const { bucketId } = await seedMovedCourse();
    put(d, "raw-footage/sub/take-3.mkv", bytes(10, 5)); // not on E: yet
    await seedVideo((await testDb.select().from(schema.lessons))[0]!.id, [
      "raw-footage/sub/take-3.mkv",
    ]);
    const before = tree(d);
    const result = valueOf(await deleteOriginals({ bucketId, dryRun: true }));
    expect(result.dryRun).toBe(true);
    expect(result.deleted).toEqual({ files: 5, bytes: 12008 });
    expect(result.kept).toEqual({ files: 1, bytes: 10 });
    expect(tree(d)).toEqual(before);
  });

  it("deletes nothing outside a verify run's own folder", async () => {
    const { bucketId } = await seedMovedCourse();
    const before = tree(d);
    const result = valueOf(await deleteOriginals({ bucketId, confineTo: e }));
    expect(result.deleted.files).toBe(0);
    expect(result.left.length).toBe(5);
    expect(tree(d)).toEqual(before);
  });

  it("refuses buckets that have no originals, a root that isn't one, and an Offline drive", async () => {
    await seedMovedCourse();
    expect(
      failureOf(await deleteOriginals({ bucketId: "overlay-render-cache" }))
        .reason
    ).toBe("not-deletable");
    expect(failureOf(await deleteOriginals({ bucketId: "nope" })).reason).toBe(
      "not-deletable"
    );
    expect(
      failureOf(
        await deleteOriginals({
          bucketId: "unused-footage",
          from: path.join(base, "x"),
        })
      ).reason
    ).toBe("unknown-root");
    expect(
      failureOf(
        await deleteOriginals({ bucketId: "unused-footage", roots: [d] })
      ).reason
    ).toBe("unknown-root");
    const gone = path.join(base, "gone");
    expect(
      failureOf(
        await deleteOriginals({
          bucketId: "unused-footage",
          from: gone,
          roots: [gone, d],
        })
      ).reason
    ).toBe("offline");
  });
});
