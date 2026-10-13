import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StorageRoots } from "@/packages/storage";
import { findClipsWithMissingFootage } from "./clip-source-files.server";

let base: string;
let d: string;
let e: string;
let roots: StorageRoots;

const put = (root: string, relative: string) => {
  const full = path.join(root, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, "footage");
};

const clip = (id: string, videoFilename: string) => ({
  id,
  videoFilename,
  sourceStartTime: 0,
  sourceEndTime: 1,
});

const missing = (clips: ReturnType<typeof clip>[]) =>
  Effect.runPromise(
    findClipsWithMissingFootage(clips, roots).pipe(
      Effect.provide(NodeContext.layer)
    )
  );

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "clip-footage-"));
  d = path.join(base, "d");
  e = path.join(base, "e");
  fs.mkdirSync(d);
  fs.mkdirSync(e);
  roots = [d, e];
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe("findClipsWithMissingFootage", () => {
  it("lists only the Clips whose Footage is on no root, naming the offline root", async () => {
    put(d, "raw-footage/on-d.mkv");
    put(e, "raw-footage/on-e.mkv");
    // E: is unplugged.
    fs.rmSync(e, { recursive: true });

    expect(
      await missing([
        clip("a", "raw-footage/on-d.mkv"),
        clip("b", "raw-footage/on-e.mkv"),
        clip("c", `${d}/raw-footage/on-d.mkv`),
      ])
    ).toEqual({
      b: {
        headline: `Footage not found (${e} offline?)`,
        path: "raw-footage/on-e.mkv",
      },
    });
  });

  it("finds Footage on the second root, and leaves every file alone", async () => {
    put(e, "raw-footage/on-e.mkv");

    expect(await missing([clip("a", "raw-footage/on-e.mkv")])).toEqual({});
    expect(fs.readFileSync(path.join(e, "raw-footage/on-e.mkv"), "utf8")).toBe(
      "footage"
    );
  });
});
