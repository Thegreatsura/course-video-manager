import { Config, Effect, Option } from "effect";
import { deleteOtherStorageBucket } from "@/packages/storage/delete";
import { DrizzleService } from "@/services/drizzle-service.server";
import { makeAction } from "@/services/route-action.server";
import {
  exportScratchDirectory,
  storageRootsConfig,
  VERIFY_RUN_DIR_ENV_KEY,
} from "@/services/storage-roots";

/**
 * Delete an Other Storage Bucket's files (#2112): the Overlay Render Cache,
 * export scratch, or the Exported Videos of no current Video. Every other
 * bucket is refused (409), as is any of these while an export is running
 * (ADR 0041). Files that fail a safety check or that Windows holds open are
 * left and listed in the answer.
 */
export const action = makeAction({
  errors: { StorageDeleteRefusedError: 409 },
  effect: ({ params }) =>
    Effect.gen(function* () {
      const db = yield* DrizzleService;
      const roots = yield* storageRootsConfig;
      // A verify-cvm run deletes only inside its own directory: its export
      // scratch is the temp folder Matt's own app encodes in.
      const verifyRunDir = yield* Config.option(
        Config.string(VERIFY_RUN_DIR_ENV_KEY)
      );
      return yield* deleteOtherStorageBucket({
        db,
        roots,
        bucketId: params.bucketId ?? "",
        scratchDir: exportScratchDirectory(),
        ...Option.match(verifyRunDir, {
          onNone: () => ({}),
          onSome: (dir) => (dir.trim() === "" ? {} : { confineTo: dir }),
        }),
      });
    }),
});
