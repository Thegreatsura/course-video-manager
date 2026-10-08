// batchExport's slice of CoursePublishService — split out of
// course-publish-service.test.ts, which covers the rest of the service. Both
// seed the shared fixture in course-publish-service-test-setup.ts.
import { describe, it, expect } from "vitest";
import { writeAlreadyExportedVideo } from "@/test-utils/exported-video-fixture";
import { Effect } from "effect";
import fs from "node:fs";
import path from "node:path";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { CoursePublishService } from "@/services/course-publish-service";
import { clips as clipsTable, videos as videosTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  finishedVideosDir,
  setupPublishServiceTests,
  setupPublishableCourse as setup,
  testDb,
} from "./course-publish-service-test-setup";

setupPublishServiceTests();

type Setup = Awaited<ReturnType<typeof setup>>;

/** Seed a Video with one Clip per entry in `clipDurations` (seconds), so a
 *  Video's length can be spread over however many Clips a test needs. */
const addVideo = async (
  { lesson, dbLayer }: Setup,
  title: string,
  clipDurations: number[]
) => {
  const created = await Effect.gen(function* () {
    const videoOps = yield* VideoOperationsService;
    return yield* videoOps.createVideo(lesson.id, {
      title,
      originalFootagePath: "/tmp/footage.mp4",
    });
  }).pipe(Effect.provide(dbLayer), Effect.runPromise);

  let sourceStartTime = 0;
  await testDb.insert(clipsTable).values(
    clipDurations.map((duration, index) => {
      const clip = {
        videoId: created.id,
        videoFilename: `${title}.mp4`,
        sourceStartTime,
        sourceEndTime: sourceStartTime + duration,
        order: `a${index}`,
        text: title,
        pauseType: "none",
        zoomType: "none",
      };
      // Leave a gap, so the spans read as distinct takes from one recording.
      sourceStartTime += duration + 1;
      return clip;
    })
  );
  // Complete, so the Lesson it joins keeps shipping (ADR 0029).
  await testDb
    .update(videosTable)
    .set({ body: `${title} body`, description: `${title} description` })
    .where(eq(videosTable.id, created.id));
  return created;
};

/** Run a batch export, collecting every emitted event. */
const runBatchExport = async ({ version, run }: Setup) => {
  const events: Array<{ event: string; data: any }> = [];
  await run(
    Effect.gen(function* () {
      const svc = yield* CoursePublishService;
      yield* svc.batchExport(version.id, true, (e) => {
        events.push({ event: e.event, data: e.data });
      });
    })
  );
  return events;
};

/** The titles of the announced queue, in the order the run will work through
 *  them. */
const announcedTitles = (events: Array<{ event: string; data: any }>) =>
  events
    .find((e) => e.event === "videos")
    ?.data.videos.map((v: any) => v.title);

