import { describe, expect, it } from "vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect } from "effect";
import {
  makeAutofillTestLayer,
  readChapters,
  readVideo,
  seedCourseVersion,
} from "@/test-utils/autofill-service-test-setup";
import { createFakeTextGeneration } from "@/test-utils/fake-text-generation";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import type { JobContext } from "../job-kind";
import { UPLOAD_MANAGER_POLICIES } from "../retry-policy";
import { autofillJobKind } from "./autofill";

let testDb: TestDb;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const recordingContext = () => {
  const events: { type: string; data: Record<string, unknown> }[] = [];
  const ctx: JobContext = {
    jobId: "job-1",
    attempt: 1,
    maxAttempts: 1,
    emit: (type, data) =>
      Effect.sync(() => {
        events.push({ type, data });
      }),
  };
  return { ctx, events };
};

/** Two candidate Videos; the model refuses the one whose Body says "refuse". */
const seedTwoVideos = (commitState?: "draft" | "published") =>
  seedCourseVersion(
    testDb,
    [
      {
        path: "01-fine",
        videos: [
          { body: "fine body", description: null, clips: [{ text: "a" }] },
        ],
      },
      {
        path: "02-refused",
        videos: [
          { body: "refuse body", description: null, clips: [{ text: "b" }] },
        ],
      },
    ],
    { commitState }
  );

const runKind = (
  params: unknown,
  ctx: JobContext,
  fake = createFakeTextGeneration({
    descriptionOutcomes: {
      refuse: { kind: "fail", message: "the model said no" },
    },
  })
) =>
  Effect.runPromiseExit(
    autofillJobKind
      .runRaw(params, ctx)
      .pipe(Effect.provide(makeAutofillTestLayer(testDb, fake)))
  );

describe("the autofill Job kind", () => {
  it("keeps the Upload Manager's policy: 1 attempt, the default lane", () => {
    expect(autofillJobKind.maxAttempts).toBe(1);
    expect(autofillJobKind.lane).toBe("default");
    expect(UPLOAD_MANAGER_POLICIES.autofill).toEqual({
      lane: "default",
      maxAttempts: 1,
    });
  });

  it("writes what the service writes, and reports each Video as a Job Event", async () => {
    const seeded = await seedTwoVideos();
    const fine = seeded.videoIds["01-fine/Explainer"]!;
    const refused = seeded.videoIds["02-refused/Explainer"]!;
    const { ctx, events } = recordingContext();

    const exit = await runKind(
      {
        courseId: seeded.courseId,
        versionId: seeded.versionId,
        includeTodoLessons: true,
      },
      ctx
    );

    // One Video failing is not the Job failing: the run carries on.
    expect(exit._tag).toBe("Success");
    expect(events.slice(0, 3)).toEqual([
      { type: "stage", data: { stage: "selecting" } },
      {
        type: "videos",
        data: {
          videos: [
            { id: fine, title: expect.any(String) },
            { id: refused, title: expect.any(String) },
          ],
        },
      },
      { type: "stage", data: { stage: "writing" } },
    ]);
    expect(events.slice(3)).toEqual(
      expect.arrayContaining([
        {
          type: "video-succeeded",
          data: { videoId: fine, fields: ["description", "chapters"] },
        },
        {
          type: "video-failed",
          data: { videoId: refused, message: "the model said no" },
        },
      ])
    );
    expect(events).toHaveLength(5);

    const filled = await Effect.runPromise(readVideo(testDb, fine));
    expect(filled?.description).toBe("Autofilled description for fine body");
    const chapters = await Effect.runPromise(readChapters(testDb, fine));
    expect(chapters.map((c) => c.name)).toEqual(["Autofilled opening"]);
    // Nothing of the refused Video landed: its two fields are one commit.
    const untouched = await Effect.runPromise(readVideo(testDb, refused));
    expect(untouched?.description).toBeNull();
    expect(await Effect.runPromise(readChapters(testDb, refused))).toHaveLength(
      0
    );
  });

  it("fails the Job, in the route's words, when the Version is not a Draft", async () => {
    const seeded = await seedTwoVideos("published");
    const { ctx, events } = recordingContext();

    const exit = await runKind(
      {
        courseId: seeded.courseId,
        versionId: seeded.versionId,
        includeTodoLessons: true,
      },
      ctx
    );

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      expect(JSON.stringify(exit.cause)).toContain(
        "Only a Draft Version can be autofilled — reload the publish page"
      );
      expect(JSON.stringify(exit.cause)).toContain("AutofillRunError");
    }
    // It never got as far as choosing Videos.
    expect(events).toEqual([{ type: "stage", data: { stage: "selecting" } }]);
  });

  it("refuses params without the to-do setting, as the route did", async () => {
    const { ctx } = recordingContext();
    const exit = await runKind({ courseId: "c", versionId: "v" }, ctx);
    expect(exit._tag).toBe("Failure");
  });
});
