import { Effect } from "effect";
import { UnknownDBServiceError } from "./db-service-errors.js";
import type { JobFailure } from "./db-job-operations.server.js";

/** One database call on the job tables, its failure an `UnknownDBServiceError`. */
export const makeDbCall = <T>(fn: () => Promise<T>) =>
  Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });

/**
 * The message a Job whose dependency failed carries: copied from the browser
 * Upload Manager (deleted in batch 8).
 */
export const dependencyFailedMessage = (title: string) =>
  `Dependency "${title}" failed`;

/** What a Job that waited on `title` holds once that one has failed. */
export const dependencyFailure = (title: string): JobFailure => ({
  tag: "DependencyFailed",
  message: dependencyFailedMessage(title),
  cause: dependencyFailedMessage(title),
});
