import { Effect, Schema } from "effect";
import { planStorageMove } from "@/packages/storage/move";
import { STORAGE_MOVE_KINDS } from "@/packages/storage/client";
import { DrizzleService } from "@/services/drizzle-service.server";
import { makeLoader } from "@/services/route-action.server";
import { storageRootsConfig } from "@/services/storage-roots";

const MovePlanQuery = Schema.Struct({
  kind: Schema.Literal(...STORAGE_MOVE_KINDS),
  target: Schema.String,
});

/**
 * The Storage page's move confirmation (#2109): what moving a Storage
 * Bucket's Footage, Exported Videos or Clip Mockups to `target` would copy,
 * the target's free space, and every reason it would not start. Reads only.
 * `?kind=footage&target=/mnt/e`.
 */
export const loader = makeLoader({
  effect: ({ params, request }) =>
    Effect.gen(function* () {
      const url = new URL(request.url);
      const query = yield* Schema.decodeUnknown(MovePlanQuery)({
        kind: url.searchParams.get("kind"),
        target: url.searchParams.get("target"),
      });
      const db = yield* DrizzleService;
      const roots = yield* storageRootsConfig;
      return yield* planStorageMove({
        db,
        roots,
        bucketId: params.bucketId ?? "",
        kind: query.kind,
        target: query.target,
        // `&path=raw-footage/a.mkv` (repeated): one file's move, per-file.
        ...(url.searchParams.getAll("path").length === 0
          ? {}
          : { paths: url.searchParams.getAll("path") }),
      });
    }),
});
