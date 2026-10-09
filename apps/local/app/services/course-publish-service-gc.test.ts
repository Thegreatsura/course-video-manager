import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import fs from "node:fs";
import path from "node:path";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { CoursePublishService } from "@/services/course-publish-service";
import {
  finishedVideosDir,
  setupPublishServiceTests,
  setupPublishableCourse as setup,
} from "./course-publish-service-test-setup";
import { ANNOUNCE_NOTHING } from "@/packages/course-json";

setupPublishServiceTests();

/**
 * Garbage collection runs after Promote and cannot fail the Publish: once
 * the `course.json` receipt has landed, a failure to reclaim a stale export
 * must not leave a Pending Version behind a failed Job.
 */
describe("publish: garbage collection after the receipt", () => {
  it("Promotes even when a stale export cannot be removed", async () => {
    const { course, run } = await setup();
    // A stale export GC will try, and fail, to remove: a non-empty directory.
    const stale = path.join(finishedVideosDir, `${course.id}-0000stale.mp4`);
    fs.mkdirSync(path.join(stale, "x"), { recursive: true });

    const result = await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        const exit = yield* Effect.either(
          svc.publish({
            courseId: course.id,
            versionName: "v1.0",
            versionDescription: "First release",
            includeTodoLessons: true,
            placeholderFloor: ANNOUNCE_NOTHING,
          })
        );
        const versionOps = yield* VersionOperationsService;
        const versions = yield* versionOps.getCourseVersions(course.id);
        return {
          failed: exit._tag === "Left",
          states: versions.map((v) => v.commitState).sort(),
        };
      })
    );
    expect(result.failed).toBe(false);
    expect(result.states).not.toContain("pending");
  });
});
