import { Schema } from "effect";
import type { VideoFormat } from "@/features/videos/video-format";
import { SCENES } from "../app/packages/scene-layout";

/**
 * What the recorder service accepts on its WebSocket: every `RecorderCommand`
 * (`protocol.ts`), decoded from JSON. Anything else is logged and dropped.
 */

const FORMATS = ["landscape", "short"] as const satisfies VideoFormat[];

const CalibrationWindowSchema = Schema.Struct({
  startSeconds: Schema.Number,
  endSeconds: Schema.Number,
});

const Command = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("open"),
    videoId: Schema.String,
    format: Schema.optional(Schema.Literal(...FORMATS)),
  }),
  Schema.Struct({
    type: Schema.Literal("record"),
    silenceLength: Schema.Literal("short", "long"),
    folder: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literal("stop") }),
  Schema.Struct({ type: Schema.Literal("close") }),
  Schema.Struct({ type: Schema.Literal("retry-camera") }),
  Schema.Struct({ type: Schema.Literal("retry-screen") }),
  Schema.Struct({
    type: Schema.Literal("switch-scene"),
    scene: Schema.Literal(...SCENES),
  }),
  Schema.Struct({
    type: Schema.Literal("prepare-record"),
    videoId: Schema.String,
    silenceLength: Schema.Literal("short", "long"),
    folder: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("stream-deck"),
    press: Schema.Union(
      Schema.Struct({ action: Schema.Literal("record", "stop") }),
      Schema.Struct({
        action: Schema.Literal("switch-scene"),
        scene: Schema.Literal(...SCENES),
      })
    ),
  }),
  Schema.Struct({
    type: Schema.Literal("replay"),
    recordingSessionId: Schema.String,
    afterSeq: Schema.Number,
  }),
  Schema.Struct({ type: Schema.Literal("start-meter", "stop-meter") }),
  Schema.Struct({
    type: Schema.Literal("start-calibration"),
    folder: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("finish-calibration"),
    silence: CalibrationWindowSchema,
    speech: Schema.Array(CalibrationWindowSchema),
  }),
  Schema.Struct({ type: Schema.Literal("cancel-calibration") })
);
export const decodeCommand = Schema.decodeUnknownEither(
  Schema.parseJson(Command)
);
