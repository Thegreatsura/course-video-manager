/**
 * THE NUMBERS of an AV Calibration (#2077, "The numbers"), beside the one
 * definition of silence (`silence-detection-constants.ts`) whose threshold an
 * AV Calibration will set. Every number the AV Calibration page and its
 * judgement use lives here, as a named constant.
 */

/**
 * The speech loudness Matt sets his mic to, in LUFS. Deliberately quiet: his
 * voice is dynamic, at -21 his peaks reached -7.9 dBTP and at -17.5 he
 * clipped, and the export normalizes loudness, so recording low costs
 * nothing (#2077, revised from -21).
 */
export const TARGET_LOUDNESS_LUFS = -27;

/** How far either side of the target still passes, in dB. */
export const TARGET_TOLERANCE_DB = 2;

/** The target band, inclusive at both ends: -29 to -25 LUFS. */
export const TARGET_BAND = {
  lowLufs: TARGET_LOUDNESS_LUFS - TARGET_TOLERANCE_DB,
  highLufs: TARGET_LOUDNESS_LUFS + TARGET_TOLERANCE_DB,
} as const;

/** Where a loudness sits against the target band, and by how many dB. */
export type BandPosition =
  /** `byDb`: how far below the band's low edge. */
  | { position: "below"; byDb: number }
  /** `byDb`: from the target, negative under it. */
  | { position: "inside"; byDb: number }
  /** `byDb`: how far above the band's high edge. */
  | { position: "above"; byDb: number };

export const bandPosition = (lufs: number): BandPosition => {
  if (lufs < TARGET_BAND.lowLufs)
    return { position: "below", byDb: TARGET_BAND.lowLufs - lufs };
  if (lufs > TARGET_BAND.highLufs)
    return { position: "above", byDb: lufs - TARGET_BAND.highLufs };
  return { position: "inside", byDb: lufs - TARGET_LOUDNESS_LUFS };
};

/** The silence threshold is this far below the speech loudness, in dB. */
export const THRESHOLD_OFFSET_DB = 16;

/**
 * Where a derived threshold is clamped, in dB. A passing calibration lands at
 * -45 to -41 (the band's quiet edge sits exactly on the low clamp), so the
 * clamp only guards a bad measurement.
 */
export const THRESHOLD_CLAMP = { lowDb: -45, highDb: -30 } as const;

/** The silence threshold an AV Calibration sets: speech - 16 dB, clamped. */
export const deriveThreshold = (speechLufs: number): number =>
  Math.min(
    Math.max(speechLufs - THRESHOLD_OFFSET_DB, THRESHOLD_CLAMP.lowDb),
    THRESHOLD_CLAMP.highDb
  );

/**
 * The loudest a calibration's take may peak anywhere, in dBTP (ebur128's true
 * peak): headroom for the loud line, so an animated take does not clip.
 */
export const MAX_TRUE_PEAK_DBTP = -6;

/** How many claps the session prompts. */
export const CLAPS_PROMPTED = 5;
/** How many of them must be found in both the mic and the camera. */
export const MIN_CLAPS_FOUND = 3;
/** The camera's frame rate as the CVM recorder records it (29.97). */
export const CAMERA_FPS = 30000 / 1001;
/**
 * The furthest the paired claps' offsets may spread (max - min), in ms: one
 * camera frame. Wider, and the Mic Offset is not to be trusted.
 */
export const MAX_CLAP_SPREAD_MS = 1000 / CAMERA_FPS;

export type CalibrationOutcome = "passed" | "failed";

/** One reason a calibration failed. */
export type CalibrationMiss =
  /** The speech loudness is outside the band; `byDb` past its edge. */
  | { kind: "too-quiet" | "too-loud"; byDb: number }
  /** The take's true peak is over `MAX_TRUE_PEAK_DBTP`, by `byDb`. */
  | { kind: "peak-too-high"; truePeakDb: number; byDb: number }
  /** Fewer than `MIN_CLAPS_FOUND` claps found in both the mic and the camera. */
  | { kind: "too-few-claps"; found: number }
  /** The paired claps' offsets spread over `MAX_CLAP_SPREAD_MS`. */
  | { kind: "claps-disagree"; spreadMs: number }
  /** Taken before the clap step (an Audio Calibration): no Mic Offset. */
  | { kind: "no-clap-step" };

