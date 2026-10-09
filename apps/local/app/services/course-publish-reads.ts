import { Config, Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import {
  computeExportHash,
  type ExportOverlay,
  resolveExportPath as resolveExportPathPure,
  toExportClips,
} from "./export-hash";
import {
  ANNOUNCE_NOTHING,
  type PlaceholderFloor,
} from "@/packages/course-json";
import {
  validatePublishability as validatePublishabilityCore,
  validateVersionPublishability as validateVersionPublishabilityCore,
  type VersionTree,
} from "./course-publish-readiness";

export type VideoForExport = {
  id: string;
  format: string;
  lesson?: {
    section: { repoVersion: { repo: { id: string } } };
  } | null;
  clips: Array<{
    videoFilename: string;
    sourceStartTime: number;
    sourceEndTime: number;
    pauseType: string;
    zoomType: string;
    order: string;
    overlays: ExportOverlay[];
  }>;
};

/**
 * The read side of Publish: where a Video's export lives, whether it is on
 * disk, and the publish gate. Nothing here spawns a process, so the app
 * server has it (`CoursePublishReadService`, in `layerLive`), and so does the
 * Sidecar's `CoursePublishService`, which adds the export and the Publish
 * themselves (docs/plans/background-jobs-sidecar.md, the spawn guard).
 */
export const makeCoursePublishReads = Effect.gen(function* () {
  const videoOps = yield* VideoOperationsService;
  const effectFs = yield* FileSystem.FileSystem;
  const FINISHED_VIDEOS_DIRECTORY = yield* Config.string(
    "FINISHED_VIDEOS_DIRECTORY"
  );

  const resolveExportPath = Effect.fn("resolveExportPath")(function* (
    videoOrId: string | VideoForExport
  ) {
    const video =
      typeof videoOrId === "string"
        ? yield* videoOps.getVideoWithClipsById(videoOrId)
        : videoOrId;
    if (video.clips.length === 0) return null;

    const hash = computeExportHash(toExportClips(video.clips), video.format);
    if (!hash) return null;

    const namespace = video.lesson?.section.repoVersion.repo.id ?? video.id;
    return resolveExportPathPure(FINISHED_VIDEOS_DIRECTORY, namespace, hash);
  });

  const isExported = Effect.fn("isExported")(function* (
    videoOrId: string | VideoForExport
  ) {
    const exportPath = yield* resolveExportPath(videoOrId);
    if (!exportPath) return false;
    return yield* effectFs.exists(exportPath);
  });

  // The publish validation gate. The computation itself lives in
  // ./course-publish-readiness so it can also be read on its own — by the
  // `cvm course readiness` CLI verb — without dragging in the export stack.
  // Its deps are closed over here so callers of this service method don't
  // inherit them.
  const readinessContext = yield* Effect.context<
    VersionOperationsService | FileSystem.FileSystem
  >();
  const validatePublishability = Effect.fn("validatePublishability")(function* (
    versionId: string,
    placeholderFloor: PlaceholderFloor = ANNOUNCE_NOTHING
  ) {
    return yield* validatePublishabilityCore(versionId, placeholderFloor).pipe(
      Effect.provide(readinessContext)
    );
  });

  // Same gate over a tree the caller already read (the publish page loader).
  const validatePublishabilityOfTree = Effect.fn(
    "validatePublishabilityOfTree"
  )(function* (
    version: VersionTree,
    placeholderFloor: PlaceholderFloor = ANNOUNCE_NOTHING
  ) {
    return yield* validateVersionPublishabilityCore(
      version,
      placeholderFloor
    ).pipe(Effect.provide(readinessContext));
  });

  return {
    resolveExportPath,
    isExported,
    validatePublishability,
    validatePublishabilityOfTree,
  };
});

/** The read side of Publish, for routes: no export, no Publish, no spawn. */
export class CoursePublishReadService extends Effect.Service<CoursePublishReadService>()(
  "CoursePublishReadService",
  { effect: makeCoursePublishReads }
) {}
