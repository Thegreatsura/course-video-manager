import { Effect } from "effect";
import { recorderCommand } from "@/services/recorder-client/recorder-command";
import {
  recorderClient,
  recordingFolder,
} from "@/services/recorder-client/live.server";
import { makeAction } from "@/services/route-action.server";

/**
 * Starts an Audio Calibration's run on the recorder service: its mic file goes
 * in a folder of its own under the recordings folder. Answers once it runs; a
 * refusal (recording, no mic, no recorder service) is a 409 with the reason.
 */
export const action = makeAction({
  input: "json",
  errors: { RecorderCommandError: 409 },
  effect: () =>
    Effect.gen(function* () {
      yield* recorderCommand(() =>
        recorderClient().startCalibration(recordingFolder())
      );
      return { ok: true };
    }),
});
