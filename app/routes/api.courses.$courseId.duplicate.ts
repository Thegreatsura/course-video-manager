import { Console, Effect, Schema } from "effect";
import type { Route } from "./+types/api.courses.$courseId.duplicate";
import { DBFunctionsService } from "@/services/db-service.server";
import { runtimeLive } from "@/services/layer.server";
import { withDatabaseDump } from "@/services/dump-service";
import { data } from "react-router";

const duplicateCourseSchema = Schema.Struct({
  name: Schema.String.pipe(
    Schema.minLength(1, { message: () => "Course name cannot be empty" })
  ),
  filePath: Schema.String.pipe(
    Schema.minLength(1, { message: () => "File path cannot be empty" })
  ),
});

export const action = async (args: Route.ActionArgs) => {
  const formData = await args.request.formData();
  const formDataObject = Object.fromEntries(formData);
  const courseId = args.params.courseId;

  return Effect.gen(function* () {
    const { name, filePath } = yield* Schema.decodeUnknown(
      duplicateCourseSchema
    )(formDataObject);

    const db = yield* DBFunctionsService;

    // Get source course to validate name/path differ
    const sourceCourse = yield* db.getCourseById(courseId);

    if (name.trim() === sourceCourse.name) {
      return yield* Effect.die(
        data(
          { error: "New course name must differ from the original" },
          { status: 400 }
        )
      );
    }

    if (filePath.trim() === sourceCourse.filePath) {
      return yield* Effect.die(
        data(
          { error: "New file path must differ from the original" },
          { status: 400 }
        )
      );
    }

    // Check name uniqueness
    const allCourses = yield* db.getCourses();
    const archivedCourses = yield* db.getArchivedCourses();
    const allNames = [...allCourses, ...archivedCourses].map((c) => c.name);

    if (allNames.includes(name.trim())) {
      return yield* Effect.die(
        data(
          { error: "A course with this name already exists" },
          { status: 400 }
        )
      );
    }

    const result = yield* db.duplicateCourse({
      sourceCourseId: courseId,
      name: name.trim(),
      filePath: filePath.trim(),
    });

    return { id: result.course.id };
  }).pipe(
    withDatabaseDump,
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("ParseError", () => {
      return Effect.die(data({ error: "Invalid request" }, { status: 400 }));
    }),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data({ error: "Course not found" }, { status: 404 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(
        data({ error: "Internal server error" }, { status: 500 })
      );
    }),
    runtimeLive.runPromise
  );
};
