import { describe, expect, it } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Fiber, Layer } from "effect";
import { NodeContext } from "@effect/platform-node";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { DrizzleService } from "@cvm/core/services/drizzle-service.server";
import { CoursePublishService } from "@/services/course-publish-service";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { SidecarContextTest } from "@/services/sidecar-context";
import { VideoEditorLoggerService } from "@/services/video-editor-logger-service";
import type { EmitPublishDetailEvent } from "@/services/course-publish-export-events";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import type { JobContext } from "../job-kind";
import { batchExportJobKind } from "./batch-export";

let testDb: TestDb;
/** The Videos each `batchExport` call was told to leave alone. */
let skipped: string[][] = [];

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  skipped = [];
});

const VIDEOS = [
  { id: "video-a", title: "S1/L1/Intro" },
  { id: "video-b", title: "S1/L2/Generics" },
  { id: "video-c", title: "S2/L1/Outro" },
];

/**
 * A `batchExport` that reports as the service does — the roster, `queued`
 * for each, then whatever `script` says — and then ends as `end` says.
 */
const fakeBatch = (
  script: (emit: EmitPublishDetailEvent) => void,
  end: Effect.Effect<void, unknown> = Effect.void
) =>
  Layer.succeed(CoursePublishService, {
    batchExport: (
      _versionId: string,
      _includeTodo: boolean,
      emit?: EmitPublishDetailEvent,
      skip: ReadonlySet<string> = new Set()
    ) =>
      Effect.gen(function* () {
        skipped.push([...skip]);
        const videos = VIDEOS.filter((v) => !skip.has(v.id));
        emit?.({ event: "videos", data: { videos } });
        for (const v of videos) {
          emit?.({ event: "stage", data: { videoId: v.id, stage: "queued" } });
        }
        if (emit) script(emit);
        yield* end;
      }),
  } as unknown as CoursePublishService);

/**
 * The fake batch, the job table, and what the real `batchExport`'s type asks
 * for (the fake touches none of it).
 */
const layer = (batch: ReturnType<typeof fakeBatch>) =>
  Layer.mergeAll(
    batch,
    SidecarContextTest,
    NodeContext.layer,
    Layer.succeed(VersionOperationsService, {} as VersionOperationsService),
    Layer.succeed(VideoEditorLoggerService, {} as VideoEditorLoggerService),
    JobOperationsService.Default.pipe(
      Layer.provide(Layer.succeed(DrizzleService, testDb as any))
    )
  );

/** A real batch-export row, and a context that writes its events. */
const startBatch = Effect.gen(function* () {
  const ops = yield* JobOperationsService;
  const job = yield* ops.enqueueJob({
    id: null,
    kind: "batch-export",
    title: "Export all: Generics",
    lane: "default",
    params: { versionId: "version-1" },
    maxAttempts: 1,
    dependsOn: null,
    subject: { type: "course-version", id: "version-1" },
  });
  const ctx: JobContext = {
    jobId: job.id,
    attempt: 1,
    maxAttempts: 1,
    emit: (type, data) =>
      ops.appendJobEvent({ jobId: job.id, type, data }).pipe(Effect.orDie),
  };
  return { job, ctx };
});

/** The batch's own events after `queued`, as `type videoId` lines. */
const batchEvents = (jobId: string) =>
  Effect.gen(function* () {
    const ops = yield* JobOperationsService;
    const events = yield* ops.listJobEvents(jobId);
    return events
      .filter((e) => e.type !== "queued")
      .map((e) => {
        const data = e.data as Record<string, unknown>;
        return `${e.type} ${String(data.videoId ?? "")}`.trim();
      });
  });

/** Every standalone export Job the batch handed a Video on to. */
const handedOn = Effect.gen(function* () {
  const ops = yield* JobOperationsService;
  const recent = yield* ops.listRecentJobs({ finishedWithinMs: 60_000 });
  const exports = yield* Effect.forEach(
    recent.filter(({ job }) => job.kind === "export"),
    ({ job }) => ops.getJob(job.id)
  );
  return exports
    .flatMap((j) => (j ? [j] : []))
    .map((j) => ({
      videoId: j.subjectId,
      title: j.title,
      maxAttempts: j.maxAttempts,
      params: j.params,
    }))
    .sort((a, b) => String(a.videoId).localeCompare(String(b.videoId)));
});

