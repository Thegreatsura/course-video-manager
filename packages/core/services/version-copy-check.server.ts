import { Effect } from "effect";
import type { Database } from "./drizzle-service.server.js";
import {
  UnknownDBServiceError,
  VersionCopyIncompleteError,
} from "./db-service-errors.js";
import {
  COPY_PATHS,
  countCarriedBelow,
  tableByShortName,
} from "./version-copy-manifest.js";

/**
 * The runtime half of the copy guard: run inside the Submit transaction, after
 * the copy. Every table the manifest says Submit copies must have exactly as
 * many rows below the new Draft as below its source — the live ones, and the
 * archived Clips (`keepsArchived`) with their Transcript Words, Web Links and
 * Overlays — or Submit fails with
 * `VersionCopyIncompleteError` and the transaction rolls back. A table a
 * future copy forgets therefore refuses the Submit instead of silently
 * vanishing from the next Draft. Two count queries per table, scoped to one
 * Version each.
 */
export const assertCopyComplete = (
  transaction: Database,
  sourceVersionId: string,
  copyVersionId: string
) =>
  Effect.gen(function* () {
    const { tables } = COPY_PATHS.submit;
    for (const [name, decision] of Object.entries(tables)) {
      if (decision !== "copied") continue;
      const table = tableByShortName(name);
      const [sourceCount, copyCount] = yield* Effect.tryPromise({
        try: async () => [
          await countCarriedBelow(
            transaction,
            "submit",
            table,
            sourceVersionId
          ),
          await countCarriedBelow(transaction, "submit", table, copyVersionId),
        ],
        catch: (cause) => new UnknownDBServiceError({ cause }),
      });
      if (sourceCount !== copyCount) {
        return yield* new VersionCopyIncompleteError({
          table: name,
          sourceCount: sourceCount!,
          copyCount: copyCount!,
          sourceVersionId,
        });
      }
    }
  });
