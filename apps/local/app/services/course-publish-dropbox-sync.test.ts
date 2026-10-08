/**
 * What a committed Bundle holds: course.json's shape, the files beside it,
 * archived Videos and withheld to-do Lessons. How the Videos get there —
 * addressing, concurrency, resuming — is course-publish-dropbox-upload's.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  clips as clipsTable,
  lessons as lessonsTable,
  videos as videosTable,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  DROPBOX_REMOTE_PATH,
  fakeDropbox,
  manifestVideos,
  receiptManifest,
  setupDropboxUploadTests,
  setupUploads,
  testDb,
  type PublishedManifest,
} from "./course-publish-dropbox-upload-test-setup";

setupDropboxUploadTests();

/** Two complete Lessons, the second of them still to-do. */
const setupSync = async () => {
  const world = await setupUploads({ videoCount: 2 });
  const todoVideo = world.videos[1]!;
  const [row] = await testDb
    .select({ lessonId: videosTable.lessonId })
    .from(videosTable)
    .where(eq(videosTable.id, todoVideo.id));
  await testDb
    .update(lessonsTable)
    .set({ authoringStatus: "todo" })
    .where(eq(lessonsTable.id, row!.lessonId!));
  return { ...world, todoVideo };
};

const remotePath = (relativePath: string) =>
  `${DROPBOX_REMOTE_PATH}/test-course/${relativePath}`;

describe("syncFrozenCourseVersionToDropbox (Dropbox HTTP API)", () => {
  it("uploads videos for all lessons", async () => {
    const { sync } = await setupSync();

    await sync();

    const videos = manifestVideos(receiptManifest());
    expect(videos).toHaveLength(2);
    for (const video of videos) {
      expect(fakeDropbox.get(remotePath(video.relativePath))).toBeDefined();
    }
  });

  it("rejects bundle corruption without moving the commit marker", async () => {
    const { sync } = await setupSync();

    await sync();

    const manifestBefore = receiptManifest();
    // Corrupt a video in the fake Dropbox.
    const firstVideo = manifestVideos(manifestBefore)[0]!;
    const stored = fakeDropbox.get(remotePath(firstVideo.relativePath))!;
    // Replace with same-sized but different content.
    fakeDropbox.store(
      stored.pathDisplay,
      Buffer.from("x".repeat(stored.content.length))
    );

    await expect(sync()).rejects.toBeDefined();

    // Manifest should be unchanged.
    expect(receiptManifest()).toEqual(manifestBefore);
  });

  it("writes only .mp4, course.json, manifest.json, and course.schema.json — no authoring sidecars", async () => {
    const { sync } = await setupSync();

    await sync();

    const doc = receiptManifest();
    const coursePrefix = `${DROPBOX_REMOTE_PATH}/test-course/`;
    const prefix = coursePrefix.toLowerCase();
    const remoteFiles = Array.from(fakeDropbox.files.keys())
      .filter((k) => k.startsWith(prefix))
      .map((k) =>
        fakeDropbox.files.get(k)!.pathDisplay.slice(coursePrefix.length)
      )
      .sort();

    const expectedFiles = [
      "course.json",
      `${doc.$schema}`,
      `${path.posix.dirname(doc.$schema)}/manifest.json`,
      ...manifestVideos(doc).map((video) => video.relativePath),
    ].sort();

    expect(remoteFiles).toEqual(expectedFiles);
  });

  it("returns missingVideos without writing an incomplete manifest", async () => {
    const { videos, sync } = await setupSync();
    for (const video of videos) fs.unlinkSync(video.exportPath);

    const result = await sync();

    expect(result.missingVideos.length).toBeGreaterThan(0);
    expect(
      fakeDropbox.get(`${DROPBOX_REMOTE_PATH}/test-course/course.json`)
    ).toBeUndefined();
  });

  it("emits course.json at the course root", async () => {
    const { course, version, sync } = await setupSync();

    await sync();

    const doc = receiptManifest() as PublishedManifest & {
      courseId: string;
      courseVersionId: string;
      archiveTTL: string;
      courseName: string;
    };
    expect(doc.schemaVersion).toBe(4);
    expect(doc.courseId).toBe(course.id);
    expect(doc.courseVersionId).toBe(version.id);
    expect(doc.archiveTTL).toBe("90d");
    expect(doc.courseName).toBe("test-course");
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0]!.lessons).toHaveLength(2);
  });

  it("course.json contains no path field", async () => {
    const { sync } = await setupSync();

    await sync();

    const doc = receiptManifest();
    expect(doc.sections[0]).not.toHaveProperty("path");
    const lesson = doc.sections[0]!.lessons[0]!;
    expect(lesson).not.toHaveProperty("path");
    const video = lesson.problem ?? lesson.explainer;
    expect(video).not.toHaveProperty("path");
  });

  it("does not resolve or publish archived videos", async () => {
    const { todoVideo, sync } = await setupSync();
    // Move its Export Hash off the file on disk, so resolving it would
    // report a missing Video.
    await testDb
      .update(clipsTable)
      .set({ sourceEndTime: 99 })
      .where(eq(clipsTable.videoId, todoVideo.id));
    await testDb
      .update(videosTable)
      .set({ archived: true })
      .where(eq(videosTable.id, todoVideo.id));

    const result = await sync();

    expect(result.missingVideos).toEqual([]);
    const videos = manifestVideos(receiptManifest());
    expect(videos).toHaveLength(1);
    expect(videos[0]!.relativePath).not.toContain("lesson-2");
  });

  // ── Withholding to-do lessons (includeTodoLessons = false) ──────────

  it("withholds a to-do lesson's folder and omits it from course.json", async () => {
    const { sync } = await setupSync();

    await sync(undefined, false);

    const doc = receiptManifest();
    const videos = manifestVideos(doc);
    expect(videos).toHaveLength(1);
    expect(videos[0]!.relativePath).toContain("lesson-1/Explainer1.mp4");
    expect(fakeDropbox.get(remotePath(videos[0]!.relativePath))).toBeDefined();
    expect(videos[0]!.relativePath).not.toContain("lesson-2");

    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0]!.lessons).toHaveLength(1);
  });

  it("keeps the prior immutable bundle when a later manifest withholds a to-do lesson", async () => {
    const { sync } = await setupSync();

    // First publish includes the to-do lesson.
    await sync(undefined, true);
    const previousTodoVideo = manifestVideos(receiptManifest()).find((video) =>
      video.relativePath.includes("lesson-2")
    )!;
    const previousTodoPath = remotePath(previousTodoVideo.relativePath);
    expect(fakeDropbox.get(previousTodoPath)).toBeDefined();

    // A later publish withholds it.
    await sync(undefined, false);
    expect(
      manifestVideos(receiptManifest()).some((video) =>
        video.relativePath.includes("lesson-2")
      )
    ).toBe(false);
    // The prior bundle's files are still in Dropbox.
    expect(fakeDropbox.get(previousTodoPath)).toBeDefined();
  });
});