/** Whether a calibration passed, and if not, every way it missed. */
export type CalibrationJudgement =
  | { outcome: "passed" }
  | { outcome: "failed"; misses: [CalibrationMiss, ...CalibrationMiss[]] };

/** What a calibration is judged on, as measured and as stored. */
export type CalibrationMeasures = {
  speechLufs: number;
  /** null: stored before the peak check. */
  truePeakDb: number | null;
  /** null: stored before the clap step. */
  clapsFound: number | null;
  /** null: no clap found (or none looked for). */
  clapSpreadMs: number | null;
};

/**
 * Passed when the speech loudness is inside the target band, edges included,
 * the take's true peak is at or under `MAX_TRUE_PEAK_DBTP`, at least
 * `MIN_CLAPS_FOUND` claps were found, and their offsets agree within one
 * camera frame. Every miss is listed, so one re-run can fix them all. A
 * calibration stored before the peak check (`truePeakDb` null) is not judged
 * on the peak; one stored before the clap step (`clapsFound` null) fails.
 */
export const judgeCalibration = (
  m: CalibrationMeasures
): CalibrationJudgement => {
  const misses: CalibrationMiss[] = [];
  const band = bandPosition(m.speechLufs);
  if (band.position === "below")
    misses.push({ kind: "too-quiet", byDb: band.byDb });
  if (band.position === "above")
    misses.push({ kind: "too-loud", byDb: band.byDb });
  if (m.truePeakDb !== null && m.truePeakDb > MAX_TRUE_PEAK_DBTP)
    misses.push({
      kind: "peak-too-high",
      truePeakDb: m.truePeakDb,
      byDb: m.truePeakDb - MAX_TRUE_PEAK_DBTP,
    });
  if (m.clapsFound === null) misses.push({ kind: "no-clap-step" });
  else if (m.clapsFound < MIN_CLAPS_FOUND)
    misses.push({ kind: "too-few-claps", found: m.clapsFound });
  if (m.clapSpreadMs !== null && m.clapSpreadMs > MAX_CLAP_SPREAD_MS)
    misses.push({ kind: "claps-disagree", spreadMs: m.clapSpreadMs });
  const [first, ...rest] = misses;
  return first
    ? { outcome: "failed", misses: [first, ...rest] }
    : { outcome: "passed" };
};

/** The clap misses as Matt reads them; the level misses are the page's to word. */
export const describeClapMiss = (
  miss: Extract<
    CalibrationMiss,
    { kind: "too-few-claps" | "claps-disagree" | "no-clap-step" }
  >
): string => {
  switch (miss.kind) {
    case "too-few-claps":
      return `Found ${miss.found} of ${CLAPS_PROMPTED} claps`;
    case "claps-disagree":
      return `Claps disagree by ${Math.round(miss.spreadMs)} ms`;
    case "no-clap-step":
      return "Taken before the clap step: no Mic Offset";
  }
};

/**
 * THE SCRIPT. The same every time, so calibrations compare; bump
 * `SCRIPT_VERSION` whenever a line or a duration below changes. The silence,
 * then 5 claps for the Mic Offset, then the reading rounds. Each line ends on
 * a soft, trailing syllable, so quiet tails are exercised. Then one loud
 * line, read as loudly as Matt gets when he is excited, for the peak check
 * (2: the loud line; 3: the claps).
 */
export const SCRIPT_VERSION = 3;

export const SCRIPT_LINES = [
  "Let's open up the editor and take a look at the code below.",
  "This function takes a user, and hands back the name that should follow.",
  "TypeScript can't know that yet, so we'll have to tell it, gently.",
  "Run the tests again, and you'll see the error vanish completely.",
  "That's the whole idea, and we'll build on it in the lesson that follows.",
] as const;

/** The loud line: read as loudly as Matt would when excited or animated. */
export const LOUD_LINE =
  "And there it is: it works! That is absolutely brilliant!";

