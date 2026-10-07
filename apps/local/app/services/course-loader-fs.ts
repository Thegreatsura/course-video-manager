import { FileSystem } from "@effect/platform";
import { Config, Effect } from "effect";
import {
  computeExportHash,
  resolveExportPath,
  type ExportClip,
} from "./export-hash";
import { authoringVideoWarnings, computeVideoWarnings } from "./video-warnings";

export const loadExportStatusMap = (opts: {
  courseId: string;
  videos: { id: string; format: string; clips: ExportClip[] }[];
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const finishedVideosDir = yield* Config.string("FINISHED_VIDEOS_DIRECTORY");

    const hasExportedVideoMap: Record<string, boolean> = {};

    yield* Effect.forEach(
      opts.videos,
      (video) =>
        Effect.gen(function* () {
          const hash = computeExportHash(video.clips, video.format);
          if (!hash) {
            hasExportedVideoMap[video.id] = false;
            return;
          }
          const exportPath = resolveExportPath(
            finishedVideosDir,
            opts.courseId,
            hash
          );
          hasExportedVideoMap[video.id] = yield* fs.exists(exportPath);
        }),
      { concurrency: "unbounded" }
    );

    return hasExportedVideoMap;
  });

export const loadLessonFsMaps = (opts: {
  lessons: { id: string; fullPath: string }[];
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    const hasExplainerFolderMap: Record<string, boolean> = {};

    yield* Effect.forEach(
      opts.lessons,
      (lesson) =>
        Effect.gen(function* () {
          hasExplainerFolderMap[lesson.id] = yield* fs.exists(
            `${lesson.fullPath}/explainer`
          );
        }),
      { concurrency: "unbounded" }
    );

    return { hasExplainerFolderMap };
  });

export function toSlimVideo<
  T extends {
    clips: {
      id: string;
      sourceStartTime: number;
      sourceEndTime: number;
      order: string;
      archived: boolean;
    }[];
    chapters: { order: string; archived: boolean }[];
    lessonId?: string | null;
    body?: string | null;
    description?: string | null;
    script?: string | null;
  },
>(video: T) {
  // Drop the full script text from the slim video — it can be large and the
  // course-view tree only needs to know whether one exists (e.g. to enable the
  // "Copy script" option). The editor loads the full script separately.
  const { clips, chapters, script, ...rest } = video;
  return {
    ...rest,
    hasScript: script != null && script !== "",
    clipCount: clips.length,
    totalDuration: clips.reduce(
      (acc, c) => acc + (c.sourceEndTime - c.sourceStartTime),
      0
    ),
    firstClipId: clips[0]?.id ?? null,
    // The authoring surfaces — the course view and the Section Workbench,
    // which reuse these components — show only the warnings Matt has to clear
    // himself. The Autofill owns the missing description and the missing
    // Chapters, so they are dropped HERE rather than in computeVideoWarnings:
    // Publish Readiness reads the unfiltered set and both still refuse a
    // release.
    warnings: authoringVideoWarnings(
      computeVideoWarnings({
        clips,
        chapters,
        lessonId: video.lessonId,
        body: video.body,
        description: video.description,
      })
    ),
  };
}
