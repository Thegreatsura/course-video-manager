import { Effect } from "effect";
import { DiagramOperationsService } from "@/services/db-diagram-operations.server";
import { makeAction } from "@/services/route-action.server";
import { data } from "react-router";

export const action = makeAction({
  input: "json",
  errors: { NotFoundError: 404 },
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const body = payload as Record<string, unknown>;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return yield* Effect.die(
          data("Body must be a JSON object", { status: 400 })
        );
      }

      const preserved =
        typeof body.preserved === "boolean" ? body.preserved : undefined;
      const clipId = typeof body.clipId === "string" ? body.clipId : undefined;
      // A canvas the server wouldn't take as the head, kept as it stands.
      const scene =
        body.scene &&
        typeof body.scene === "object" &&
        !Array.isArray(body.scene)
          ? body.scene
          : undefined;
      if (scene && clipId) {
        return yield* Effect.die(
          data("A clip's snapshot is of the head, not a scene", { status: 400 })
        );
      }
      const thumbnailBase64 =
        typeof body.thumbnailPngBase64 === "string"
          ? body.thumbnailPngBase64
          : undefined;

      if (preserved && !thumbnailBase64) {
        return yield* Effect.die(
          data("Preserved snapshots require a thumbnail", { status: 400 })
        );
      }

      // `Buffer.from(_, "base64")` never throws: it skips characters outside
      // the alphabet, so there is no invalid encoding to reject here.
      const thumbnailPng = thumbnailBase64
        ? Buffer.from(thumbnailBase64, "base64")
        : undefined;

      const diagramOps = yield* DiagramOperationsService;

      let snapshot;
      if (clipId) {
        snapshot = yield* diagramOps.createSnapshotForClip(
          params.diagramId!,
          clipId,
          { thumbnailPng }
        );
      } else {
        snapshot = yield* diagramOps.createSnapshot(params.diagramId!, {
          preserved,
          thumbnailPng,
          scene,
        });
      }

      return data({ snapshot });
    }),
});
