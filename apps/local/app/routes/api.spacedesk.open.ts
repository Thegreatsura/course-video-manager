import { Effect } from "effect";
import { makeAction } from "@/services/route-action.server";
import { SpacedeskService } from "@/services/spacedesk-service";

/** Wakes the spacedesk display at the PC's fixed address. No body. */
export const action = makeAction({
  input: "none",
  effect: () =>
    Effect.gen(function* () {
      const spacedesk = yield* SpacedeskService;
      yield* spacedesk.wakeDisplay();
      return { success: true as const };
    }).pipe(
      Effect.catchAll((error) =>
        Effect.succeed({ success: false as const, message: error.message })
      )
    ),
});
