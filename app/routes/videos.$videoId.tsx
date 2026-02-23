import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DBFunctionsService } from "@/services/db-service";
import { runtimeLive } from "@/services/layer";
import { Console, Effect } from "effect";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { data, Link, Outlet, useLocation } from "react-router";
import type { Route } from "./+types/videos.$videoId";

export const loader = async (args: Route.LoaderArgs) => {
  const { videoId } = args.params;
  return Effect.gen(function* () {
    const db = yield* DBFunctionsService;
    const video = yield* db.getVideoWithClipsById(videoId);

    const nextVideoId = yield* db.getNextVideoId(videoId);
    const previousVideoId = yield* db.getPreviousVideoId(videoId);

    const lesson = video.lesson;

    if (!lesson) {
      // Standalone video
      return {
        videoId,
        videoPath: video.path,
        lessonPath: null,
        sectionPath: null,
        repoId: null,
        lessonId: null,
        isStandalone: true,
        nextVideoId,
        previousVideoId,
      };
    }

    // Lesson-attached video
    return {
      videoId,
      videoPath: video.path,
      lessonPath: lesson.path,
      sectionPath: lesson.section.path,
      repoId: lesson.section.repoVersion.repoId,
      lessonId: lesson.id,
      isStandalone: false,
      nextVideoId,
      previousVideoId,
    };
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data("Video not found", { status: 404 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};

type Tab = "edit" | "write" | "post";

const tabs: { id: Tab; label: string; path: string }[] = [
  { id: "edit", label: "Edit Video", path: "edit" },
  { id: "write", label: "Write Article", path: "write" },
  { id: "post", label: "Post to YouTube", path: "post" },
];

export default function VideoLayout({ loaderData }: Route.ComponentProps) {
  const {
    videoId,
    videoPath,
    lessonPath,
    sectionPath,
    repoId,
    lessonId,
    isStandalone,
    nextVideoId,
    previousVideoId,
  } = loaderData;

  const location = useLocation();

  // Determine active tab from current path
  const activeTab: Tab = location.pathname.endsWith("/write")
    ? "write"
    : location.pathname.endsWith("/post")
      ? "post"
      : "edit";

  // Build back button URL
  const backButtonUrl =
    repoId && lessonId ? `/?repoId=${repoId}#${lessonId}` : "/videos";

  // Build breadcrumb text
  const breadcrumb = isStandalone
    ? videoPath
    : `${sectionPath}/${lessonPath}/${videoPath}`;

  return (
    <div className="h-screen flex flex-col">
      {/* Shared header */}
      <div className="flex items-center gap-2 p-4 border-b justify-between">
        <div className="flex items-center gap-2">
          {/* Back button */}
          <Button variant="ghost" size="icon" asChild>
            <Link to={backButtonUrl}>
              <ChevronLeftIcon className="size-6" />
            </Link>
          </Button>

          {/* Breadcrumb */}
          <h1 className="text-lg">{breadcrumb}</h1>
        </div>

        <div className="flex items-center gap-4">
          {/* Tab switcher */}
          <div className="flex gap-1">
            {tabs.map((tab) => (
              <Link
                key={tab.id}
                to={`/videos/${videoId}/${tab.path}`}
                className={cn(
                  "px-3 py-1.5 text-sm font-medium rounded transition-colors",
                  activeTab === tab.id
                    ? "bg-gray-700 text-white"
                    : "text-gray-400 hover:text-gray-200"
                )}
              >
                {tab.label}
              </Link>
            ))}
          </div>

          {/* Navigation buttons */}
          <div className="flex items-center gap-2">
            {previousVideoId ? (
              <Button variant="ghost" size="sm" asChild>
                <Link to={`/videos/${previousVideoId}/${activeTab}`}>
                  <ChevronLeftIcon className="size-4 mr-1" />
                  Previous
                </Link>
              </Button>
            ) : null}
            {nextVideoId ? (
              <Button variant="ghost" size="sm" asChild>
                <Link to={`/videos/${nextVideoId}/${activeTab}`}>
                  Next
                  <ChevronRightIcon className="size-4 ml-1" />
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {/* Child route content */}
      <div className="flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
