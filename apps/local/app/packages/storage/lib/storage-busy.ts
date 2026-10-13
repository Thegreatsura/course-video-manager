import { Effect } from "effect";

/**
 * One Storage page write at a time, in this process: a Purge, a delete, or
 * the start of a move (its last checks and its enqueue). A move's own copy
 * runs later, in the Sidecar, as a `storage-move` Job — and a Purge or a
 * delete refuses while one is queued or running (`STORAGE_BUSY_JOB_KINDS`).
 * Between the two, nothing deletes from a folder a move is about to copy,
 * and no move is queued while a delete is part-way through (#2109).
 */
let holder: string | null = null;

/** What holds the Storage page's write hold right now, or null. */
export const storageWritesHeldBy = (): string | null => holder;

/**
 * Run `effect` holding the Storage page's write hold, as `what` ("a Purge").
 * Already held: fails with `busy(whoever holds it)` and runs nothing.
 */
export const holdingStorageWrites = <A, E, R, B>(
  what: string,
  busy: (heldBy: string) => B,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E | B, R> =>
  Effect.suspend((): Effect.Effect<A, E | B, R> => {
    if (holder !== null) return Effect.fail(busy(holder));
    holder = what;
    return effect.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          holder = null;
        })
      )
    );
  });
