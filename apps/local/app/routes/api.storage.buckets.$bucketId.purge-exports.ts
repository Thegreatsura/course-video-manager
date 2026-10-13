import { Config, Effect, Option, Schema } from "effect";
import { purgeExportedVideos } from "@/packages/storage/purge";
import { DrizzleService } from "@/services/drizzle-service.server";
import { makeAction } from "@/services/route-action.server";
import {
  storageRootsConfig,
  VERIFY_RUN_DIR_ENV_KEY,
} from "@/services/storage-roots";

const purgeSchema = Schema.Struct({
  /** Plan only: answer what would go, delete nothing (the confirmation). */
  dryRun: Schema.Boolean,
  /** The Exported Videos ticked on the per-bucket page; absent, the bucket. */
  exportPaths: Schema.optional(Schema.Array(Schema.String)),
});

/**
 * Purge a Course's, Standalone Videos' or Shorts' Exported Videos (#2111),
 * or (`dryRun`) say what a Purge would delete and which Videos it would skip.
 * Only Videos whose Footage is all found go; the rest are kept and listed.
 * Every other bucket is refused (409), as is any Purge while an export or
 * Publish is running (ADR 0041). Files that fail a safety check or that
 * Windows holds open are left and listed in the answer.
 */
export const action = makeAction({
  input: "json",
  errors: { StoragePurgeRefusedError: 409 },
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const body = yield* Schema.decodeUnknown(purgeSchema)(payload);
      const db = yield* DrizzleService;
      const roots = yield* storageRootsConfig;
      // A verify-cvm run deletes only inside its own directory.
      const verifyRunDir = yield* Config.option(
        Config.string(VERIFY_RUN_DIR_ENV_KEY)
      );
      return yield* purgeExportedVideos({
        db,
        roots,
        bucketId: params.bucketId ?? "",
        dryRun: body.dryRun,
        ...(body.exportPaths === undefined
          ? {}
          : { exportPaths: body.exportPaths }),
        ...Option.match(verifyRunDir, {
          onNone: () => ({}),
          onSome: (dir) => (dir.trim() === "" ? {} : { confineTo: dir }),
        }),
      });
    }),
});