describe("the batch-export Job kind", () => {
  it.effect(
    "writes each Video's progress in order, and hands a Video that failed its tries on at once, with 2 attempts left",
    () =>
      Effect.gen(function* () {
        const { job, ctx } = yield* startBatch;
        yield* batchExportJobKind.runRaw({ versionId: "version-1" }, ctx);

        expect(yield* batchEvents(job.id)).toEqual([
          "videos",
          "video-stage video-a",
          "video-progress video-a",
          "video-succeeded video-a",
          "video-stage video-b",
          "video-failed video-b",
          "video-handed-off video-b",
          "video-succeeded video-c",
        ]);
        // 3 runs in the batch (`recurs(2)`) + 2 on its own: 5, as before.
        expect(yield* handedOn).toEqual([
          {
            videoId: "video-b",
            title: "S1/L2/Generics",
            maxAttempts: 2,
            params: { videoId: "video-b" },
          },
        ]);
      }).pipe(
        Effect.provide(
          layer(
            fakeBatch((emit) => {
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
              emit({
                event: "stage",
                data: { videoId: "video-b", stage: "concatenating-clips" },
              });
              emit({
                event: "error",
                data: { videoId: "video-b", message: "ffmpeg exited 1" },
              });
              emit({ event: "complete", data: { videoId: "video-c" } });
            })
          )
        )
      )
  );

  it.effect(
    "when the batch itself fails, hands every Video it has not finished on — once each — and fails",
    () =>
      Effect.gen(function* () {
        const { job, ctx } = yield* startBatch;
        const error = yield* batchExportJobKind
          .runRaw({ versionId: "version-1" }, ctx)
          .pipe(Effect.flip);
        expect(error).toBe("the stream dropped");
        // A finished, and B already handed on: only C is left to hand on.
        expect((yield* handedOn).map((j) => j.videoId)).toEqual([
          "video-b",
          "video-c",
        ]);
        expect(
          (yield* batchEvents(job.id)).filter((e) =>
            e.startsWith("video-handed-off")
          )
        ).toEqual(["video-handed-off video-b", "video-handed-off video-c"]);
      }).pipe(
        Effect.provide(
          layer(
            fakeBatch((emit) => {
              emit({ event: "complete", data: { videoId: "video-a" } });
              emit({
                event: "error",
                data: { videoId: "video-b", message: "ffmpeg exited 1" },
              });
            }, Effect.fail("the stream dropped"))
          )
        )
      )
  );

  it.live(
    "a stopped run hands nothing on; once the run is known lost, what it left is handed on exactly once",
    () =>
      Effect.gen(function* () {
        const { job, ctx } = yield* startBatch;
        const fiber = yield* Effect.fork(
          batchExportJobKind.runRaw({ versionId: "version-1" }, ctx)
        );
        // Let it report, then stop it as the sidecar does on a signal.
        yield* Effect.sleep(50);
        yield* Fiber.interrupt(fiber);
        expect(yield* handedOn).toEqual([]);

        // Recovery finds the lease expired, and the kind cleans up after it.
        yield* batchExportJobKind.afterLostRun!({ id: job.id, title: "" });
        yield* batchExportJobKind.afterLostRun!({ id: job.id, title: "" });
        expect((yield* handedOn).map((j) => j.videoId)).toEqual([
          "video-b",
          "video-c",
        ]);
      }).pipe(
        Effect.provide(
          layer(
            fakeBatch(
              (emit) =>
                emit({ event: "complete", data: { videoId: "video-a" } }),
              Effect.never
            )
          )
        )
      )
  );

  it.effect(
    "a re-run after a deliberate stop leaves alone the Videos an earlier run handed on",
    () =>
      Effect.gen(function* () {
        const { ctx } = yield* startBatch;
        yield* batchExportJobKind.runRaw({ versionId: "version-1" }, ctx);
        yield* batchExportJobKind.runRaw({ versionId: "version-1" }, ctx);
        expect(skipped).toEqual([[], ["video-b"]]);
        // Handed on once, by the first run only.
        expect((yield* handedOn).map((j) => j.videoId)).toEqual(["video-b"]);
      }).pipe(
        Effect.provide(
          layer(
            fakeBatch((emit) => {
              if (skipped.length === 1) {
                emit({
                  event: "error",
                  data: { videoId: "video-b", message: "ffmpeg exited 1" },
                });
              }
            })
          )
        )
      )
  );
});
