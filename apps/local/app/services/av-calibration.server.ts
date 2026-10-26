import { FileSystem } from "@effect/platform";
import { and, desc, eq } from "drizzle-orm";
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
  loudnessMisses,
  passesCurrentRules,
  type CalibrationInvalidReason,
  type LastPassedCalibration,
  type MeasurementWindows,
  runSchedule,
  SCRIPT_VERSION,
} from "@/av-calibration-constants";
import type { SavedAVCalibration } from "@/features/av-calibration/calibration-wire";
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
import { storageRootsConfig } from "./storage-roots";
import { resolveStoragePath } from "@/packages/storage/server";
import { toRootRelative } from "@/packages/storage";
import { DEFAULT_MIC_OFFSET_MS } from "@cvm/core/features/videos/recorder";
import {
  CLAP_STEP_WINDOW_MS,
  loudestMs,
  waveformPeaks,
  type ClapStepData,
} from "@/packages/clap-step";
import { readMicSamples } from "@/packages/clap-step/server";

/**
 * Beside a calibration's mic file: the prompt schedule its run followed and
 * the windows it was measured over. Runs before #2355 wrote it as
 * `browser-trace.json`, with the browser detector's trace in it too; their
 * rows keep that path.
 */
export const SCRIPT_FILE = "calibration-script.json";

/** The recorder service measured a run other than the one the page followed. */
export class CalibrationRunMismatchError extends Data.TaggedError(
  "CalibrationRunMismatchError"
)<{ readonly message: string }> {}

/** The Mic Offset was saved on a calibration other than the latest (#2137). */
export class NotLatestCalibrationError extends Data.TaggedError(
  "NotLatestCalibrationError"
)<{ readonly message: string }> {}

/** The clap step was saved on a calibration whose loudness check failed. */
export class LoudnessCheckFailedError extends Data.TaggedError(
  "LoudnessCheckFailedError"
)<{ readonly message: string }> {}

/**
 * Stores an AV Calibration from its run's measurement: judges the speech
 * loudness against the band and the true peak against its ceiling (the
 * loudness check), derives the threshold, writes the schedule its prompts
 * followed and the windows beside the mic file (`SCRIPT_FILE`, in the files'
 * seconds), and saves the row. It has no Mic Offset yet, so it is
 * stored failed: the clap step's Save (`saveMicOffset`) passes it (#2137).
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
  // No Mic Offset yet: Matt lines up a clap in the clap step (#2137), and
  // only its Save can pass the calibration.
  const judgement = judgeCalibration({
    speechLufs: measured.speechLufs,
    truePeakDb: measured.truePeakDb,
    micOffsetMs: null,
  });
  const thresholdDb = deriveThreshold(measured.speechLufs);
  const scriptFilePath = yield* assertUnderEffect(
    o.recordingsFolder,
    path.join(path.dirname(micFile), SCRIPT_FILE)
  );
  const fs = yield* FileSystem.FileSystem;
  yield* fs.writeFileString(
    scriptFilePath,
    JSON.stringify({
      scriptVersion: SCRIPT_VERSION,
      scriptStartSeconds: o.scriptStartSeconds,
      schedule: runSchedule(o.scriptStartSeconds),
      measurementWindows: o.windows,
    })
  );
  const storageRoots = yield* storageRootsConfig;
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
        scriptVersion: SCRIPT_VERSION,
        // Relative to its Storage Root, as every stored path is (ADR 0040).
        micFilePath: toRootRelative(micFile, storageRoots),
        scriptFilePath: toRootRelative(scriptFilePath, storageRoots),
        cameraDevice: measured.camera,
        clapsFound: null,
        clapSpreadMs: null,
        micOffsetMs: null,
        cameraFilePath: toRootRelative(cameraFile, storageRoots),
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
  cameraDevice: row.cameraDevice,
  clapsFound: row.clapsFound,
  clapSpreadMs: row.clapSpreadMs,
  micOffsetMs: row.micOffsetMs,
});

/** The newest AV Calibration's row, or null with none. */
const latestCalibrationRow = (db: Database) =>
  dbCall(() =>
    db
      .select()
      .from(avCalibrations)
      .orderBy(desc(avCalibrations.createdAt))
      .limit(1)
  ).pipe(Effect.map(([row]) => row ?? null));

