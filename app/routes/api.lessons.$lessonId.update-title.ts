import { Console, Effect, Schema } from "effect";
import type { Route } from "./+types/api.lessons.$lessonId.update-title";
import { DBFunctionsService } from "@/services/db-service.server";
import { runtimeLive } from "@/services/layer.server";
import { withDatabaseDump } from "@/services/dump-service";
import { toSlug } from "@/services/lesson-path-service";
import { data } from "react-router";

const updateTitleSchema = Schema.Struct({
  title: Schema.String.pipe(
    Schema.minLength(1, { message: () => "Title is required" })
  ),
});

export const action = async (args: Route.ActionArgs) => {
  const formData = await args.request.formData();
  const formDataObject = Object.fromEntries(formData);

  return Effect.gen(function* () {
    const { title } =
      yield* Schema.decodeUnknown(updateTitleSchema)(formDataObject);

    const db = yield* DBFunctionsService;

    const currentLesson = yield* db.getLessonWithHierarchyById(
      args.params.lessonId
    );

    // Update title and regenerate path slug for future "Create on Disk"
    const slug = toSlug(title) || "untitled";
    yield* db.updateLesson(args.params.lessonId, {
      title: title.trim(),
      path: slug,
      sectionId: currentLesson.sectionId,
    });

    return { success: true };
  }).pipe(
    withDatabaseDump,
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("ParseError", () => {
      return Effect.die(data("Invalid request", { status: 400 }));
    }),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data("Lesson not found", { status: 404 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
