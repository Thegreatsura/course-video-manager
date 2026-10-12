import { FileSystem } from "@effect/platform";
import { desc, eq } from "drizzle-orm";
import { Data, Effect, Schema } from "effect";
import path from "node:path";
import { audioCalibrations } from "@/db/schema";
import {
  UNCALIBRATED_SILENCE_THRESHOLD,
  type SilenceThreshold,
} from "@/silence-detection-constants";
import {
  deriveThreshold,
  judgeCalibration,
  MEASUREMENT_WINDOWS,
  SCRIPT_SCHEDULE,
  SCRIPT_VERSION,
} from "@/audio-calibration-constants";
import type {
  BrowserTracePoint,
  SavedAudioCalibration,
} from "@/features/audio-calibration/calibration-wire";
import {
  buildCalibrationTimeline,
  calibrationDetectorRule,
} from "@/features/audio-calibration/calibration-timeline";
import { NotFoundError } from "@/services/db-service-errors";
import { FFmpegCommandsService } from "@/services/ffmpeg-commands";
import type { CalibrationMeasured } from "@/services/recorder-client/calibration-commands";
import { assertUnderEffect } from "@/services/assert-under";
import { dbCall } from "@/services/clip-service-handler.helpers";
import {
  DrizzleService,
  type Database,
} from "@/services/drizzle-service.server";

/** Beside a calibration's mic file: the browser's level trace and the prompt schedule. */
export const BROWSER_TRACE_FILE = "browser-trace.json";

/** The recorder service measured a run other than the one the page followed. */
export class CalibrationRunMismatchError extends Data.TaggedError(
  "CalibrationRunMismatchError"
)<{ readonly message: string }> {}

/**
 * Stores an Audio Calibration from its run's measurement, passed or failed:
 * judges the speech loudness against the band, derives the threshold, writes
 * the browser's trace beside the mic file (with the schedule its prompts
 * followed, in the same seconds), and saves the row.
 */
export const recordAudioCalibration = Effect.fn("recordAudioCalibration")(
  function* (
    db: Database,
    o: {
      calibrationId: string;
      measured: CalibrationMeasured;
      /** The folder (WSL path) the run's own folder was made in. */
      recordingsFolder: string;
      browserInputLabel: string | null;
      browserTrace: BrowserTracePoint[] | null;
    }
  ) {
    const { measured } = o;
    if (measured.calibrationId !== o.calibrationId)
      return yield* new CalibrationRunMismatchError({
        message: `The recorder service measured run ${measured.calibrationId}, not ${o.calibrationId}.`,
      });
    const judgement = judgeCalibration(measured);
    const thresholdDb = deriveThreshold(measured.speechLufs);
    // The mic file's folder comes from the recorder service: it must be in
    // the recordings folder the run was started in.
    const browserTracePath = yield* assertUnderEffect(
      o.recordingsFolder,
      path.join(path.dirname(measured.micFile), BROWSER_TRACE_FILE)
    );
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFileString(
      browserTracePath,
      JSON.stringify({
        scriptVersion: SCRIPT_VERSION,
        schedule: SCRIPT_SCHEDULE,
        measurementWindows: MEASUREMENT_WINDOWS,
        browserInputLabel: o.browserInputLabel,
        trace: o.browserTrace,
      })
    );
    const [row] = yield* dbCall(() =>
      db
        .insert(audioCalibrations)
        .values({
          id: measured.calibrationId,
          outcome: judgement.outcome,
          noiseFloorDb: measured.noiseFloorDb,
          speechLufs: measured.speechLufs,
          thresholdDb,
          recorderMic: measured.mic,
          browserInputLabel: o.browserInputLabel,
          scriptVersion: SCRIPT_VERSION,
          micFilePath: measured.micFile,
          browserTracePath,
        })
        .returning()
    );
    return toSaved(row!);
  }
);

type AudioCalibrationRow = typeof audioCalibrations.$inferSelect;

/** A stored row as the page shows it; the judgement is the stored speech loudness's. */
const toSaved = (row: AudioCalibrationRow): SavedAudioCalibration => ({
  id: row.id,
  createdAt: row.createdAt.toISOString(),
  outcome: row.outcome,
  judgement: judgeCalibration(row),
  noiseFloorDb: row.noiseFloorDb,
  speechLufs: row.speechLufs,
  thresholdDb: row.thresholdDb,
  recorderMic: row.recorderMic,
  browserInputLabel: row.browserInputLabel,
});

