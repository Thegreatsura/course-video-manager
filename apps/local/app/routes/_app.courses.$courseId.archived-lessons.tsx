import { Button } from "@/components/ui/button";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { makeLoader } from "@/services/route-action.server";
import { Effect } from "effect";
import { ArchiveRestore, ArrowLeft } from "lucide-react";
import { Link, useFetcher } from "react-router";
import type { Route } from "./+types/_app.courses.$courseId.archived-lessons";

export const meta: Route.MetaFunction = () => {
  return [{ title: "CVM - Archived Lessons" }];
};

/**
 * The Draft Version's archived Lessons, by Section. Only the Draft accepts
 * writes, so it is the only Version whose Lessons can be unarchived; Lessons
 * of an archived Section have nowhere to go back to and are left out.
 */
export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const courseOps = yield* CourseOperationsService;
      const versionOps = yield* VersionOperationsService;
      const lessonOps = yield* LessonSectionOperationsService;

      const course = yield* courseOps.getCourseById(params.courseId!);
      const version = yield* versionOps.getLatestCourseVersion(course.id);
      if (!version || version.commitState !== "draft") {
        return { course, sections: [] };
      }
      const liveSections = yield* lessonOps.getSectionsByRepoVersionId(
        version.id
      );
      const sections = yield* Effect.forEach(liveSections, (section) =>
        Effect.map(
          lessonOps.getArchivedLessonsBySectionId(section.id),
          (lessons) => ({
            id: section.id,
            title: section.title,
            lessons: lessons.map((l) => ({ id: l.id, title: l.title })),
          })
        )
      );
      return {
        course,
        sections: sections.filter((s) => s.lessons.length > 0),
      };
    }),
});

export default function ArchivedLessons(props: Route.ComponentProps) {
  const { course, sections } = props.loaderData;

  return (
    <div className="flex-1 overflow-y-auto bg-background text-foreground">
      <div className="p-8">
        <Link to={`/courses/${course.id}`}>
          <Button variant="ghost" size="sm" className="mb-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to {course.name}
          </Button>
        </Link>
        <h1 className="text-3xl font-bold mb-6">Archived Lessons</h1>

        {sections.length === 0 ? (
          <p className="text-muted-foreground">No archived lessons.</p>
        ) : (
          <div className="space-y-6">
            {sections.map((section) => (
              <div key={section.id}>
                <h2 className="text-lg font-semibold mb-2">{section.title}</h2>
                <div className="space-y-2">
                  {section.lessons.map((lesson) => (
                    <ArchivedLessonRow key={lesson.id} lesson={lesson} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ArchivedLessonRow({
  lesson,
}: {
  lesson: { id: string; title: string };
}) {
  const fetcher = useFetcher();

  return (
    <div className="flex items-center justify-between p-4 border rounded-lg">
      <span className="font-medium">{lesson.title || "Untitled lesson"}</span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          fetcher.submit(null, {
            method: "post",
            action: `/api/lessons/${lesson.id}/unarchive`,
          });
        }}
        disabled={fetcher.state !== "idle"}
      >
        <ArchiveRestore className="w-4 h-4 mr-2" />
        Unarchive
      </Button>
    </div>
  );
}
