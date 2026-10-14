import { and, asc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { jobEvents } from "@cvm/core/db/schema";
import type { Database } from "@cvm/core/services/drizzle-service.server";
import { messageOf, StorageMoveFailedError } from "./move-io.server";
import { MOVE_PLACED_EVENT, type MovePlacedProof } from "./move-wire";

/**
 * PROOF OF PLACEMENT (#2179). Each copy a storage-move Job places, after its
 * read-back matched the source's SHA-256, is recorded as a `move-placed` Job
 * Event, so a resumed run need not read the source and the copy again.
 */

/** Record one proof for `jobId`. Rejects on a database error. */
export const placementRecorder =
  (db: Database, jobId: string) =>
  async (proof: MovePlacedProof): Promise<void> => {
    await db
      .insert(jobEvents)
      .values({ jobId, type: MOVE_PLACED_EVENT, data: { ...proof } });
  };

const isProof = (data: unknown): data is MovePlacedProof => {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.path === "string" &&
    typeof d.size === "number" &&
    typeof d.sourceMtimeMs === "number" &&
    typeof d.destMtimeMs === "number" &&
    typeof d.sha256 === "string"
  );
};

/** Every proof `jobId` recorded, in every run of it; the latest per path. */
export const recordedPlacements = (db: Database, jobId: string) =>
  Effect.tryPromise({
    try: async () => {
      const rows = await db
        .select({ data: jobEvents.data })
        .from(jobEvents)
        .where(
          and(eq(jobEvents.jobId, jobId), eq(jobEvents.type, MOVE_PLACED_EVENT))
        )
        .orderBy(asc(jobEvents.id));
      const byPath = new Map<string, MovePlacedProof>();
      for (const { data } of rows) {
        if (isProof(data)) byPath.set(data.path, data);
      }
      return [...byPath.values()];
    },
    catch: (cause) =>
      new StorageMoveFailedError({
        message: `Could not read the copies already placed: ${messageOf(cause)}`,
      }),
  });
