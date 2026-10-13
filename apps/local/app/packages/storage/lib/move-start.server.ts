import { Effect } from "effect";
import type { Database } from "@cvm/core/services/drizzle-service.server";
import type { StorageMoveKind, StorageMovePlan } from "./move-wire";
import {
  StorageMoveFailedError,
  StorageMoveRefusedError,
} from "./move-io.server";
import { planStorageMove } from "./move-plan.server";
import { holdingStorageWrites } from "./storage-busy";
import type { StorageRoots } from "./storage-roots";

const refused = (plan: Pick<StorageMovePlan, "refusals">) =>
  new StorageMoveRefusedError({
    refusals: plan.refusals,
    message: `Not moved: ${plan.refusals.map((r) => r.message).join("; ")}`,
  });

/**
 * Start a move (#2109): check every refusal, then `enqueue` its
 * `storage-move` Job — both while holding the Storage page's write hold, so
 * no Purge or delete is part-way through when the move is queued, and none
 * starts until it is (after which they refuse while the move is queued or
 * running).
 */
export const startStorageMove = <A, E, R>(opts: {
  readonly db: Database;
  readonly roots: StorageRoots;
  readonly bucketId: string;
  readonly kind: StorageMoveKind;
  readonly target: string;
  /** Only these files (root-relative), and their companions; absent, all. */
  readonly paths?: readonly string[];
  readonly enqueue: (plan: StorageMovePlan) => Effect.Effect<A, E, R>;
}): Effect.Effect<A, E | StorageMoveRefusedError | StorageMoveFailedError, R> =>
  holdingStorageWrites(
    "a move being started",
    (heldBy) =>
      refused({
        refusals: [
          {
            reason: "storage-busy",
            message: `${heldBy} is under way on the Storage page; try again once it has finished`,
          },
        ],
      }),
    Effect.gen(function* () {
      const plan = yield* planStorageMove({ ...opts, holdIsOurs: true });
      if (plan.refusals.length > 0) return yield* refused(plan);
      return yield* opts.enqueue(plan);
    })
  );