/**
 * THE CLAP STEP'S SAVE (#2137): the Mic Offset Matt lined up, in whole ms,
 * stored on the latest AV Calibration (only the latest: an earlier one is
 * refused), which is judged again with it, so a calibration whose loudness
 * check passed now passes and unblocks recording. Only a new Recording
 * Session reads it (`pairMicOffsetMs`); an existing one keeps its own.
 */
export const saveMicOffset = Effect.fn("saveMicOffset")(function* (
  db: Database,
  o: { calibrationId: string; micOffsetMs: number }
) {
  const latest = yield* latestCalibrationRow(db);
  if (!latest || latest.id !== o.calibrationId)
    return yield* new NotLatestCalibrationError({
      message:
        "Only the latest AV Calibration's clap step can be saved: run a new one.",
    });
  if (loudnessMisses(latest).length > 0)
    return yield* new LoudnessCheckFailedError({
      message:
        "This AV Calibration failed its loudness check: run it again before the clap step.",
    });
  const micOffsetMs = Math.round(o.micOffsetMs);
  const judgement = judgeCalibration({ ...latest, micOffsetMs });
  const [row] = yield* dbCall(() =>
    db
      .update(avCalibrations)
      .set({ micOffsetMs, outcome: judgement.outcome })
      .where(eq(avCalibrations.id, latest.id))
      .returning()
  );
  return toSaved(row!);
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

/**
 * `SCRIPT_FILE`, as `recordAVCalibration` writes it. A run's file from
 * before #2355 also holds the browser detector's trace, which is ignored.
 */
const ScriptFileSchema = Schema.parseJson(
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
      claps: Schema.optional(TimeWindowSchema),
    }),
  })
);

/**
 * A stored AV Calibration's review timeline (#2081), redrawn from what
 * was kept: silencedetect is run on its mic file with its own threshold and
 * the short Silence Length, and its prompt schedule is read from the file
 * beside it (`SCRIPT_FILE`). Review only; it decides nothing.
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
    // Stored root-relative once the files are under a Storage Root; a run
    // in ~/Videos is read where it is.
    const storageRoots = yield* storageRootsConfig;
    const scriptPath = yield* resolveStoragePath(
      row.scriptFilePath,
      storageRoots,
      "AV Calibration script"
    );
    const micPath = yield* resolveStoragePath(
      row.micFilePath,
      storageRoots,
      "AV Calibration mic recording"
    );
    const scriptFile = yield* Schema.decodeUnknown(ScriptFileSchema)(
      yield* fs.readFileString(scriptPath)
    );
    const ffmpeg = yield* FFmpegCommandsService;
    const silencedetectOutput = yield* ffmpeg.detectSilence(micPath, {
      rule: calibrationDetectorRule(row.thresholdDb),
    });
    return buildCalibrationTimeline({
      calibrationId: row.id,
      thresholdDb: row.thresholdDb,
      scriptFile,
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
          cameraDevice: row.cameraDevice,
        } satisfies LastPassedCalibration)
      : null;
  }
);

/** A camera + mic device pair, by their DirectShow names. */
export type DevicePair = { camera: string; mic: string };

/**
 * The latest AV Calibration taken on `pair` that passes under today's rules
 * (`passesCurrentRules`), or null: the pair's one query, which its Mic
 * Offset is read from.
 */
export const lastPassedCalibrationForPair = Effect.fn(
  "lastPassedCalibrationForPair"
)(function* (db: Database, pair: DevicePair) {
  const rows = yield* dbCall(() =>
    db
      .select()
      .from(avCalibrations)
      .where(
        and(
          eq(avCalibrations.outcome, "passed"),
          eq(avCalibrations.cameraDevice, pair.camera),
          eq(avCalibrations.recorderMic, pair.mic)
        )
      )
      .orderBy(desc(avCalibrations.createdAt))
      .limit(LAST_PASSED_SCAN)
  );
  return rows.find(passesCurrentRules) ?? null;
});

/**
 * The Mic Offset for a pair (GLOSSARY.md, AV Calibration), in whole ms: its
 * latest passed AV Calibration's. A new Recording Session starts with it;
 * null when the pair was never measured (DEFAULT_MIC_OFFSET_MS then).
 */
