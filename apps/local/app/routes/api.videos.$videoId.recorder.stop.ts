import { Effect } from "effect";
import { recorderCommand } from "@/services/recorder-client/recorder-command";
import { recorderClient } from "@/services/recorder-client/live.server";
import { makeAction } from "@/services/route-action.server";

/** Stop, on a CVM recorder Video: answers once the files are closed. */
export const action = makeAction({
  input: "none",
  errors: { RecorderCommandError: 409 },
  effect: ({ params }) =>
    Effect.gen(function* () {
      const videoId = params.videoId!;
      yield* recorderCommand(() => recorderClient().stopRecording(videoId));
      return { ok: true };
    }),
});
