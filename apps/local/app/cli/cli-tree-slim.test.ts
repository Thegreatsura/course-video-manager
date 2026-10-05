import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import {
  buildWriteLayer,
  makeRun,
  type RunResult,
} from "./cli-write-test-harness";
import {
  seedIntegration,
  type IntegrationSeed,
} from "./cli-integration-test-harness";

/**
 * `tree` is a structure skeleton. A retro found `pitch tree` missing and the
 * fallback, `pitch get`, at ~86KB for one pitch with a single filmed Video —
 * almost all of it Clip rows and copy. These tests pin the slim default and
 * the `--full` escape hatch for the two trees that carried content.
 */

let testDb: TestDb;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  run = makeRun(buildWriteLayer(testDb));
});

let s: IntegrationSeed;
beforeEach(async () => {
  await truncateAllTables(testDb);
  s = await seedIntegration(testDb);
});

describe("video tree", () => {
  it("is slim by default: clip nodes carry no text, the video carries counts", async () => {
    const { stdout, exitCode } = await run(["video", "tree", s.lessonVideoId]);
    expect(exitCode).toBe(0);
    const tree = JSON.parse(stdout);
    expect(tree).toMatchObject({
      id: s.lessonVideoId,
      kind: "video",
      clipCount: 2,
      chapterCount: 1,
    });
    expect(tree.children).toEqual([
      { id: s.clip1Id, kind: "clip" },
      { id: expect.any(String), kind: "chapter", name: "Chapter One" },
      { id: s.clip2Id, kind: "clip" },
    ]);
    expect(stdout).not.toContain("hello");
    expect(stdout).not.toContain("world");
  });

  it("--full keeps the old shape: clip name = clip text, no counts", async () => {
    const { stdout, exitCode } = await run([
      "video",
      "tree",
      "--full",
      s.lessonVideoId,
    ]);
    expect(exitCode).toBe(0);
    const tree = JSON.parse(stdout);
    expect(tree).not.toHaveProperty("clipCount");
    expect(tree.children.map((c: { name: string }) => c.name)).toEqual([
      "hello",
      "Chapter One",
      "world",
    ]);
  });
});

describe("pitch tree", () => {
  beforeEach(async () => {
    // Bind the seed's standalone Video to the active pitch and give it a
    // script and a clip, so the slim tree has content to leave out.
    await testDb
      .update(schema.videos)
      .set({ pitchId: s.pitchActiveId, script: "SCRIPT-BODY-TEXT" })
      .where(eq(schema.videos.id, s.standaloneActiveId));
    await testDb.insert(schema.clips).values({
      videoId: s.standaloneActiveId,
      videoFilename: "p.mp4",
      sourceStartTime: 0,
      sourceEndTime: 5,
      order: "0001",
      text: "CLIP-TEXT",
    });
    await testDb
      .update(schema.pitches)
      .set({ tweet: "TWEET-COPY" })
      .where(eq(schema.pitches.id, s.pitchActiveId));
  });

  it("is slim by default: identity, state and counts only", async () => {
    const { stdout, exitCode } = await run(["pitch", "tree", s.pitchActiveId]);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      id: s.pitchActiveId,
      kind: "pitch",
      name: "Active pitch",
      state: "idle",
      priority: expect.any(Number),
      effort: expect.any(Number),
      videoCount: 1,
      children: [
        {
          id: s.standaloneActiveId,
          kind: "video",
          name: "standalone-active.mp4",
          format: "landscape",
          clipCount: 1,
          beatCount: 0,
          children: [],
        },
      ],
    });
    for (const content of ["SCRIPT-BODY-TEXT", "CLIP-TEXT", "TWEET-COPY"]) {
      expect(stdout).not.toContain(content);
    }
  });

  it("--full prints the same deep record as 'pitch get'", async () => {
    const full = await run(["pitch", "tree", "--full", s.pitchActiveId]);
    const get = await run(["pitch", "get", s.pitchActiveId]);
    expect(full.exitCode).toBe(0);
    expect(JSON.parse(full.stdout)).toEqual(JSON.parse(get.stdout));
    expect(full.stdout).toContain("CLIP-TEXT");
  });

  it("an archived pitch id is a not-found (exit 2)", async () => {
    const { stdout, exitCode } = await run([
      "pitch",
      "tree",
      s.pitchArchivedId,
    ]);
    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
  });
});
