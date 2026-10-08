import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { ThumbnailOperationsService } from "@/services/db-thumbnail-operations.server";
import { makeAction } from "@/services/route-action.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { getVideoFilePath, getVideoFilesBaseDir } from "@/services/video-files";
import { assertUnderEffect, isUnder } from "@/services/assert-under";
import { data } from "react-router";
import { removeUnderBestEffort } from "@/services/remove-best-effort";

function decodeDataUrl(dataUrl: string): Uint8Array {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match || !match[2]) {
    throw new Error("Invalid base64 data URL format");
  }
  const binaryString = atob(match[2]);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export const action = makeAction({
  input: "json",
  errors: { NotFoundError: 404 },
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const body = payload as Record<string, unknown>;
      const {
        imageDataUrl,
        backgroundPhotoDataUrl,
        diagramDataUrl,
        diagramPosition,
        cutoutDataUrl,
        cutoutPosition,
      } = body;

      if (
        typeof imageDataUrl !== "string" ||
        !imageDataUrl.startsWith("data:")
      ) {
        return yield* Effect.die(
          data("imageDataUrl is required", { status: 400 })
        );
      }

      const thumbnailId = params.thumbnailId!;
      const thumbnailOps = yield* ThumbnailOperationsService;
      const videoOps = yield* VideoOperationsService;
      const fs = yield* FileSystem.FileSystem;

      const existing = yield* thumbnailOps.getThumbnailById(thumbnailId);
      const video = yield* videoOps.getVideoDeepById(existing.videoId);
      const existingLayers = existing.layers as {
        backgroundPhoto?: { filePath?: string; horizontalPosition?: number };
        diagram?: { filePath?: string } | null;
        cutout?: { filePath?: string } | null;
      };

      // Every path written here must lie under VIDEO_FILES_DIR. A stored path
      // that does not (on a verify-cvm clone the row still names Matt's real
      // file) is never written: the layer moves to its canonical address in
      // this store instead, and the row is updated to point there.
      const videoFilesDir = getVideoFilesBaseDir();
      const layerPath = (stored: string | null | undefined, suffix: string) =>
        stored && isUnder(videoFilesDir, stored)
          ? stored
          : getVideoFilePath(
              video.lineageId,
              `thumbnail-${thumbnailId}${suffix}.png`
            );
      yield* fs.makeDirectory(getVideoFilePath(video.lineageId), {
        recursive: true,
      });

      const compositeBytes = decodeDataUrl(imageDataUrl as string);
      const compositePath = yield* assertUnderEffect(
        videoFilesDir,
        layerPath(existing.filePath, "")
      );
      yield* fs.writeFile(compositePath, compositeBytes);

      // A thumbnail made before layers existed has no background file of its
      // own: its composite stands in for it, as it always has.
      let bgPath = compositePath;
      if (existingLayers.backgroundPhoto?.filePath) {
        const ownBgPath = yield* assertUnderEffect(
          videoFilesDir,
          layerPath(existingLayers.backgroundPhoto.filePath, "-bg")
        );
        const bgBytes =
          typeof backgroundPhotoDataUrl === "string" &&
          backgroundPhotoDataUrl.startsWith("data:")
            ? decodeDataUrl(backgroundPhotoDataUrl)
            : compositeBytes;
        yield* fs.writeFile(ownBgPath, bgBytes);
        bgPath = ownBgPath;
      }

      let diagramLayer = null;
      if (
        typeof diagramDataUrl === "string" &&
        diagramDataUrl.startsWith("data:")
      ) {
        const diagPath = yield* assertUnderEffect(
          videoFilesDir,
          layerPath(existingLayers.diagram?.filePath, "-diagram")
        );
        yield* fs.writeFile(diagPath, decodeDataUrl(diagramDataUrl));
        diagramLayer = {
          filePath: diagPath,
          horizontalPosition:
            typeof diagramPosition === "number" ? diagramPosition : 50,
        };
      } else if (existingLayers.diagram?.filePath) {
        yield* removeUnderBestEffort(
          fs,
          videoFilesDir,
          existingLayers.diagram.filePath
        );
      }

      let cutoutLayer = null;
      if (
        typeof cutoutDataUrl === "string" &&
        cutoutDataUrl.startsWith("data:")
      ) {
        const cutoutPath = yield* assertUnderEffect(
          videoFilesDir,
          layerPath(existingLayers.cutout?.filePath, "-cutout")
        );
        yield* fs.writeFile(cutoutPath, decodeDataUrl(cutoutDataUrl));
        cutoutLayer = {
          filePath: cutoutPath,
          horizontalPosition:
            typeof cutoutPosition === "number" ? cutoutPosition : 50,
        };
      } else if (existingLayers.cutout?.filePath) {
        yield* removeUnderBestEffort(
          fs,
          videoFilesDir,
          existingLayers.cutout.filePath
        );
      }

      const layers = {
        backgroundPhoto: {
          horizontalPosition: 0,
          ...existingLayers.backgroundPhoto,
          filePath: bgPath,
        },
        diagram: diagramLayer,
        cutout: cutoutLayer,
      };

      const updated = yield* thumbnailOps.updateThumbnail(thumbnailId, {
        layers,
        filePath: compositePath,
      });

      return { success: true, thumbnailId: updated.id };
    }),
});
