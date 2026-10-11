import { Config, Effect, Schema } from "effect";
import { homedir } from "node:os";
import path from "node:path";
import { InsertionPointSchema } from "@/services/clip-service.schemas";
import { recorderCommand } from "@/services/recorder-client/client.server";
import { recorderClient } from "@/services/recorder-client/live.server";
import { makeAction } from "@/services/route-action.server";

const startRecordingSchema = Schema.Struct({
  silenceLength: Schema.Literal("short", "long"),
  insertionPoint: InsertionPointSchema,
});

/**
 * Record, on a New recorder Video: the recorder service starts a Recording
 * Session in a folder of its own beside the OBS recordings. Answers once it
 * is recording; a refusal is a 409 with the recorder's reason.
 */
export const action = makeAction({
  input: "json",
  errors: { RecorderCommandError: 409 },
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const request =
        yield* Schema.decodeUnknown(startRecordingSchema)(payload);
      const folder = yield* Config.string("OBS_RECORDING_DIR").pipe(
        Effect.orElseSucceed(() => path.join(homedir(), "Videos"))
      );
      const videoId = params.videoId!;
      yield* recorderCommand(() =>
        recorderClient().startRecording(videoId, { ...request, folder })
      );
      return { ok: true };
    }),
});
