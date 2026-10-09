import type { Database } from "./drizzle-service.server.js";
import { diagrams } from "../db/schema.js";
import { NotFoundError, UnknownDBServiceError } from "./db-service-errors.js";
import { eq } from "drizzle-orm";
import { Effect } from "effect";

/**
 * The Diagram, its row locked until `db`'s transaction ends. Every write that
 * reads the head and then replaces it takes this lock FIRST. The autosave
 * PATCH (`updateDiagramHead`) locks the same row, so a head read here cannot
 * be overwritten by one in between: an autosave either commits first — and is
 * the head this sees — or waits and is refused for a moved head.
 *
 * `db` must be a transaction: outside one, the lock ends with the statement.
 * `operation` names the caller in the NotFoundError.
 */
export const lockDiagram = Effect.fn("lockDiagram")(function* (
  db: Database,
  diagramId: string,
  operation: string
) {
  const [diagram] = yield* Effect.tryPromise({
    try: () =>
      db
        .select()
        .from(diagrams)
        .where(eq(diagrams.id, diagramId))
        .for("update"),
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });
  if (!diagram) {
    return yield* new NotFoundError({
      type: operation,
      params: { diagramId },
    });
  }
  return diagram;
});
