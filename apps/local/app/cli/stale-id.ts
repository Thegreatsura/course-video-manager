import { Effect } from "effect";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { NotFoundError, notFound } from "./errors";

/**
 * Why an id is missing, when the answer is "it belonged to an older Course
 * Version": the Draft's equivalent id and a sentence saying so.
 */
export interface StaleIdExplanation {
  readonly currentId: string;
  readonly message: string;
}

/**
 * Explain a Section or Lesson id that no longer resolves, if it was one of an
 * older Course Version's.
 *
 * Every Submit copies the Draft into a fresh Draft with fresh ids, and a
 * Discarded Pending Version takes its ids with it — so an id an agent read
 * before a Submit can stop resolving while its content lives on. A bare
 * NotFoundError there reads as "deleted"; this names the id to retry with.
 *
 * Best effort: a failed lookup leaves the plain NotFoundError, never a worse
 * error. Resolves undefined when nothing descends from `id`.
 */
export const explainStaleId =
  (entity: "section" | "lesson") =>
  (
    id: string
  ): Effect.Effect<
    StaleIdExplanation | undefined,
    never,
    VersionOperationsService
  > =>
    Effect.flatMap(VersionOperationsService, (svc) =>
      svc.findVersionSuccessor(entity, id)
    ).pipe(
      Effect.map((successor) => {
        if (successor === null) return undefined;
        const where =
          successor.commitState === "draft"
            ? `its equivalent in the current Draft is ${successor.id}`
            : `its latest copy is ${successor.id}, in a ${successor.commitState} version (the Draft has no copy of it)`;
        const archived = successor.archived ? ` (archived there)` : "";
        return {
          currentId: successor.id,
          message: `${entity} ${id} belongs to an older Course Version that no longer exists; ${where}${archived}`,
        };
      }),
      Effect.orElseSucceed(() => undefined)
    );

/**
 * Fail with the CLI NotFoundError for `id`, carrying the Draft's equivalent id
 * when `id` belonged to an older Course Version (see {@link explainStaleId}).
 * The drop-in for `notFound(entity, id)` on a Section's or Lesson's own id.
 */
export const notFoundOrStale = (
  entity: "section" | "lesson",
  id: string
): Effect.Effect<never, NotFoundError, VersionOperationsService> =>
  Effect.flatMap(explainStaleId(entity)(id), (why) =>
    Effect.fail(
      why === undefined
        ? notFound(entity, id)
        : new NotFoundError({ entity, id, ...why })
    )
  );
