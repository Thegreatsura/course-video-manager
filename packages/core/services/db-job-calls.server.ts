import { Effect } from "effect";
import { UnknownDBServiceError } from "./db-service-errors.js";

/** One database call on the job tables, its failure an `UnknownDBServiceError`. */
export const makeDbCall = <T>(fn: () => Promise<T>) =>
  Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });
