import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import fs from "node:fs";
import path from "node:path";
import { CoursePublishService } from "@/services/course-publish-service";
import { chapters as chaptersTable, videos as videosTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  finishedVideosDir,
  setupPublishServiceTests,
  setupPublishableCourse as setup,
  testDb,
} from "./course-publish-service-test-setup";

setupPublishServiceTests();

describe("CoursePublishService", () => {
  describe("isExported", () => {
    it("returns false when no file exists", async () => {
      const { video, run } = await setup();

      const result = await run(
        Effect.gen(function* () {
          const svc = yield* CoursePublishService;
          return yield* svc.isExported(video.id);
        })
      );

      expect(result).toBe(false);
    });

    it("returns true when content-addressed file exists", async () => {
      const { video, course, exportHash, run } = await setup();

      // Create the content-addressed file
      const filePath = path.join(
        finishedVideosDir,
        `${course.id}-${exportHash}.mp4`
      );
      fs.writeFileSync(filePath, "video-data");

      const result = await run(
        Effect.gen(function* () {
          const svc = yield* CoursePublishService;
          return yield* svc.isExported(video.id);
        })
      );

      expect(result).toBe(true);
    });
  });

  describe("resolveExportPath", () => {
    it("returns content-addressed path for video with clips", async () => {
      const { video, course, exportHash, run } = await setup();

      const result = await run(
        Effect.gen(function* () {
          const svc = yield* CoursePublishService;
          return yield* svc.resolveExportPath(video.id);
        })
      );

      expect(result).toBe(
        path.join(finishedVideosDir, `${course.id}-${exportHash}.mp4`)
      );
    });
  });

  describe("exportVideo", () => {
    it("exports video to content-addressed path", async () => {
      const { video, course, exportHash, run } = await setup();

      const stages: string[] = [];
      const result = await run(
        Effect.gen(function* () {
          const svc = yield* CoursePublishService;
          return yield* svc.exportVideo(video.id, (stage) => {
            stages.push(stage);
          });
        })
      );

      const expectedPath = path.join(
        finishedVideosDir,
        `${course.id}-${exportHash}.mp4`
      );
      expect(result).toBe(expectedPath);
      expect(fs.existsSync(expectedPath)).toBe(true);
      expect(stages).toContain("concatenating-clips");
      expect(stages).toContain("normalizing-audio");
    });

    it("skips rendering if already exported", async () => {
      const { video, course, exportHash, run } = await setup();

      // Pre-create the content-addressed file
      const expectedPath = path.join(
        finishedVideosDir,
        `${course.id}-${exportHash}.mp4`
      );
      fs.writeFileSync(expectedPath, "already-exported");

      const stages: string[] = [];
      const result = await run(
        Effect.gen(function* () {
          const svc = yield* CoursePublishService;
          return yield* svc.exportVideo(video.id, (stage) => {
            stages.push(stage);
          });
        })
      );

      expect(result).toBe(expectedPath);
      // Should NOT have called ffmpeg (no stage events)
      expect(stages).toEqual([]);
      // File content should be unchanged (not re-rendered)
      expect(fs.readFileSync(expectedPath, "utf-8")).toBe("already-exported");
    });
  });

  describe("validatePublishability", () => {
    it("returns unexported video IDs when videos are not exported", async () => {
      const { version, video, run } = await setup();

      const result = await run(
        Effect.gen(function* () {
          const svc = yield* CoursePublishService;
          return (yield* svc.validatePublishability(version.id)).withTodo;
        })
      );

      expect(result.unexportedVideoIds).toContain(video.id);
    });

    it("returns empty list when all videos are exported", async () => {
      const { version, course, exportHash, run } = await setup();

      // Create the exported file
      fs.writeFileSync(
        path.join(finishedVideosDir, `${course.id}-${exportHash}.mp4`),
        "data"
      );

      const result = await run(
        Effect.gen(function* () {
          const svc = yield* CoursePublishService;
          return (yield* svc.validatePublishability(version.id)).withTodo;
        })
      );

      expect(result.unexportedVideoIds).toEqual([]);
    });

    // A missing `description` is the only gap a SHIPPING Video can still have:
    // a missing `body` or missing Clips is a hard gap, which withholds the
    // Lesson instead of blocking the release (ADR 0029).
    it("surfaces a shipping video missing its description", async () => {
      const { version, video, run } = await setup();
      await testDb
        .update(videosTable)
        .set({ description: null })
        .where(eq(videosTable.id, video.id));

      const result = await run(
        Effect.gen(function* () {
          const svc = yield* CoursePublishService;
          return (yield* svc.validatePublishability(version.id)).withTodo;
        })
      );

      expect(result.incompleteVideos).toMatchObject([
        {
          sectionPath: "intro",
          lessonPath: "welcome",
          videoTitle: "Problem",
          missing: ["description"],
        },
      ]);
      expect(result.invalidLessonCombos).toEqual([]);
    });
  });

  describe("validatePublishability — course-view lints", () => {
    it("returns courseViewLintCount > 0 when missingChapters warning exists", async () => {
      const { version, video, run } = await setup();
      // The shared fixture gives every Video a Chapter; take it away.
      await testDb
        .delete(chaptersTable)
        .where(eq(chaptersTable.videoId, video.id));

      const result = await run(
        Effect.gen(function* () {
          const svc = yield* CoursePublishService;
          return (yield* svc.validatePublishability(version.id)).withTodo;
        })
      );

      expect(result.courseViewLintCount).toBeGreaterThan(0);
    });
  });
});
