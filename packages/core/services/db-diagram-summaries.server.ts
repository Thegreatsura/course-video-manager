import { and, desc, eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import { clips, diagrams, diagramSnapshots } from "../db/schema.js";
import type { Database } from "./drizzle-service.server.js";
import { UnknownDBServiceError } from "./db-service-errors.js";

/** One Diagram as `cvm diagram list` shows it: never its drawings. */
export interface DiagramSummary {
  id: string;
  name: string;
  archived: boolean;
  /** Its timeline's length: snapshots not archived. */
  snapshotCount: number;
  /** Whether a Clip that is not archived pins any of its snapshots. */
  filmed: boolean;
  updatedAt: Date;
}

/**
 * Every Diagram with its snapshot count and whether it was filmed, newest
 * first by `updatedAt`. Read-only: it never touches a head or a snapshot.
 * Kept out of `db-diagram-operations.server.ts`, which is at its size budget;
 * the service hands it out as `listDiagramSummaries`.
 */
export const listDiagramSummariesIn = (db: Database) =>
  Effect.fn("listDiagramSummaries")(function* (opts?: {
    includeArchived?: boolean;
  }) {
    const live = and(
      eq(diagramSnapshots.diagramId, diagrams.id),
      eq(diagramSnapshots.archived, false)
    );
    return yield* Effect.tryPromise({
      try: (): Promise<DiagramSummary[]> =>
        db
          .select({
            id: diagrams.id,
            name: diagrams.name,
            archived: diagrams.archived,
            snapshotCount: sql<number>`(
              select count(*)::int from ${diagramSnapshots} where ${live}
            )`,
            filmed: sql<boolean>`exists (
              select 1 from ${diagramSnapshots}
              inner join ${clips} on ${eq(clips.diagramSnapshotId, diagramSnapshots.id)}
              where ${eq(diagramSnapshots.diagramId, diagrams.id)}
                and ${eq(clips.archived, false)}
            )`,
            updatedAt: diagrams.updatedAt,
          })
          .from(diagrams)
          .where(
            opts?.includeArchived ? undefined : eq(diagrams.archived, false)
          )
          .orderBy(desc(diagrams.updatedAt)),
      catch: (e) => new UnknownDBServiceError({ cause: e }),
    });
  });
