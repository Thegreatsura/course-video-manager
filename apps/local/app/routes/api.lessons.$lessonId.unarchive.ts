import { Effect } from "effect";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { makeAction } from "@/services/route-action.server";

/** The undo of the Lesson Archive: puts the Lesson back in its Section. */
export const action = makeAction({
  errors: { NotFoundError: 404, LessonPathTakenError: 409 },
  effect: ({ params }) =>
    Effect.gen(function* () {
      const lessonOps = yield* LessonSectionOperationsService;
      yield* lessonOps.unarchiveLesson(params.lessonId!);
      return { success: true };
    }),
});