/** How many past Audio Calibrations the page lists. */
export const AUDIO_CALIBRATION_HISTORY_LIMIT = 20;

/** The latest Audio Calibrations, passed and failed, newest first. */
export const listAudioCalibrations = Effect.fn("listAudioCalibrations")(
  function* (db: Database) {
    const rows = yield* dbCall(() =>
      db
        .select()
        .from(audioCalibrations)
        .orderBy(desc(audioCalibrations.createdAt))
        .limit(AUDIO_CALIBRATION_HISTORY_LIMIT)
    );
    return rows.map(toSaved);
  }
);

const TimeWindowSchema = Schema.Struct({
  startSeconds: Schema.Number,
  endSeconds: Schema.Number,
});

/** `BROWSER_TRACE_FILE`, as `recordAudioCalibration` writes it. */
const TraceFileSchema = Schema.parseJson(
  Schema.Struct({
    schedule: Schema.Array(
      Schema.Union(
        Schema.Struct({
          kind: Schema.Literal("countdown", "silence"),
          ...TimeWindowSchema.fields,
        }),
        Schema.Struct({
          kind: Schema.Literal("read", "pause"),
          line: Schema.Number,
          ...TimeWindowSchema.fields,
        })
      )
    ),
    measurementWindows: Schema.Struct({
      silence: TimeWindowSchema,
      speech: Schema.Array(TimeWindowSchema),
    }),
    trace: Schema.NullOr(
      Schema.Array(
        Schema.Struct({ seconds: Schema.Number, peakDb: Schema.Number })
      )
    ),
  })
);

/**
 * A stored Audio Calibration's review timeline (#2081), redrawn from what
 * was kept: silencedetect is run on its mic file with its own threshold and
 * the short Silence Length, and its browser trace and prompt schedule are
 * read from the file beside it. Review only; it decides nothing.
 */
export const loadCalibrationTimeline = Effect.fn("loadCalibrationTimeline")(
  function* (db: Database, calibrationId: string) {
    const [row] = yield* dbCall(() =>
      db
        .select()
        .from(audioCalibrations)
        .where(eq(audioCalibrations.id, calibrationId))
    );
    if (!row)
      return yield* new NotFoundError({
        type: "audioCalibration",
        params: { calibrationId },
        message: `No Audio Calibration ${calibrationId}.`,
      });
    const fs = yield* FileSystem.FileSystem;
    const traceFile = yield* Schema.decodeUnknown(TraceFileSchema)(
      yield* fs.readFileString(row.browserTracePath)
    );
    const ffmpeg = yield* FFmpegCommandsService;
    const silencedetectOutput = yield* ffmpeg.detectSilence(row.micFilePath, {
      rule: calibrationDetectorRule(row.thresholdDb),
    });
    return buildCalibrationTimeline({
      calibrationId: row.id,
      thresholdDb: row.thresholdDb,
      traceFile,
      silencedetectOutput,
    });
  }
);

/**
 * The silence threshold a Recording Session that starts now cuts with: the
 * latest passed Audio Calibration's, or the fixed default while none has
 * passed. Read once, when recording starts; the Recording Session keeps it.
 */
export const currentSilenceThreshold = Effect.fn("currentSilenceThreshold")(
  function* (db: Database) {
    const latest = yield* dbCall(() =>
      db.query.audioCalibrations.findFirst({
        where: eq(audioCalibrations.outcome, "passed"),
        orderBy: desc(audioCalibrations.createdAt),
        columns: { id: true, thresholdDb: true },
      })
    );
    return latest
      ? ({
          thresholdDb: latest.thresholdDb,
          audioCalibrationId: latest.id,
        } satisfies SilenceThreshold)
      : UNCALIBRATED_SILENCE_THRESHOLD;
  }
);

/** `currentSilenceThreshold` on the app's database. */
export const silenceThresholdNow = Effect.gen(function* () {
  return yield* currentSilenceThreshold(yield* DrizzleService);
});
