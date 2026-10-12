import { FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { desc, eq } from "drizzle-orm";
import { Data, Effect, Schema } from "effect";
import path from "node:path";
import { avCalibrations } from "@/db/schema";
import {
  UNCALIBRATED_SILENCE_THRESHOLD,
  type SilenceThreshold,
} from "@/silence-detection-constants";
import {
  calibrationValidity,
  deriveThreshold,
  describeCalibrationRefusal,
  judgeCalibration,
  passesCurrentRules,
  type CalibrationInvalidReason,
  type LastPassedCalibration,
  type MeasurementWindows,
  runSchedule,
  SCRIPT_VERSION,
} from "@/av-calibration-constants";
import { detectClaps, type ClapMatch } from "@/packages/clap-detection";
import type {
  BrowserTracePoint,
  SavedAVCalibration,
} from "@/features/av-calibration/calibration-wire";
import {
  buildCalibrationTimeline,
  calibrationDetectorRule,
} from "@/features/av-calibration/calibration-timeline";
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

/** No clap found: what a failed clap detection stores. */
const NO_CLAPS: ClapMatch = {
  claps: [],
  found: 0,
  spreadMs: null,
  micOffsetMs: null,
};

/**
 * Stores an AV Calibration from its run's measurement, passed or failed:
 * finds the claps in its mic and camera files over the clap window
 * (`clap-detection`) for the Mic Offset, judges the speech loudness against
 * the band, the true peak against its ceiling and the claps against their
 * rule, derives the threshold, writes the browser's trace beside the mic
 * file (with the schedule its prompts followed, in the files' seconds), and
 * saves the row with whatever it measured.
 */
export const recordAVCalibration = Effect.fn("recordAVCalibration")(function* (
  db: Database,
  o: {
    calibrationId: string;
    measured: CalibrationMeasured;
    /** The windows the page measured over, in the run's file seconds. */
    windows: MeasurementWindows;
    /** Where the script started in the run's files (`calibration-started`). */
    scriptStartSeconds: number;
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
  // The files come from the recorder service: they must be in the
  // recordings folder the run was started in.
  const micFile = yield* assertUnderEffect(
    o.recordingsFolder,
    measured.micFile
  );
  const cameraFile = yield* assertUnderEffect(
    o.recordingsFolder,
    measured.cameraFile
  );
  const claps = yield* detectClaps({
    micFile,
    cameraFile,
    window: o.windows.claps,
  }).pipe(
    Effect.provide(NodeContext.layer),
    Effect.catchTag("ClapDetectionError", (e) =>
      Effect.logError(`Clap detection failed: ${e.message}`).pipe(
        Effect.as(NO_CLAPS)
      )
    )
  );
  const judgement = judgeCalibration({
    speechLufs: measured.speechLufs,
    truePeakDb: measured.truePeakDb,
    clapsFound: claps.found,
    clapSpreadMs: claps.spreadMs,
  });
  const thresholdDb = deriveThreshold(measured.speechLufs);
  const browserTracePath = yield* assertUnderEffect(
    o.recordingsFolder,
    path.join(path.dirname(micFile), BROWSER_TRACE_FILE)
  );
  const fs = yield* FileSystem.FileSystem;
  yield* fs.writeFileString(
    browserTracePath,
    JSON.stringify({
      scriptVersion: SCRIPT_VERSION,
      scriptStartSeconds: o.scriptStartSeconds,
      schedule: runSchedule(o.scriptStartSeconds),
      measurementWindows: o.windows,
      browserInputLabel: o.browserInputLabel,
      trace: o.browserTrace,
      claps: claps.claps,
    })
  );
  const [row] = yield* dbCall(() =>
    db
      .insert(avCalibrations)
      .values({
        id: measured.calibrationId,
        outcome: judgement.outcome,
        noiseFloorDb: measured.noiseFloorDb,
        speechLufs: measured.speechLufs,
        truePeakDb: measured.truePeakDb,
        thresholdDb,
        recorderMic: measured.mic,
        browserInputLabel: o.browserInputLabel,
        scriptVersion: SCRIPT_VERSION,
        micFilePath: micFile,
        browserTracePath,
        cameraDevice: measured.camera,
        clapsFound: claps.found,
        clapSpreadMs: claps.spreadMs,
        micOffsetMs: claps.micOffsetMs,
        cameraFilePath: cameraFile,
      })
      .returning()
  );
  return toSaved(row!);
});

type AVCalibrationRow = typeof avCalibrations.$inferSelect;

/**
 * A stored row as the page shows it; the judgement is its stored loudness,
 * peak and claps', under today's rules (a row from before the -27 LUFS target
 * may now read as too loud; one from before the clap step fails).
 */
const toSaved = (row: AVCalibrationRow): SavedAVCalibration => ({
  id: row.id,
  createdAt: row.createdAt.toISOString(),
  outcome: row.outcome,
  judgement: judgeCalibration(row),
  noiseFloorDb: row.noiseFloorDb,
  speechLufs: row.speechLufs,
  truePeakDb: row.truePeakDb,
  thresholdDb: row.thresholdDb,
  recorderMic: row.recorderMic,
  browserInputLabel: row.browserInputLabel,
  cameraDevice: row.cameraDevice,
  clapsFound: row.clapsFound,
  clapSpreadMs: row.clapSpreadMs,
  micOffsetMs: row.micOffsetMs,
});

/** How many past AV Calibrations the page lists. */
export const AV_CALIBRATION_HISTORY_LIMIT = 20;

/** The latest AV Calibrations, passed and failed, newest first. */
export const listAVCalibrations = Effect.fn("listAVCalibrations")(function* (
  db: Database
) {
  const rows = yield* dbCall(() =>
    db
      .select()
      .from(avCalibrations)
      .orderBy(desc(avCalibrations.createdAt))
      .limit(AV_CALIBRATION_HISTORY_LIMIT)
  );
  return rows.map(toSaved);
});

const TimeWindowSchema = Schema.Struct({
  startSeconds: Schema.Number,
  endSeconds: Schema.Number,
});

/** `BROWSER_TRACE_FILE`, as `recordAVCalibration` writes it. */
const TraceFileSchema = Schema.parseJson(
  Schema.Struct({
    schedule: Schema.Array(
      Schema.Union(
        Schema.Struct({
          kind: Schema.Literal("countdown", "silence", "clap-ready", "loud"),
          ...TimeWindowSchema.fields,
        }),
        Schema.Struct({
          kind: Schema.Literal("clap"),
          clap: Schema.Number,
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
 * A stored AV Calibration's review timeline (#2081), redrawn from what
 * was kept: silencedetect is run on its mic file with its own threshold and
 * the short Silence Length, and its browser trace and prompt schedule are
 * read from the file beside it. Review only; it decides nothing.
 */
export const loadCalibrationTimeline = Effect.fn("loadCalibrationTimeline")(
  function* (db: Database, calibrationId: string) {
    const [row] = yield* dbCall(() =>
      db
        .select()
        .from(avCalibrations)
        .where(eq(avCalibrations.id, calibrationId))
    );
    if (!row)
      return yield* new NotFoundError({
        type: "avCalibration",
        params: { calibrationId },
        message: `No AV Calibration ${calibrationId}.`,
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
 * How many recent passed calibrations are re-judged to find the latest one
 * that passes under today's rules. A pass that no longer passes is history,
 * so a handful is plenty.
 */
const LAST_PASSED_SCAN = 50;

/**
 * The latest AV Calibration that passes under today's rules
 * (`passesCurrentRules`: an old -21 LUFS pass, or one from before the peak
 * check, does not), or null. What the gate and every Record go by.
 */
export const lastPassedCalibration = Effect.fn("lastPassedCalibration")(
  function* (db: Database) {
    const rows = yield* dbCall(() =>
      db
        .select()
        .from(avCalibrations)
        .where(eq(avCalibrations.outcome, "passed"))
        .orderBy(desc(avCalibrations.createdAt))
        .limit(LAST_PASSED_SCAN)
    );
    const row = rows.find(passesCurrentRules);
    return row
      ? ({
          id: row.id,
          createdAtMs: row.createdAt.getTime(),
          thresholdDb: row.thresholdDb,
          recorderMic: row.recorderMic,
          browserInputLabel: row.browserInputLabel,
          cameraDevice: row.cameraDevice,
        } satisfies LastPassedCalibration)
      : null;
  }
);

/** `lastPassedCalibration` on the app's database. */
export const lastPassedCalibrationNow = Effect.gen(function* () {
  return yield* lastPassedCalibration(yield* DrizzleService);
});

/**
 * The silence threshold a take cuts with under `lastPassed` (or the fixed
 * default with none: the gate refuses that take anyway).
 */
export const silenceThresholdOf = (
  lastPassed: LastPassedCalibration | null
): SilenceThreshold =>
  lastPassed
    ? { thresholdDb: lastPassed.thresholdDb, avCalibrationId: lastPassed.id }
    : UNCALIBRATED_SILENCE_THRESHOLD;

/** Record refused by the gate: no fresh AV Calibration (ADR 0038). */
export class AVCalibrationRequiredError extends Data.TaggedError(
  "AVCalibrationRequiredError"
)<{ readonly message: string; readonly reason: CalibrationInvalidReason }> {}

/**
 * THE GATE, on the app server: Record needs a calibration passed under
 * today's rules and less than 7 days old at `now`. The camera + mic pair is
 * the recorder service's to check (it alone knows which pair it records), at
 * the moment it starts recording. Answers the calibration Record goes by.
 */
export const requireFreshAVCalibration = Effect.fn("requireFreshAVCalibration")(
  function* (db: Database, now: Date) {
    const validity = calibrationValidity(
      yield* lastPassedCalibration(db),
      {},
      now.getTime()
    );
    if (!validity.valid)
      return yield* new AVCalibrationRequiredError({
        message: describeCalibrationRefusal(validity.reason),
        reason: validity.reason,
      });
    return validity.calibration;
  }
);