describe("CoursePublishService", () => {
  describe("batchExport", () => {
    it("exports all unexported videos in a version", async () => {
      const context = await setup();
      const { course, exportHash } = context;

      const events = await runBatchExport(context);

      // Should have exported the video
      const expectedPath = path.join(
        finishedVideosDir,
        `${course.id}-${exportHash}.mp4`
      );
      expect(fs.existsSync(expectedPath)).toBe(true);

      // Should have sent events
      const videosEvent = events.find((e) => e.event === "videos");
      expect(videosEvent).toBeTruthy();
      const completeEvent = events.find((e) => e.event === "complete");
      expect(completeEvent).toBeTruthy();

      // Real ffmpeg percentages ride alongside the stages, keyed by videoId.
      const progressEvents = events
        .filter((e) => e.event === "video-progress")
        .map((e) => e.data as any);
      expect(progressEvents).toEqual([
        expect.objectContaining({ stage: "concatenating-clips", percent: 50 }),
        expect.objectContaining({ stage: "concatenating-clips", percent: 99 }),
        expect.objectContaining({ stage: "normalizing-audio", percent: 50 }),
      ]);
      expect(progressEvents[0].videoId).toBeTruthy();
    });

    it("begins the longest videos first", async () => {
      const context = await setup();

      // Titles chosen so the walk order (sections → lessons → title asc) is
      // "A Tiny", "B Long", "Problem" — nothing like the longest-first order.
      await addVideo(context, "A Tiny", [2]);
      await addVideo(context, "B Long", [300]);

      const events = await runBatchExport(context);

      // "Problem" is the 20s video seeded by setup().
      expect(announcedTitles(events)).toEqual([
        "intro/welcome/B Long",
        "intro/welcome/Problem",
        "intro/welcome/A Tiny",
      ]);
    });

    it("measures a video's length across all of its clips", async () => {
      const context = await setup();

      // Six 20s clips outrun a single 100s one, though every clip in the
      // longer Video is individually the shorter of the two. Titled so the
      // walk order puts the longest Video last.
      await addVideo(context, "Z Many Short", Array(6).fill(20));
      await addVideo(context, "A One Long", [100]);

      const events = await runBatchExport(context);

      expect(announcedTitles(events)).toEqual([
        "intro/welcome/Z Many Short",
        "intro/welcome/A One Long",
        "intro/welcome/Problem",
      ]);
    });

    it("skips already exported videos", async () => {
      const context = await setup();
      const { course, exportHash } = context;

      // Pre-create the exported file
      writeAlreadyExportedVideo(
        path.join(finishedVideosDir, `${course.id}-${exportHash}.mp4`),
        "data"
      );

      const events = await runBatchExport(context);

      // Should report zero unexported videos
      expect(announcedTitles(events)).toEqual([]);
    });

    // A Video with no Clips has no Export Hash, so there is nothing to render
    // and nothing to compare an existing file against — the roster must never
    // queue an export that could only fail. Moved here from the retired
    // batch-export.server.ts suite, which asserted the same rule against a copy
    // of the roster that no route called.
    //
    // ADR 0029 moved WHERE that is decided: no Clips is a hard gap, and a Lesson
    // is all-or-nothing, so the whole Lesson is withheld from the roster. Both
    // halves of that are asserted, because between them they are the rule: the
    // clip-less Video is never exported, and neither is the sound Video beside
    // it.
    const addCliplessVideo = async ({ dbLayer }: Setup, lessonId: string) =>
      Effect.gen(function* () {
        const videoOps = yield* VideoOperationsService;
        return yield* videoOps.createVideo(lessonId, {
          title: "Clipless",
          originalFootagePath: "/tmp/footage.mp4",
        });
      }).pipe(Effect.provide(dbLayer), Effect.runPromise);

    it("withholds the whole lesson a clip-less video sits on", async () => {
      const context = await setup();

      // Beside the seeded, clip-bearing "Problem": one hard gap decides the
      // Lesson, so NEITHER Video is exported.
      await addCliplessVideo(context, context.lesson.id);

      const events = await runBatchExport(context);

      expect(announcedTitles(events)).toEqual([]);
    });

    it("leaves the rest of the course shipping around it", async () => {
      const context = await setup();
      const { dbLayer, section } = context;

      // On a Lesson of its own this time, so only that Lesson is withheld.
      const lessonId = await Effect.gen(function* () {
        const lsOps = yield* LessonSectionOperationsService;
        const lessons = yield* lsOps.createLessons(section.id, [
          { lessonPathWithNumber: "01.02-clipless", lessonNumber: 2 },
        ]);
        return lessons[0]!.id;
      }).pipe(Effect.provide(dbLayer), Effect.runPromise);
      await addCliplessVideo(context, lessonId);

      const events = await runBatchExport(context);

      // "Problem" is the clip-bearing Video seeded by setup(); "Clipless" is
      // never announced, so it is never exported.
      expect(announcedTitles(events)).toEqual(["intro/welcome/Problem"]);
    });
  });
});
