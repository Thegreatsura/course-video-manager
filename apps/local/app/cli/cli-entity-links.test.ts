import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import { entityDeepLink } from "@/features/entity-links/entity-deep-link";
import {
  buildReadLayer,
  makeReadRun,
  ndjson,
  seedRead,
  type ReadSeed,
  type RunResult,
} from "./cli-read-test-harness";

// ===========================================================================
// Any CVM link works wherever an id is expected (./entity-id.ts). One check
// per argument shape — positional, repeated, flag, scoped search — since they
// all go through the same two builders.
// ===========================================================================

const DEPLOYED = "https://cvm.example.com";

let testDb: TestDb;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;
let s: ReadSeed;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  run = makeReadRun(buildReadLayer(testDb));
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  s = await seedRead(testDb);
});

const videoLink = () =>
  entityDeepLink({ type: "video", id: s.lessonVideoId }, DEPLOYED);

describe("entity links as cvm arguments", () => {
  it("resolves a Video link as `video get`'s <id>", async () => {
    const { stdout, exitCode } = await run(["video", "get", videoLink()]);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).id).toBe(s.lessonVideoId);
  });

  it("mixes links and bare ids in a multi-id get", async () => {
    const clipLink = entityDeepLink(
      { type: "clip", id: s.clip1Id, videoId: s.lessonVideoId },
      "http://localhost:5173"
    );
    const { stdout, exitCode } = await run([
      "clip",
      "get",
      clipLink,
      s.clip2Id,
    ]);
    expect(exitCode).toBe(0);
    expect((ndjson(stdout) as { id: string }[]).map((r) => r.id)).toEqual([
      s.clip1Id,
      s.clip2Id,
    ]);
  });

  it("resolves a link passed to an id-valued flag", async () => {
    const { stdout, exitCode } = await run([
      "clip",
      "list",
      "--video",
      videoLink(),
    ]);
    expect(exitCode).toBe(0);
    expect(ndjson(stdout).length).toBeGreaterThan(0);
  });

  it("reads the legacy deep-link string", async () => {
    const legacy = `course:${s.courseAId}/section:${s.draftSectionId}/lesson:${s.lessonId}`;
    const { stdout, exitCode } = await run(["lesson", "get", legacy]);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).id).toBe(s.lessonId);
  });

  it("resolves a Lesson's #fragment link in scoped search", async () => {
    const link = entityDeepLink(
      {
        type: "lesson",
        id: s.lessonId,
        courseId: s.courseAId,
        sectionId: s.draftSectionId,
      },
      DEPLOYED
    );
    const { exitCode, stderr } = await run(["lesson", "search", link, "intro"]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  it("refuses a link for the wrong entity, naming both types", async () => {
    const pitchLink = entityDeepLink(
      { type: "pitch", id: s.pitchActiveId },
      DEPLOYED
    );
    const { stdout, stderr, exitCode } = await run(["video", "get", pitchLink]);
    expect(exitCode).toBe(3);
    expect(stdout).toBe("");
    const err = JSON.parse(stderr);
    expect(err._tag).toBe("ParseError");
    expect(err.message).toContain(
      "that's a Pitch link, this command wants a Video"
    );
  });

  it("names the flag when a flag gets the wrong link", async () => {
    const { stderr, exitCode } = await run([
      "clip",
      "list",
      "--video",
      entityDeepLink({ type: "course", id: s.courseAId }, DEPLOYED),
    ]);
    expect(exitCode).toBe(3);
    expect(JSON.parse(stderr).message).toContain(
      "--video: that's a Course link, this command wants a Video"
    );
  });
});