/** Seconds of "get ready" before the silence. */
export const COUNTDOWN_SECONDS = 3;
/** Seconds of silence the noise floor is measured over. */
export const SILENCE_SECONDS = 10;
/** Seconds of "hands in front of your face" before the first clap. */
export const CLAP_READY_SECONDS = 3;
/** Seconds for each "Clap N": the claps are this far apart. */
export const CLAP_SECONDS = 1.5;
/** Seconds for each "Read line N". */
export const READ_SECONDS = 6;
/**
 * Seconds for each "Pause": longer than the long Silence Length (2 s) plus
 * the reaction margin, so both Silence Lengths would cut on it.
 */
export const PAUSE_SECONDS = 4;
/** Seconds for the loud line, the script's last step. */
export const LOUD_SECONDS = 6;
/** Seconds Matt may be late to react to a prompt. */
export const REACTION_MARGIN_SECONDS = 0.75;

export type ScriptStep =
  | { kind: "countdown"; startSeconds: number; endSeconds: number }
  | { kind: "silence"; startSeconds: number; endSeconds: number }
  | { kind: "clap-ready"; startSeconds: number; endSeconds: number }
  | { kind: "clap"; clap: number; startSeconds: number; endSeconds: number }
  | { kind: "read"; line: number; startSeconds: number; endSeconds: number }
  | { kind: "pause"; line: number; startSeconds: number; endSeconds: number }
  | { kind: "loud"; startSeconds: number; endSeconds: number };

/**
 * The prompt schedule, in seconds of the calibration's mic file (the
 * recorder service's clock): what Matt is asked to do, and when.
 */
export const SCRIPT_SCHEDULE: readonly ScriptStep[] = (() => {
  const silenceEnd = COUNTDOWN_SECONDS + SILENCE_SECONDS;
  const clapsAt = silenceEnd + CLAP_READY_SECONDS;
  const steps: ScriptStep[] = [
    { kind: "countdown", startSeconds: 0, endSeconds: COUNTDOWN_SECONDS },
    {
      kind: "silence",
      startSeconds: COUNTDOWN_SECONDS,
      endSeconds: silenceEnd,
    },
    { kind: "clap-ready", startSeconds: silenceEnd, endSeconds: clapsAt },
  ];
  for (let i = 0; i < CLAPS_PROMPTED; i++)
    steps.push({
      kind: "clap",
      clap: i + 1,
      startSeconds: clapsAt + i * CLAP_SECONDS,
      endSeconds: clapsAt + (i + 1) * CLAP_SECONDS,
    });
  const readsAt = steps.at(-1)!.endSeconds;
  SCRIPT_LINES.forEach((_, i) => {
    const readAt = readsAt + i * (READ_SECONDS + PAUSE_SECONDS);
    const pauseAt = readAt + READ_SECONDS;
    steps.push(
      { kind: "read", line: i + 1, startSeconds: readAt, endSeconds: pauseAt },
      {
        kind: "pause",
        line: i + 1,
        startSeconds: pauseAt,
        endSeconds: pauseAt + PAUSE_SECONDS,
      }
    );
  });
  const loudAt = steps.at(-1)!.endSeconds;
  steps.push({
    kind: "loud",
    startSeconds: loudAt,
    endSeconds: loudAt + LOUD_SECONDS,
  });
  return steps;
})();

export const SCRIPT_END_SECONDS = SCRIPT_SCHEDULE.at(-1)!.endSeconds;

export type TimeWindow = { startSeconds: number; endSeconds: number };

/**
 * The windows the recorder service measures, in seconds of the script: the
 * noise floor over the silence less a reaction margin at each end, and the
 * speech loudness over each "Read line N", starting a margin late and
 * running a margin over. The claps are their own window, from "hands in
 * front of your face" to a margin past the last clap: used only for the Mic
 * Offset, and cut out of the true peak, which is taken over the rest of the
 * take (the loud line is in no other window: the true peak is its check).
 */
export type MeasurementWindows = {
  silence: TimeWindow;
  speech: TimeWindow[];
  claps: TimeWindow;
};

