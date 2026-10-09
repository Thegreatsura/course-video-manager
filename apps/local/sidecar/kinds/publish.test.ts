import { describe, expect, it } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { DrizzleService } from "@cvm/core/services/drizzle-service.server";
import {
  CoursePublishService,
  type PublishOptions,
} from "@/services/course-publish-service";
import {
  PublishCommitFailedError,
  PublishValidationError,
} from "@/services/course-publish-errors";
import type { EmitPublishDetailEvent } from "@/services/course-publish-export-events";
import { SidecarContextTest } from "@/services/sidecar-context";
import { NodeContext } from "@effect/platform-node";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";
import { VideoEditorLoggerService } from "@/services/video-editor-logger-service";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import type { JobContext } from "../job-kind";
import { publishJobKind } from "./publish";
import { PUBLISH_REFUSED_TAG } from "@/cli/commands/course-publish-wait";

let testDb: TestDb;
/** What each `publish` call was asked to do. */
let calls: PublishOptions[] = [];

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  calls = [];
});

const RESULT = {
  publishedVersionId: "version-1",
  newDraftVersionId: "version-2",
  lessonCounts: { ships: 3, placeholders: 0, withheld: 1 },
};

/** What the real `publish`'s type asks for; the fake touches none of it. */
const untouched = Layer.mergeAll(
  NodeContext.layer,
  Layer.succeed(VersionOperationsService, {} as VersionOperationsService),
  Layer.succeed(LinkAuthOperationsService, {} as LinkAuthOperationsService),
  Layer.succeed(VideoEditorLoggerService, {} as VideoEditorLoggerService)
);

/** A `publish` that reports as `script` says, then ends as `end` says. */
const fakePublish = (
  script: (
    emit: EmitPublishDetailEvent,
    stage: NonNullable<PublishOptions["onStageChange"]>
  ) => void,
  end: Effect.Effect<typeof RESULT, unknown> = Effect.succeed(RESULT)
) =>
  Layer.succeed(CoursePublishService, {
    publish: (options: PublishOptions) =>
      Effect.gen(function* () {
        calls.push(options);
        script(
          options.onDetailEvent ?? (() => {}),
          options.onStageChange ?? (() => {})
        );
        return yield* end;
      }),
  } as unknown as CoursePublishService);

const layer = (publish: ReturnType<typeof fakePublish>) =>
  Layer.mergeAll(
    publish,
    SidecarContextTest,
    untouched,
    JobOperationsService.Default.pipe(
      Layer.provide(Layer.succeed(DrizzleService, testDb as any))
    )
  );

const startPublish = Effect.gen(function* () {
  const ops = yield* JobOperationsService;
  const job = yield* ops.enqueueJob({
    id: null,
    kind: "publish",
    title: "Generics",
    lane: "publish",
    params: {},
    maxAttempts: 1,
    dependsOn: null,
    subject: { type: "course", id: "course-1" },
  });
  const ctx: JobContext = {
    jobId: job.id,
    attempt: 1,
    maxAttempts: 1,
    emit: (type, data) =>
      ops.appendJobEvent({ jobId: job.id, type, data }).pipe(Effect.orDie),
    enqueue: () => Effect.die("a Publish starts no other Job"),
  };
  return { job, ctx };
});

/** The Publish's own events after `queued`, as `type detail` lines. */
const publishEvents = (jobId: string) =>
  Effect.gen(function* () {
    const ops = yield* JobOperationsService;
    const events = yield* ops.listJobEvents(jobId);
    return events
      .filter((e) => e.type !== "queued")
      .map((e) => {
        const data = e.data as Record<string, unknown>;
        const detail = data.videoId ?? data.stage ?? "";
        return `${e.type} ${String(detail)}`.trim();
      });
  });

const PARAMS = {
  courseId: "course-1",
  name: "v1.2.0",
  description: "adds generics",
  includeTodoLessons: false,
  placeholders: "p2",
};

