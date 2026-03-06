import { Console, Effect, Schema } from "effect";
import type { Route } from "./+types/api.lessons.add-ghost";
import { DBFunctionsService } from "@/services/db-service.server";
import { runtimeLive } from "@/services/layer.server";
import { withDatabaseDump } from "@/services/dump-service";
import { toSlug } from "@/services/lesson-path-service";
import { data } from "react-router";

const addGhostLessonSchema = Schema.Struct({
  sectionId: Schema.String.pipe(
    Schema.minLength(1, { message: () => "Section ID is required" })
  ),
  title: Schema.String.pipe(
    Schema.minLength(1, { message: () => "Title is required" })
  ),
});

export const action = async (args: Route.ActionArgs) => {
  const formData = await args.request.formData();
  const formDataObject = Object.fromEntries(formData);

  return Effect.gen(function* () {
    const { sectionId, title } =
      yield* Schema.decodeUnknown(addGhostLessonSchema)(formDataObject);

    const db = yield* DBFunctionsService;

    // Get existing lessons to determine next order
    const existingLessons = yield* db.getLessonsBySectionId(sectionId);
    const maxOrder =
      existingLessons.length > 0
        ? Math.max(...existingLessons.map((l) => l.order))
        : 0;

    const slug = toSlug(title) || "untitled";

    // Create ghost lesson in database (no filesystem operations)
    const [newLesson] = yield* db.createGhostLesson(sectionId, {
      title,
      path: slug,
      order: maxOrder + 1,
    });

    return { success: true, lessonId: newLesson!.id };
  }).pipe(
    withDatabaseDump,
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("ParseError", () => {
      return Effect.die(data("Invalid request", { status: 400 }));
    }),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data("Section not found", { status: 404 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
