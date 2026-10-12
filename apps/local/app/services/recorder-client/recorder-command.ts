import { Data, Effect } from "effect";

/** Why a recorder client command (`client.server.ts`) did not happen. */

export class RecorderUnavailableError extends Error {}
export class RecorderRefusedError extends Error {}

/** Record or Stop was refused, or the recorder service did not answer. */
export class RecorderCommandError extends Data.TaggedError(
  "RecorderCommandError"
)<{ readonly message: string; readonly cause: unknown }> {}

/** A recorder client call, as an Effect a route can run. */
export const recorderCommand = (run: () => Promise<void>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new RecorderCommandError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });
