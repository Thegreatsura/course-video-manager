import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { CoursePublishService } from "@/services/course-publish-service";
import {
  setupPublishServiceTests,
  setupPublishableCourse as setup,
} from "./course-publish-service-test-setup";
import { ANNOUNCE_NOTHING } from "@/packages/course-json";

setupPublishServiceTests();

/**
 * Two Publishes of one name, both enqueued before either ran (`cvm course
 * publish` then again with `--wait`; a retry after a `--wait` poll error; two
 * tabs; a tab and the CLI). Both pass the CLI's pre-enqueue name check, since
 * the name is only written at Submit. The lane then runs them one after the
 * other: the second must be refused at Submit, not released under the same
 * name.
 */
describe("CoursePublishService — a publish name is checked at Submit", () => {
  it("refuses the second of two queued Publishes of one name, as a validation error", async () => {
    const { course, run } = await setup();
    const publishV1 = Effect.gen(function* () {
      const svc = yield* CoursePublishService;
      return yield* svc.publish({
        courseId: course.id,
        versionName: "v1.0.0",
        versionDescription: "d",
        includeTodoLessons: true,
        placeholderFloor: ANNOUNCE_NOTHING,
      });
    });

    const result = await run(
      Effect.gen(function* () {
        yield* publishV1;
        const second = yield* publishV1.pipe(Effect.flip);
        const versionOps = yield* VersionOperationsService;
        return {
          second,
          versions: yield* versionOps.getCourseVersions(course.id),
        };
      })
    );

    expect(result.second).toMatchObject({
      _tag: "PublishValidationError",
      versionNameTaken: "v1.0.0",
    });
    // One release of v1.0.0, and the Draft is still a Draft, still unnamed.
    expect(
      result.versions.map((v) => ({ name: v.name, state: v.commitState }))
    ).toEqual(
      expect.arrayContaining([
        { name: "v1.0.0", state: "published" },
        { name: "", state: "draft" },
      ])
    );
    expect(result.versions).toHaveLength(2);
  });
});
