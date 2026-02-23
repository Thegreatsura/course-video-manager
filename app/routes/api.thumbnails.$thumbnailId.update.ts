import { Console, Effect } from "effect";
import { FileSystem } from "@effect/platform";
import type { Route } from "./+types/api.thumbnails.$thumbnailId.update";
import { DBFunctionsService } from "@/services/db-service";
import { runtimeLive } from "@/services/layer";
import { withDatabaseDump } from "@/services/dump-service";
import { getStandaloneVideoFilePath } from "@/services/standalone-video-files";
import { data } from "react-router";

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

export const action = async (args: Route.ActionArgs) => {
  const { thumbnailId } = args.params;
  const body = await args.request.json();

  return Effect.gen(function* () {
    const { imageDataUrl, diagramDataUrl, diagramPosition } = body;

    if (typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:")) {
      return yield* Effect.die(
        data("imageDataUrl is required", { status: 400 })
      );
    }

    const db = yield* DBFunctionsService;
    const fs = yield* FileSystem.FileSystem;

    // Get existing thumbnail to find its file paths
    const existing = yield* db.getThumbnailById(thumbnailId);
    const existingLayers = existing.layers as {
      backgroundPhoto?: { filePath?: string };
      diagram?: { filePath?: string } | null;
      cutout?: { filePath?: string } | null;
    };

    // Overwrite composite PNG
    const compositeBytes = decodeDataUrl(imageDataUrl);
    if (existing.filePath) {
      yield* fs.writeFile(existing.filePath, compositeBytes);
    }

    // Overwrite background photo
    if (existingLayers.backgroundPhoto?.filePath) {
      yield* fs.writeFile(
        existingLayers.backgroundPhoto.filePath,
        compositeBytes
      );
    }

    // Handle diagram layer
    let diagramLayer = null;
    if (
      typeof diagramDataUrl === "string" &&
      diagramDataUrl.startsWith("data:")
    ) {
      const diagBytes = decodeDataUrl(diagramDataUrl);

      if (existingLayers.diagram?.filePath) {
        // Overwrite existing diagram file
        yield* fs.writeFile(existingLayers.diagram.filePath, diagBytes);
        diagramLayer = {
          filePath: existingLayers.diagram.filePath,
          horizontalPosition:
            typeof diagramPosition === "number" ? diagramPosition : 50,
        };
      } else {
        // New diagram — create file using thumbnail ID pattern
        const diagFilename = `thumbnail-${thumbnailId}-diagram.png`;
        const diagFilePath = getStandaloneVideoFilePath(
          existing.videoId,
          diagFilename
        );
        yield* fs.writeFile(diagFilePath, diagBytes);
        diagramLayer = {
          filePath: diagFilePath,
          horizontalPosition:
            typeof diagramPosition === "number" ? diagramPosition : 50,
        };
      }
    } else if (existingLayers.diagram?.filePath) {
      // Diagram was removed — delete the old file
      yield* fs
        .remove(existingLayers.diagram.filePath)
        .pipe(Effect.catchAll(() => Effect.void));
    }

    // Build updated layers JSON
    const layers = {
      backgroundPhoto: existingLayers.backgroundPhoto ?? {
        filePath: existing.filePath,
        horizontalPosition: 0,
      },
      diagram: diagramLayer,
      cutout: existingLayers.cutout ?? null,
    };

    // Update DB record
    const updated = yield* db.updateThumbnail(thumbnailId, {
      layers,
      filePath: existing.filePath,
    });

    return { success: true, thumbnailId: updated.id };
  }).pipe(
    withDatabaseDump,
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data("Thumbnail not found", { status: 404 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