describe("the publish Job kind", () => {
  it.effect(
    "runs the service with the page's params and writes one Video's whole trip, in order",
    () =>
      Effect.gen(function* () {
        const { job, ctx } = yield* startPublish;
        yield* publishJobKind.runRaw(PARAMS, ctx);

        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({
          courseId: "course-1",
          versionName: "v1.2.0",
          versionDescription: "adds generics",
          includeTodoLessons: false,
        });
        expect(yield* publishEvents(job.id)).toEqual([
          "stage validating",
          "stage freezing",
          "videos",
          "video-upload-queued video-b",
          "stage exporting",
          "video-stage video-a",
          "video-progress video-a",
          "video-upload-queued video-a",
          "video-upload-progress video-a",
          "video-upload-progress video-a",
          "video-succeeded video-a",
          // A copy from the last Bundle lands too.
          "video-succeeded video-b",
          "stage complete",
          "published",
        ]);
        const ops = yield* JobOperationsService;
        const published = (yield* ops.listJobEvents(job.id)).find(
          (e) => e.type === "published"
        );
        expect(published?.data).toEqual({
          publishedVersionId: "version-1",
          newDraftVersionId: "version-2",
          lessons: { ships: 3, placeholders: 0, withheld: 1 },
        });
      }).pipe(
        Effect.provide(
          layer(
            fakePublish((emit, stage) => {
              stage("validating");
              stage("freezing");
              emit({
                event: "upload-videos",
                data: {
                  videos: [
                    { id: "video-a", title: "S1/L1/Intro" },
                    { id: "video-b", title: "S1/L2/Generics" },
                  ],
                },
              });
              emit({ event: "upload-queued", data: { videoId: "video-b" } });
              stage("exporting");
              // The export roster and `queued` are the browser's no-ops.
              emit({
                event: "videos",
                data: { videos: [{ id: "video-a", title: "S1/L1/Intro" }] },
              });
              emit({
                event: "stage",
                data: { videoId: "video-a", stage: "queued" },
              });
              emit({
                event: "stage",
                data: { videoId: "video-a", stage: "concatenating-clips" },
              });
              const progress = {
                event: "video-progress" as const,
                data: {
                  videoId: "video-a",
                  stage: "concatenating-clips" as const,
                  percent: 40,
                },
              };
              emit(progress);
              emit(progress); // ffmpeg repeats itself; only a change is news
              emit({ event: "complete", data: { videoId: "video-a" } });
              emit({ event: "upload-queued", data: { videoId: "video-a" } });
              for (const uploadedBytes of [0, 1, 500, 501]) {
                // 0% and 50%: two lines, not four.
                emit({
                  event: "upload-video-progress",
                  data: { videoId: "video-a", uploadedBytes, totalBytes: 1000 },
                });
              }
              emit({ event: "progress", data: { percentage: 50 } });
              emit({
                event: "upload-video-complete",
                data: { videoId: "video-a", bytes: 1000 },
              });
              emit({
                event: "upload-video-reused",
                data: { videoId: "video-b", bytes: 2000 },
              });
              stage("complete");
            })
          )
        )
      )
  );

  it.effect(
    "a caught Commit failure fails the Job with the route's words AND the cause, and keeps the error's fields for the CLI",
    () =>
      Effect.gen(function* () {
        const { job, ctx } = yield* startPublish;
        const error = yield* publishJobKind
          .runRaw(PARAMS, ctx)
          .pipe(Effect.flip);
        expect(error).toMatchObject({ _tag: "PublishRunError" });
        expect((error as Error).message).toBe(
          "Publish discarded: the Dropbox commit failed (after one retry): DropboxApiError: 503 from upload_session/finish. Nothing was lost — your edits are safe in the Draft. Publish again when Dropbox is reachable"
        );
        const ops = yield* JobOperationsService;
        const failed = (yield* ops.listJobEvents(job.id)).find(
          (e) => e.type === "publish-failed"
        );
        expect(failed?.data).toMatchObject({
          _tag: "PublishCommitFailedError",
          reason: "sync_failed",
          discardedVersionId: "version-1",
          newDraftVersionId: "version-2",
        });
      }).pipe(
        Effect.provide(
          layer(
            fakePublish(
              () => {},
              Effect.fail(
                new PublishCommitFailedError({
                  discardedVersionId: "version-1",
                  newDraftVersionId: "version-2",
                  reason: "sync_failed",
                  message:
                    "\nDropboxApiError: 503 from upload_session/finish\n    at …",
                })
              )
            )
          )
        )
      )
  );

  it.effect("a refused Publish says why, as the route did", () =>
    Effect.gen(function* () {
      const { ctx } = yield* startPublish;
      const error = yield* publishJobKind.runRaw(PARAMS, ctx).pipe(Effect.flip);
      expect((error as Error).message).toBe(
        "2 course warning(s) must be fixed; 1 video(s) failed to export"
      );
      // The tag `--wait` falls back on when the publish-failed event is lost.
      expect(error).toMatchObject({ _tag: PUBLISH_REFUSED_TAG });
    }).pipe(
      Effect.provide(
        layer(
          fakePublish(
            () => {},
            Effect.fail(
              new PublishValidationError({
                courseViewLintCount: 2,
                failedExportVideoIds: ["video-a"],
              })
            )
          )
        )
      )
    )
  );

  it.effect("a Publish refused for a taken name says so", () =>
    Effect.gen(function* () {
      const { ctx } = yield* startPublish;
      const error = yield* publishJobKind.runRaw(PARAMS, ctx).pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: PUBLISH_REFUSED_TAG });
      expect((error as Error).message).toBe(
        'version name "v1.0.0" is already used by another version of this course'
      );
    }).pipe(
      Effect.provide(
        layer(
          fakePublish(
            () => {},
            Effect.fail(
              new PublishValidationError({ versionNameTaken: "v1.0.0" })
            )
          )
        )
      )
    )
  );

  it.effect("refuses a band the CLI would refuse", () =>
    Effect.gen(function* () {
      const decoded = yield* publishJobKind
        .decodeParams({ ...PARAMS, placeholders: "p9" })
        .pipe(Effect.flip);
      expect(decoded._tag).toBe("ParseError");
      const defaults = yield* publishJobKind.decodeParams({
        courseId: "course-1",
        name: "v1.0.0",
        description: "x",
      });
      expect(defaults).toMatchObject({
        includeTodoLessons: true,
        placeholders: "none",
      });
    })
  );
});
