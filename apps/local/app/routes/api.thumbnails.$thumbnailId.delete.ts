import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { ThumbnailOperationsService } from "@/services/db-thumbnail-operations.server";
import { makeAction } from "@/services/route-action.server";
import { removeUnderBestEffort } from "@/services/remove-best-effort";
import { getVideoFilesBaseDir } from "@/services/video-files";

export const action = makeAction({
  errors: { NotFoundError: 404 },
  effect: ({ params }) =>
    Effect.gen(function* () {
      const thumbnailOps = yield* ThumbnailOperationsService;
      const fs = yield* FileSystem.FileSystem;

      const thumbnail = yield* thumbnailOps.getThumbnailById(
        params.thumbnailId!
      );

      const filesToDelete: string[] = [];

      if (thumbnail.filePath) {
        filesToDelete.push(thumbnail.filePath);
      }

      const layers = thumbnail.layers as {
        backgroundPhoto?: { filePath?: string };
        diagram?: { filePath?: string } | null;
        cutout?: { filePath?: string } | null;
      };

      if (layers.backgroundPhoto?.filePath) {
        filesToDelete.push(layers.backgroundPhoto.filePath);
      }
      if (layers.diagram?.filePath) {
        filesToDelete.push(layers.diagram.filePath);
      }
      if (layers.cutout?.filePath) {
        filesToDelete.push(layers.cutout.filePath);
      }

      // Rows store absolute paths; only those under VIDEO_FILES_DIR are ever
      // deleted (on a verify-cvm clone they name Matt's real files).
      const videoFilesDir = getVideoFilesBaseDir();
      for (const filePath of filesToDelete) {
        yield* removeUnderBestEffort(fs, videoFilesDir, filePath);
      }

      yield* thumbnailOps.deleteThumbnail(params.thumbnailId!);

      return { success: true };
    }),
});
