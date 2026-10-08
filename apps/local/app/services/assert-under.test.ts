import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Effect, Either } from "effect";
import {
  assertUnder,
  assertUnderEffect,
  PathOutsideBaseDirError,
} from "./assert-under";

let root: string;
let base: string;
let outside: string;

beforeEach(() => {
  root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "assert-under-"))
  );
  base = path.join(root, "scratch", "video-files");
  outside = path.join(root, "matts-real-files");
  fs.mkdirSync(base, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, "thumbnail.png"), "real");
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const refuses = (baseDir: string, target: string) =>
  expect(() => assertUnder(baseDir, target)).toThrow(PathOutsideBaseDirError);

describe("assertUnder", () => {
  it("returns the resolved path for a file inside the base", () => {
    const target = path.join(base, "lineage-1", "thumbnail-1.png");
    expect(assertUnder(base, target)).toBe(target);
  });

  it("accepts a path relative to the base, resolving it against the base", () => {
    expect(assertUnder(base, "lineage-1/a.png")).toBe(
      path.join(base, "lineage-1", "a.png")
    );
  });

  it("accepts a not-yet-created nested path", () => {
    const target = path.join(base, "new-dir", "deeper", "file.png");
    expect(assertUnder(base, target)).toBe(target);
  });

  it("accepts a filename that merely starts with two dots", () => {
    const target = path.join(base, "..hidden.png");
    expect(assertUnder(base, target)).toBe(target);
  });

  it("refuses an absolute path outside the base (a DB row naming Matt's real file)", () => {
    refuses(base, path.join(outside, "thumbnail.png"));
  });

  it("refuses a sibling folder that shares the base's prefix", () => {
    refuses(base, `${base}-evil/thumbnail.png`);
  });

  it("refuses `..` escapes, absolute and relative", () => {
    refuses(
      base,
      path.join(base, "..", "..", "matts-real-files", "thumbnail.png")
    );
    refuses(base, `${base}/lineage/../../../matts-real-files/thumbnail.png`);
    refuses(base, "../video-files-elsewhere/x.png");
    refuses(base, "..");
  });

  it("refuses the base folder itself", () => {
    refuses(base, base);
    refuses(base, `${base}/`);
    refuses(base, `${base}/lineage/..`);
  });

  it("refuses empty paths and an unconfigured base", () => {
    refuses(base, "");
    refuses("", path.join(base, "x.png"));
    refuses("   ", path.join(base, "x.png"));
  });

  it("refuses a symlinked file inside the base that points outside it", () => {
    const link = path.join(base, "thumbnail.png");
    fs.symlinkSync(path.join(outside, "thumbnail.png"), link);
    refuses(base, link);
  });

  it("refuses a path through a symlinked directory that points outside", () => {
    fs.symlinkSync(outside, path.join(base, "lineage-1"));
    refuses(base, path.join(base, "lineage-1", "thumbnail.png"));
    refuses(base, path.join(base, "lineage-1", "not-yet-there.png"));
  });

  it("refuses a dangling symlink, whose write would land wherever it points", () => {
    const link = path.join(base, "dangling.png");
    fs.symlinkSync(path.join(outside, "does-not-exist.png"), link);
    refuses(base, link);
  });

  it("accepts a symlink that stays inside the base", () => {
    fs.mkdirSync(path.join(base, "real-dir"));
    fs.symlinkSync(path.join(base, "real-dir"), path.join(base, "alias"));
    const target = path.join(base, "alias", "file.png");
    expect(assertUnder(base, target)).toBe(target);
  });

  it("accepts paths under a base that is itself reached through a symlink", () => {
    const linkedBase = path.join(root, "linked-base");
    fs.symlinkSync(base, linkedBase);
    const target = path.join(linkedBase, "lineage", "file.png");
    expect(assertUnder(linkedBase, target)).toBe(target);
    refuses(linkedBase, path.join(outside, "thumbnail.png"));
  });

  it("works for a base that does not exist yet", () => {
    const freshBase = path.join(root, "not-created", "finished-videos");
    const target = path.join(freshBase, "course-abc.mp4");
    expect(assertUnder(freshBase, target)).toBe(target);
    refuses(freshBase, path.join(outside, "thumbnail.png"));
  });
});

describe("assertUnderEffect", () => {
  it("succeeds with the resolved path inside the base", () => {
    const target = path.join(base, "a.png");
    expect(Effect.runSync(assertUnderEffect(base, target))).toBe(target);
  });

  it("fails with a typed PathOutsideBaseDirError outside it", () => {
    const result = Effect.runSync(
      Effect.either(
        assertUnderEffect(base, path.join(outside, "thumbnail.png"))
      )
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("PathOutsideBaseDirError");
      expect(result.left.baseDir).toBe(base);
    }
  });
});
