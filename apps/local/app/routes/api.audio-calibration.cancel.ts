import { Effect } from "effect";
import { recorderCommand } from "@/services/recorder-client/recorder-command";
import { recorderClient } from "@/services/recorder-client/live.server";
import { makeAction } from "@/services/route-action.server";

/** Cancels the running Audio Calibration: its file is deleted and nothing is stored. */
export const action = makeAction({
  input: "json",
  errors: { RecorderCommandError: 409 },
  effect: () =>
    Effect.gen(function* () {
      yield* recorderCommand(() => recorderClient().cancelCalibration());
      return { ok: true };
    }),
});
