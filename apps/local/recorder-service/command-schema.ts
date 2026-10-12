import { Schema } from "effect";
import type { VideoFormat } from "@/features/videos/video-format";
import { SCENES } from "../app/packages/scene-layout";
import { THRESHOLD_REQUIRED, type RecorderCommand } from "./protocol";

/**
 * What the recorder service accepts on its WebSocket: every `RecorderCommand`
 * (`protocol.ts`), decoded from JSON. Anything else is logged and dropped.
 */

const FORMATS = ["landscape", "short"] as const satisfies VideoFormat[];

const CalibrationWindowSchema = Schema.Struct({
  startSeconds: Schema.Number,
  endSeconds: Schema.Number,
});

/** Record's silence threshold and its Audio Calibration (none: null). */
const threshold = {
  thresholdDb: Schema.Number,
  audioCalibrationId: Schema.NullOr(Schema.String),
};

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
    ...threshold,
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
    ...threshold,
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

/**
 * A command that did not decode but must be answered, not dropped: a Record
 * (or the Stream Deck's prepare-record) with no silence threshold, from an
 * app server older than Audio Calibration. Its sender hears why.
 */
export const refusalOfUndecodable = (
  raw: string
): { command: RecorderCommand["type"]; message: string } | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const { type, thresholdDb } = parsed as Record<string, unknown>;
  if (
    (type === "record" || type === "prepare-record") &&
    typeof thresholdDb !== "number"
  )
    return { command: type, message: THRESHOLD_REQUIRED };
  return undefined;
};
