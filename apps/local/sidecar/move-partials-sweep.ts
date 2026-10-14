import { Effect } from "effect";
import { DrizzleService } from "@/services/drizzle-service.server";
import { storageRootsConfig } from "@/services/storage-roots";
import { sweepEndedMovePartials } from "@/packages/storage/move";

/**
 * THE MOVE-PARTIALS SWEEP (#2169): on start and after every recovery tick,
 * remove the `.cvm-move-partial` files of every storage-move Job that is no
 * longer queued or running — a crash, a kill or a lapsed lease leaves them
 * where its run stopped. Only partials the Job recorded are deleted
 * (`@/packages/storage/move`); an Offline drive is tried again next tick.
 */
export const sweepMovePartials = Effect.gen(function* () {
  const db = yield* DrizzleService;
  const roots = yield* storageRootsConfig;
  const swept = yield* sweepEndedMovePartials({ db, roots });
  for (const { jobId, removed } of swept) {
    if (removed.files > 0 || removed.kept.length > 0) {
      yield* Effect.logInfo("move partials: swept", {
        jobId,
        files: removed.files,
        bytes: removed.bytes,
        kept: removed.kept,
      });
    }
  }
}).pipe(
  Effect.catchAllCause((cause) =>
    Effect.logWarning("move partials: not swept this time", cause)
  )
);
