import { Data, Effect } from "effect";
import { storageBusyMessage } from "./delete-safety.server";
import { holdingStorageWrites } from "./storage-busy";

/** A delete was not started: nothing to delete, or the page is busy. */
export class StorageDeleteStartRefusedError extends Data.TaggedError(
  "StorageDeleteStartRefusedError"
)<{ readonly message: string }> {}

/**
 * Start a delete as a `storage-delete` Sidecar Job (#2157): while holding the
 * Storage page's write hold, run its dry run (`plan`, every refusal checked,
 * with the hold already ours), refuse when it would delete nothing, then
 * `enqueue` the Job. The Job checks every refusal again when it runs. A
 * Purge, a delete or a move started meanwhile refuses; once the Job is
 * queued they refuse because it is (`STORAGE_BUSY_JOB_KINDS`).
 */
export const startStorageDelete = <P, PE, A, E, R>(opts: {
  readonly plan: Effect.Effect<P, PE>;
  /** Why it would delete nothing, or null when it would delete something. */
  readonly nothingToDo: (plan: P) => string | null;
  readonly enqueue: (plan: P) => Effect.Effect<A, E, R>;
}): Effect.Effect<A, PE | E | StorageDeleteStartRefusedError, R> =>
  holdingStorageWrites(
    "a delete being started",
    (heldBy) =>
      new StorageDeleteStartRefusedError({
        message: storageBusyMessage(heldBy),
      }),
    Effect.gen(function* () {
      const plan = yield* opts.plan;
      const nothing = opts.nothingToDo(plan);
      if (nothing !== null) {
        return yield* new StorageDeleteStartRefusedError({ message: nothing });
      }
      return yield* opts.enqueue(plan);
    })
  );
