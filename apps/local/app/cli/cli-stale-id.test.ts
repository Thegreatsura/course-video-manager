import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import * as schema from "@/db/schema";
import {
  buildReadLayer,
  makeReadRun,
  type RunResult,
} from "./cli-read-test-harness";

// ===========================================================================
// An id from an OLDER Course Version names the Draft's equivalent.
//
// Submit copies the Draft into a fresh Draft with fresh ids, and a Discarded
// Pending Version is deleted with its ids. An agent holding an id from before
// that got a bare NotFoundError and took the Section for deleted. The only
// trace of the old id is the copy's `previousVersionSectionId` /
// `previousVersionLessonId`, so that is what these tests seed.
// ===========================================================================

let testDb: TestDb;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  run = makeReadRun(buildReadLayer(testDb));
});

let seed: {
  draftSectionId: string;
  draftLessonId: string;
  lineageDraftSectionId: string;
};

beforeEach(async () => {
  await truncateAllTables(testDb);

  const [course] = await testDb
    .insert(schema.courses)
    .values({ name: "Alpha" })
    .returning();
  const [published] = await testDb
    .insert(schema.courseVersions)
    .values({
      repoId: course!.id,
      name: "v1",
      commitState: "published",
      createdAt: new Date("2020-01-01T00:00:00Z"),
    })
    .returning();
  const [draft] = await testDb
    .insert(schema.courseVersions)
    .values({
      repoId: course!.id,
      name: "",
      commitState: "draft",
      createdAt: new Date("2024-01-01T00:00:00Z"),
    })
    .returning();

  // The Draft's copy of a Section whose previous version was Discarded: its
  // previous-version link points at a row that no longer exists.
  const [draftSection] = await testDb
    .insert(schema.sections)
    .values({
      repoVersionId: draft!.id,
      previousVersionSectionId: "section-from-discarded-version",
      title: "intro",
      order: 1,
    })
    .returning();
  const [draftLesson] = await testDb
    .insert(schema.lessons)
    .values({
      sectionId: draftSection!.id,
      previousVersionLessonId: "lesson-from-discarded-version",
      title: "welcome",
      order: 1,
    })
    .returning();

  // A broken chain: the old id lives on in the PUBLISHED version, but the link
  // from there to the Draft went through a deleted version. lineageId — which
  // every copy carries unchanged — still finds the Draft's copy.
  const [publishedSection] = await testDb
    .insert(schema.sections)
    .values({
      repoVersionId: published!.id,
      previousVersionSectionId: "section-from-before-v1",
      title: "basics",
      order: 1,
    })
    .returning();
  const [lineageDraftSection] = await testDb
    .insert(schema.sections)
    .values({
      repoVersionId: draft!.id,
      previousVersionSectionId: "section-in-deleted-pending",
      lineageId: publishedSection!.lineageId,
      title: "basics",
      order: 2,
    })
    .returning();

  seed = {
    draftSectionId: draftSection!.id,
    draftLessonId: draftLesson!.id,
    lineageDraftSectionId: lineageDraftSection!.id,
  };
});

describe("ids from an older Course Version", () => {
  it("section get names the Draft's equivalent section id", async () => {
    const res = await run(["section", "get", "section-from-discarded-version"]);

    expect(res.exitCode).toBe(2);
    expect(res.stdout).toBe("");
    const err = JSON.parse(res.stderr);
    expect(err).toMatchObject({
      _tag: "NotFoundError",
      entity: "section",
      id: "section-from-discarded-version",
      currentId: seed.draftSectionId,
    });
    expect(err.message).toMatch(/older Course Version/);
    expect(err.message).toContain(seed.draftSectionId);
  });

  it("follows lineage when the forward chain breaks before the Draft", async () => {
    const res = await run(["section", "get", "section-from-before-v1"]);

    expect(res.exitCode).toBe(2);
    expect(JSON.parse(res.stderr)).toMatchObject({
      currentId: seed.lineageDraftSectionId,
    });
  });

  it("lesson get names the Draft's equivalent lesson id", async () => {
    const res = await run(["lesson", "get", "lesson-from-discarded-version"]);

    expect(res.exitCode).toBe(2);
    expect(JSON.parse(res.stderr)).toMatchObject({
      _tag: "NotFoundError",
      entity: "lesson",
      currentId: seed.draftLessonId,
    });
  });

  it("section lint and section tree carry the same hint", async () => {
    for (const verb of ["lint", "tree"]) {
      const res = await run([
        "section",
        verb,
        "section-from-discarded-version",
      ]);
      expect(res.exitCode).toBe(2);
      expect(JSON.parse(res.stderr)).toMatchObject({
        currentId: seed.draftSectionId,
      });
    }
  });

  it("multi-id get maps each stale id to its Draft id", async () => {
    const res = await run([
      "section",
      "get",
      seed.draftSectionId,
      "section-from-discarded-version",
      "never-existed",
    ]);

    expect(res.exitCode).toBe(2);
    expect(JSON.parse(res.stderr)).toMatchObject({
      ids: ["section-from-discarded-version", "never-existed"],
      currentIds: {
        "section-from-discarded-version": seed.draftSectionId,
      },
    });
  });

  it("an id nothing descends from stays a bare NotFoundError", async () => {
    const res = await run(["section", "get", "never-existed"]);

    expect(res.exitCode).toBe(2);
    const err = JSON.parse(res.stderr);
    expect(err).toEqual({
      _tag: "NotFoundError",
      entity: "section",
      id: "never-existed",
    });
  });
});
