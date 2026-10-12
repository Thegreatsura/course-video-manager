import { Data, Effect } from "effect";
import { wakeSpacedesk } from "@/spacedesk-wake";

/**
 * SpacedeskService wakes the spacedesk virtual display at the PC's fixed
 * address with a single click. The handshake itself lives in the plain
 * `app/spacedesk-wake.ts`, which the recorder service calls too.
 */
export class SpacedeskError extends Data.TaggedError("SpacedeskError")<{
  cause: unknown;
  message: string;
}> {}

export class SpacedeskService extends Effect.Service<SpacedeskService>()(
  "SpacedeskService",
  {
    succeed: {
      wakeDisplay: Effect.fn("wakeDisplay")(function* () {
        yield* Effect.tryPromise({
          try: () => wakeSpacedesk(),
          catch: (cause) =>
            new SpacedeskError({
              cause,
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });
      }),
    },
  }
) {}