export const pairMicOffsetMs = Effect.fn("pairMicOffsetMs")(function* (
  db: Database,
  pair: DevicePair
) {
  const offset = (yield* lastPassedCalibrationForPair(db, pair))?.micOffsetMs;
  return offset == null ? null : Math.round(offset);
});

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

/** The rate the clap step reads the mic at: 1 ms is 48 samples. */
const CLAP_STEP_SAMPLE_RATE = 48_000;

/**
 * The latest AV Calibration, for its clap step (#2137): refused for any
 * other, and for one whose loudness check failed.
 */
const clapStepRow = Effect.fn("clapStepRow")(function* (
  db: Database,
  calibrationId: string
) {
  const latest = yield* latestCalibrationRow(db);
  if (!latest || latest.id !== calibrationId)
    return yield* new NotLatestCalibrationError({
      message: "The clap step opens only on the latest AV Calibration.",
    });
  if (loudnessMisses(latest).length > 0)
    return yield* new LoudnessCheckFailedError({
      message:
        "This AV Calibration failed its loudness check: run it again before the clap step.",
    });
  return latest;
});

/** The latest calibration's mic and camera files, found on a Storage Root. */
export const clapStepFiles = Effect.fn("clapStepFiles")(function* (
  db: Database,
  calibrationId: string
) {
  const row = yield* clapStepRow(db, calibrationId);
  if (!row.cameraFilePath)
    return yield* new NotFoundError({
      type: "avCalibration",
      params: { calibrationId },
      message: `AV Calibration ${calibrationId} has no camera file.`,
    });
  const storageRoots = yield* storageRootsConfig;
  return {
    row,
    micFile: yield* resolveStoragePath(
      row.micFilePath,
      storageRoots,
      "AV Calibration mic recording"
    ),
    cameraFile: yield* resolveStoragePath(
      row.cameraFilePath,
      storageRoots,
      "AV Calibration camera recording"
    ),
  };
});

/**
 * What the clap step opens with (`ClapStepData`): the loudest point in the
 * run's clap window (the whole mic file, for a run whose script file has none),
 * the waveform around it, and the Mic Offset to start from: the one already
 * saved on it, else the pair's current one, else the default.
 */
export const loadClapStep = Effect.fn("loadClapStep")(function* (
  db: Database,
  calibrationId: string
) {
  const { row, micFile } = yield* clapStepFiles(db, calibrationId);
  const fs = yield* FileSystem.FileSystem;
  const scriptPath = yield* resolveStoragePath(
    row.scriptFilePath,
    yield* storageRootsConfig,
    "AV Calibration script"
  );
  const scriptFile = yield* Schema.decodeUnknown(ScriptFileSchema)(
    yield* fs.readFileString(scriptPath)
  );
  const window = scriptFile.measurementWindows.claps;
  const fromMs = window ? window.startSeconds * 1000 : 0;
  const toMs = window ? window.endSeconds * 1000 : 24 * 60 * 60 * 1000;
  const clapWindow = yield* readMicSamples({
    micFile,
    fromMs,
    toMs,
    sampleRate: CLAP_STEP_SAMPLE_RATE,
  });
  const loudest = fromMs + loudestMs(clapWindow, CLAP_STEP_SAMPLE_RATE);
  const startMs = Math.max(0, loudest - CLAP_STEP_WINDOW_MS);
  const around = yield* readMicSamples({
    micFile,
    fromMs: startMs,
    toMs: loudest + CLAP_STEP_WINDOW_MS,
    sampleRate: CLAP_STEP_SAMPLE_RATE,
  });
  const pairOffset = row.cameraDevice
    ? yield* pairMicOffsetMs(db, {
        camera: row.cameraDevice,
        mic: row.recorderMic,
      })
    : null;
  return {
    calibrationId: row.id,
    loudestMs: loudest,
    waveform: {
      startMs,
      peaks: waveformPeaks(around, CLAP_STEP_SAMPLE_RATE),
    },
    micOffsetMs:
      row.micOffsetMs !== null
        ? Math.round(row.micOffsetMs)
        : (pairOffset ?? DEFAULT_MIC_OFFSET_MS),
  } satisfies ClapStepData;
});