export const MEASUREMENT_WINDOWS: MeasurementWindows = (() => {
  const clapSteps = SCRIPT_SCHEDULE.filter(
    (s) => s.kind === "clap-ready" || s.kind === "clap"
  );
  return {
    silence: SCRIPT_SCHEDULE.filter((s) => s.kind === "silence").map((s) => ({
      startSeconds: s.startSeconds + REACTION_MARGIN_SECONDS,
      endSeconds: s.endSeconds - REACTION_MARGIN_SECONDS,
    }))[0]!,
    speech: SCRIPT_SCHEDULE.filter((s) => s.kind === "read").map((s) => ({
      startSeconds: s.startSeconds + REACTION_MARGIN_SECONDS,
      endSeconds: s.endSeconds + REACTION_MARGIN_SECONDS,
    })),
    claps: {
      startSeconds: clapSteps[0]!.startSeconds,
      endSeconds: clapSteps.at(-1)!.endSeconds + REACTION_MARGIN_SECONDS,
    },
  };
})();

const shift = (w: TimeWindow, bySeconds: number): TimeWindow => ({
  startSeconds: w.startSeconds + bySeconds,
  endSeconds: w.endSeconds + bySeconds,
});

/**
 * The script in seconds of a run's files, its countdown starting at
 * `scriptStartSeconds` (when the run went live: the camera takes a few
 * seconds to open, and the files' clock starts before it does).
 */
export const runSchedule = (scriptStartSeconds: number): ScriptStep[] =>
  SCRIPT_SCHEDULE.map((s) => ({ ...s, ...shift(s, scriptStartSeconds) }));

/** `MEASUREMENT_WINDOWS` in seconds of a run's files (`runSchedule`). */
export const runMeasurementWindows = (
  scriptStartSeconds: number
): MeasurementWindows => ({
  silence: shift(MEASUREMENT_WINDOWS.silence, scriptStartSeconds),
  speech: MEASUREMENT_WINDOWS.speech.map((w) => shift(w, scriptStartSeconds)),
  claps: shift(MEASUREMENT_WINDOWS.claps, scriptStartSeconds),
});

/**
 * THE GATE (ADR 0038). A Recorder starts only under a passed AV
 * Calibration less than this old, taken on the current camera + mic pair.
 */
export const CALIBRATION_VALIDITY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Whether a stored calibration passed under TODAY's rules: its own outcome
 * was a pass, its true peak was measured, and its stored measurements still
 * pass `judgeCalibration` now. So a rule change (the target moving from -21
 * to -27 LUFS, the peak check, the clap step) takes old passes out of the
 * gate by itself, with no rules version to remember to bump: a calibration
 * with no clap measurements never passes.
 */
export const passesCurrentRules = (
  c: CalibrationMeasures & { outcome: CalibrationOutcome }
): boolean =>
  c.outcome === "passed" &&
  c.truePeakDb !== null &&
  judgeCalibration(c).outcome === "passed";

/**
 * The camera the recorder service records, as it finds it among the
 * DirectShow devices: the first whose name contains this (`findByName`).
 * OBS cannot say which camera it records, so on the OBS path the editor
 * takes it to be this one too.
 */
export const RECORDER_CAMERA_NAME = "Cam Link 4K";

/**
 * The latest AV Calibration that passes under today's rules
 * (`passesCurrentRules`), as the gate and a Record need it: when it was
 * taken, on which camera + mic pair, and the threshold it set.
 */
export type LastPassedCalibration = {
  id: string;
  /** When it was taken, in epoch ms. */
  createdAtMs: number;
  thresholdDb: number;
  /** The recorder service's mic (its DirectShow name) it was taken on. */
  recorderMic: string;
  /** The browser's audio input label it was taken on; null: none opened. */
  browserInputLabel: string | null;
  /**
   * The recorder service's camera (its DirectShow name) it was taken on;
   * null only on a row from before AV Calibration, which never passes.
   */
  cameraDevice: string | null;
};

/**
 * The camera + mic pair now, as far as the asker knows it: the recorder
 * service its mic and camera (their DirectShow names, at Record), the editor
 * its getUserMedia audio track's label (OBS; null when it has none open) and
 * the camera the recorder service is configured with
 * (`RECORDER_CAMERA_NAME`). A device left out is not compared.
 */
export type CurrentInputDevice = {
  recorderMic?: string;
  browserInputLabel?: string | null;
  camera?: string;
};

export type CalibrationInvalidReason =
  | { kind: "none" }
  | { kind: "expired"; expiredAtMs: number }
  | {
      kind: "device-changed";
      device: "recorder-mic" | "browser-input" | "camera";
      from: string | null;
      to: string | null;
    };

