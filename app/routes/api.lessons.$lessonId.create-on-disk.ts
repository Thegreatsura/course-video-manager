import { Console, Effect } from "effect";
import type { Route } from "./+types/api.lessons.$lessonId.create-on-disk";
import { DBFunctionsService } from "@/services/db-service.server";
import { RepoWriteService } from "@/services/repo-write-service";
import { runtimeLive } from "@/services/layer.server";
import { withDatabaseDump } from "@/services/dump-service";
import { toSlug } from "@/services/lesson-path-service";
import { data } from "react-router";

const parseSectionNumber = (sectionPath: string): number => {
  const match = sectionPath.match(/^(\d+)/);
  return match ? Number(match[1]) : 1;
};

export const action = async (args: Route.ActionArgs) => {
  return Effect.gen(function* () {
    const db = yield* DBFunctionsService;
    const repoWrite = yield* RepoWriteService;

    const lesson = yield* db.getLessonWithHierarchyById(args.params.lessonId);

    if (lesson.fsStatus !== "ghost") {
      return Effect.die(data("Lesson is already on disk", { status: 400 }));
    }

    const repoPath = lesson.section.repoVersion.repo.filePath;
    const sectionPath = lesson.section.path;
    const sectionNumber = parseSectionNumber(sectionPath);
    const slug =
      toSlug(lesson.title || "") || toSlug(lesson.path) || "untitled";

    // Create the lesson directory on the filesystem
    const { lessonDirName, lessonNumber } = yield* repoWrite.addLesson({
      repoPath,
      sectionPath,
      sectionNumber,
      slug,
    });

    // Update lesson: set fsStatus to real and update path
    yield* db.updateLesson(args.params.lessonId, {
      fsStatus: "real",
      path: lessonDirName,
      sectionId: lesson.sectionId,
      lessonNumber,
    });

    return { success: true, path: lessonDirName };
  }).pipe(
    withDatabaseDump,
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data("Lesson not found", { status: 404 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
