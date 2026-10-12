import { Effect } from "effect";
import { recorderCommand } from "@/services/recorder-client/recorder-command";
import { recorderClient } from "@/services/recorder-client/live.server";
import { makeAction } from "@/services/route-action.server";

/**
 * Wake Spacedesk again, on a Short whose screen is unavailable: the recorder
 * wakes it and looks for its display again.
 */
export const action = makeAction({
  input: "none",
  errors: { RecorderCommandError: 409 },
  effect: ({ params }) =>
    Effect.gen(function* () {
      const videoId = params.videoId!;
      yield* recorderCommand(() => recorderClient().retryScreen(videoId));
      return { ok: true };
    }),
});