export type CalibrationValidity =
  | { valid: true; calibration: LastPassedCalibration; expiresAtMs: number }
  | { valid: false; reason: CalibrationInvalidReason };

export const calibrationExpiresAtMs = (c: LastPassedCalibration): number =>
  c.createdAtMs + CALIBRATION_VALIDITY_MS;

/**
 * Whether the calibration's camera is `current`: the same DirectShow name,
 * or one the configured name finds, the way the recorder service finds its
 * camera (case-insensitive containment), so the editor's configured name
 * matches the full name the service recorded the calibration on.
 */
const isSameCamera = (calibrated: string | null, current: string) =>
  calibrated !== null &&
  calibrated.toLowerCase().includes(current.toLowerCase());

/**
 * Whether a Recorder may start now: the latest calibration passed under
 * today's rules exists, is less than 7 days old (exactly 7 days is expired),
 * and was taken on every device `current` names: the camera + mic pair.
 */
export const calibrationValidity = (
  lastPassed: LastPassedCalibration | null,
  current: CurrentInputDevice,
  nowMs: number
): CalibrationValidity => {
  if (!lastPassed) return { valid: false, reason: { kind: "none" } };
  const expiresAtMs = calibrationExpiresAtMs(lastPassed);
  if (nowMs >= expiresAtMs)
    return {
      valid: false,
      reason: { kind: "expired", expiredAtMs: expiresAtMs },
    };
  if (
    current.recorderMic !== undefined &&
    current.recorderMic !== lastPassed.recorderMic
  )
    return {
      valid: false,
      reason: {
        kind: "device-changed",
        device: "recorder-mic",
        from: lastPassed.recorderMic,
        to: current.recorderMic,
      },
    };
  if (
    current.browserInputLabel !== undefined &&
    current.browserInputLabel !== lastPassed.browserInputLabel
  )
    return {
      valid: false,
      reason: {
        kind: "device-changed",
        device: "browser-input",
        from: lastPassed.browserInputLabel,
        to: current.browserInputLabel,
      },
    };
  if (
    current.camera !== undefined &&
    !isSameCamera(lastPassed.cameraDevice, current.camera)
  )
    return {
      valid: false,
      reason: {
        kind: "device-changed",
        device: "camera",
        from: lastPassed.cameraDevice,
        to: current.camera,
      },
    };
  return { valid: true, calibration: lastPassed, expiresAtMs };
};

/** Where Matt runs an AV Calibration. */
export const AV_CALIBRATION_PATH = "/av-calibration";

/** Every gate refusal starts with this, so the editor can link the page. */
export const CALIBRATION_REFUSAL_PREFIX =
  "Recording needs a fresh AV Calibration: ";

/** A moment as Matt reads it, the same on every machine (UTC). */
export const formatCalibrationTime = (ms: number): string =>
  `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;

const DEVICE_NAMES = {
  "recorder-mic": "The recorder's mic",
  "browser-input": "The browser's mic input",
  camera: "The camera",
} as const;
const deviceName = (device: keyof typeof DEVICE_NAMES) => DEVICE_NAMES[device];

/** Why a Recorder will not start, in a sentence, with the refusal prefix. */
export const describeCalibrationRefusal = (
  reason: CalibrationInvalidReason
): string => {
  switch (reason.kind) {
    case "none":
      return `${CALIBRATION_REFUSAL_PREFIX}none has passed under the current rules (${TARGET_LOUDNESS_LUFS} LUFS ± ${TARGET_TOLERANCE_DB}, peak at most ${MAX_TRUE_PEAK_DBTP} dBTP, ${MIN_CLAPS_FOUND} of ${CLAPS_PROMPTED} claps agreeing within a frame) yet.`;
    case "expired":
      return `${CALIBRATION_REFUSAL_PREFIX}the last one expired on ${formatCalibrationTime(reason.expiredAtMs)} (they last 7 days).`;
    case "device-changed":
      return `${CALIBRATION_REFUSAL_PREFIX}${deviceName(reason.device)} changed from "${reason.from ?? "none"}" to "${reason.to ?? "none"}" since the last one.`;
  }
};

export const isCalibrationRefusal = (message: string | null): boolean =>
  message?.includes(CALIBRATION_REFUSAL_PREFIX) ?? false;
