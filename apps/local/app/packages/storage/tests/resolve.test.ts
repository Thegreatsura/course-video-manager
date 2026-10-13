import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NodeContext } from "@effect/platform-node";
import { Effect, Either } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StorageRoots } from "../index";
import { findStoragePathSync, resolveStoragePath } from "../server";

let base: string;
let d: string;
let e: string;
let roots: StorageRoots;

const put = (root: string, relative: string, content = relative) => {
  const full = path.join(root, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
};

const resolve = (stored: string) =>
  Effect.runPromise(
    resolveStoragePath(stored, roots, "Footage").pipe(
      Effect.either,
      Effect.provide(NodeContext.layer)
    )
  );

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "storage-roots-"));
  d = path.join(base, "d");
  e = path.join(base, "e");
  fs.mkdirSync(d);
  fs.mkdirSync(e);
  roots = [d, e];
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe("resolveStoragePath", () => {
  it("reads from the first root when both have the file", async () => {
    const onD = put(d, "raw-footage/a.mkv");
    put(e, "raw-footage/a.mkv");
    expect(await resolve("raw-footage/a.mkv")).toEqual(Either.right(onD));
  });

  it("falls through to the second root when the first lacks the file", async () => {
    const onE = put(e, "raw-footage/a.mkv");
    expect(await resolve("raw-footage/a.mkv")).toEqual(Either.right(onE));
    expect(findStoragePathSync("raw-footage/a.mkv", roots)).toBe(onE);
  });

  it("resolves a legacy absolute path as its relative form, wherever the file now is", async () => {
    const onE = put(e, "raw-footage/a.mkv");
    expect(await resolve(path.join(d, "raw-footage/a.mkv"))).toEqual(
      Either.right(onE)
    );
  });

  it("uses a path under no root exactly as stored", async () => {
    expect(await resolve("/home/matt/Videos/s/mic.mkv")).toEqual(
      Either.right("/home/matt/Videos/s/mic.mkv")
    );
  });

  it("fails naming the offline root when the file is on no root", async () => {
    fs.rmSync(e, { recursive: true });
    const result = await resolve("raw-footage/a.mkv");
    if (Either.isRight(result)) throw new Error("expected not found");
    const error = result.left;
    expect(error).toMatchObject({
      _tag: "StorageFileNotFoundError",
      path: "raw-footage/a.mkv",
      offlineRoots: [e],
    });
    expect(error.message).toBe(
      `Footage not found (${e} offline?): raw-footage/a.mkv`
    );
    expect(findStoragePathSync("raw-footage/a.mkv", roots)).toBeNull();
  });
});

describe("an Offline root", () => {
  const notFound = async (stored: string) => {
    const result = await resolve(stored);
    if (Either.isRight(result)) throw new Error("expected not found");
    return result.left;
  };

  it("is named when it is a stale mount (there, but can't be listed)", async () => {
    fs.rmSync(e, { recursive: true });
    fs.writeFileSync(e, "stale");

    const error = await notFound("raw-footage/a.mkv");

    expect(error.offlineRoots).toEqual([e]);
    expect(error.message).toBe(
      `Footage not found (${e} offline?): raw-footage/a.mkv`
    );
  });

  it("names a WSL drive by its letter", async () => {
    roots = [d, "/mnt/zz-not-a-drive", "/mnt/y"] as unknown as StorageRoots;

    const error = await notFound("raw-footage/a.mkv");

    expect(error.message).toBe(
      "Footage not found (/mnt/zz-not-a-drive, Y: offline?): raw-footage/a.mkv"
    );
  });

  it("is not named when every root is online", async () => {
    const error = await notFound("raw-footage/a.mkv");

    expect(error.offlineRoots).toEqual([]);
    expect(error.message).toBe(
      "Footage not found on any Storage Root: raw-footage/a.mkv"
    );
  });
});
