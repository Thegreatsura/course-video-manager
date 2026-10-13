import { Effect, Schema } from "effect";
import { planStorageOriginals } from "@/packages/storage/originals";
import { DrizzleService } from "@/services/drizzle-service.server";
import { makeLoader } from "@/services/route-action.server";
import { storageRootsConfig } from "@/services/storage-roots";

const OriginalsPlanQuery = Schema.Struct({ from: Schema.String });

/**
 * The "Delete originals" confirmation (#2110): how many of the bucket's
 * files on `from` have a same-size copy on another Storage Root, and their
 * bytes, or why it would not start (409). Reads only, and no file's
 * contents; deletes nothing. `?from=/mnt/d`.
 */
export const loader = makeLoader({
  errors: { StorageOriginalsRefusedError: 409 },
  effect: ({ params, request }) =>
    Effect.gen(function* () {
      const url = new URL(request.url);
      const query = yield* Schema.decodeUnknown(OriginalsPlanQuery)({
        from: url.searchParams.get("from"),
      });
      const db = yield* DrizzleService;
      const roots = yield* storageRootsConfig;
      return yield* planStorageOriginals({
        db,
        roots,
        bucketId: params.bucketId ?? "",
        from: query.from,
      });
    }),
});
