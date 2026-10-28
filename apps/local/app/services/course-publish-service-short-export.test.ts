/**
 * What a Publish does with a renderer that produced a short file.
 *
 * ffmpeg exiting zero says only that it stopped without complaining. These
 * tests run the real publish logic against a renderer that writes a file and
 * then reports it as shorter than its Clips ask for, and pin the two things
 * that must follow: the Publish fails the export by name, and the short file
 * never reaches its content-addressed path.
 */

import { describe, it, expect } from "vitest";
import { Cause, Effect, Layer, Logger } from "effect";
import fs from "node:fs";
import { asc, eq } from "drizzle-orm";
import { clips as clipsTable } from "@/db/schema";
import { VideoExportService } from "@/services/video-export-service";
import { FfmpegInputCutShortError } from "@/services/ffmpeg-error";
import { CoursePublishService } from "@/services/course-publish-service";
import { resolveExportPath } from "@/services/export-hash";
import {
  finishedVideosDir,
  setupPublishServiceTests,
  setupPublishableCourse as setup,
  testDb,
} from "./course-publish-service-test-setup";
import { ANNOUNCE_NOTHING } from "@/packages/course-json";

setupPublishServiceTests();

const publishExpectingFailure = (
  run: <A, E>(effect: Effect.Effect<A, E, any>) => Promise<A>,
  courseId: string
) =>
  run(
    Effect.gen(function* () {
      const svc = yield* CoursePublishService;
      return yield* svc
        .publish({
          courseId,
          versionName: "v1.0",
          versionDescription: "First release",
          includeTodoLessons: true,
          placeholderFloor: ANNOUNCE_NOTHING,
        })
        .pipe(
          Effect.catchTag("PublishValidationError", (e) =>
            Effect.succeed({
              failed: true as const,
              failedExportVideoIds: e.failedExportVideoIds,
            })
          )
        );
    })
  );

describe("CoursePublishService — when an export comes out short", () => {
  it("fails the Publish and names the Video whose export was short", async () => {
    const { course, video, run } = await setup({
      renderDurationInSeconds: (render) =>
        render.requestedDurationInSeconds - 5,
    });

    const result = await publishExpectingFailure(run, course.id);

    expect(result).toHaveProperty("failed", true);
    expect((result as any).failedExportVideoIds).toContain(video.id);
  }, 60_000);

  it("never lets a short export reach its content-addressed path", async () => {
    const { course, exportHash, run } = await setup({
      renderDurationInSeconds: (render) =>
        render.requestedDurationInSeconds - 5,
    });

    await publishExpectingFailure(run, course.id);

    // Nothing downstream can address a file that is not there, so the next
    // attempt re-encodes rather than skipping.
    const exportPath = resolveExportPath(
      finishedVideosDir,
      course.id,
      exportHash!
    );
    expect(fs.existsSync(exportPath)).toBe(false);
  }, 60_000);
});

const exportVideo = (videoId: string) =>
  Effect.gen(function* () {
    const svc = yield* CoursePublishService;
    return yield* svc.exportVideo(videoId);
  });

describe("CoursePublishService — what a failed export says", () => {
  it("logs a short export without a phantom `[cause]: Error: null`", async () => {
    const { video, run } = await setup({
      renderDurationInSeconds: (render) =>
        render.requestedDurationInSeconds - 5,
    });
    const rendered: string[] = [];
    const logger = Logger.make(({ cause }) => {
      if (!Cause.isEmpty(cause))
        rendered.push(Cause.pretty(cause, { renderErrorCause: true }));
    });

    await expect(
      run(
        exportVideo(video.id).pipe(
          Effect.provide(Logger.replace(Logger.defaultLogger, logger))
        )
      )
    ).rejects.toThrow(/is short/);

    expect(rendered.join("\n")).toContain("is short");
    expect(rendered.join("\n")).not.toContain("Error: null");
  }, 60_000);

  it("names the Clip and Footage ffmpeg stopped reading early", async () => {
    const { video, run } = await setup({
      mockVideoProcessing: Layer.succeed(VideoExportService, {
        exportVideoClips: () =>
          Effect.fail(
            new FfmpegInputCutShortError({
              message:
                "Failed to create concatenated video: ffmpeg stopped reading input #1 (/footage/recording.mp4) early",
              inputIndex: 1,
              inputPath: "/footage/recording.mp4",
              reason: "Cannot allocate memory",
              clipIndex: 1,
            })
          ),
      } as unknown as VideoExportService),
    });
    const [, secondClip] = await testDb
      .select({ id: clipsTable.id })
      .from(clipsTable)
      .where(eq(clipsTable.videoId, video.id))
      .orderBy(asc(clipsTable.order));

    const failure = run(exportVideo(video.id));

    await expect(failure).rejects.toThrow(
      `Clip 2 of 2 (clip ${secondClip!.id}, /footage/recording.mp4 from 15.00s to 25.00s)`
    );
    await expect(failure).rejects.toThrow(/Cannot allocate memory/);
  }, 60_000);
});
