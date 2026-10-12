/**
 * THE NUMBERS of an Audio Calibration (#2077, "The numbers"), beside the one
 * definition of silence (`silence-detection-constants.ts`) whose threshold an
 * Audio Calibration will set. Every number the Audio Calibration page and its
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

/** The silence threshold an Audio Calibration sets: speech - 16 dB, clamped. */
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

export type CalibrationOutcome = "passed" | "failed";

/** One reason a calibration failed, and by how many dB. */
export type CalibrationMiss =
  /** The speech loudness is outside the band; `byDb` past its edge. */
  | { kind: "too-quiet" | "too-loud"; byDb: number }
  /** The take's true peak is over `MAX_TRUE_PEAK_DBTP`, by `byDb`. */
  | { kind: "peak-too-high"; truePeakDb: number; byDb: number };

/** Whether a calibration passed, and if not, every way it missed. */
export type CalibrationJudgement =
  | { outcome: "passed" }
  | { outcome: "failed"; misses: [CalibrationMiss, ...CalibrationMiss[]] };

/**
 * Passed when the speech loudness is inside the target band, edges included,
 * and the take's true peak is at or under `MAX_TRUE_PEAK_DBTP`. A calibration
 * stored before the peak check (`truePeakDb` null) is judged on loudness alone.
 */
export const judgeCalibration = (m: {
  speechLufs: number;
  truePeakDb: number | null;
}): CalibrationJudgement => {
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
  const [first, ...rest] = misses;
  return first
    ? { outcome: "failed", misses: [first, ...rest] }
    : { outcome: "passed" };
};

/**
 * THE SCRIPT. The same every time, so calibrations compare; bump
 * `SCRIPT_VERSION` whenever a line or a duration below changes. Each line
 * ends on a soft, trailing syllable, so quiet tails are exercised. Then one
 * loud line, read as loudly as Matt gets when he is excited, for the peak
 * check (2: the loud line).
 */
export const SCRIPT_VERSION = 2;

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
  | { kind: "read"; line: number; startSeconds: number; endSeconds: number }
  | { kind: "pause"; line: number; startSeconds: number; endSeconds: number }
  | { kind: "loud"; startSeconds: number; endSeconds: number };

/**
 * The prompt schedule, in seconds of the calibration's mic file (the
 * recorder service's clock): what Matt is asked to do, and when.
 */
export const SCRIPT_SCHEDULE: readonly ScriptStep[] = (() => {
  const steps: ScriptStep[] = [
    { kind: "countdown", startSeconds: 0, endSeconds: COUNTDOWN_SECONDS },
    {
      kind: "silence",
      startSeconds: COUNTDOWN_SECONDS,
      endSeconds: COUNTDOWN_SECONDS + SILENCE_SECONDS,
    },
  ];
  SCRIPT_LINES.forEach((_, i) => {
    const readAt =
      COUNTDOWN_SECONDS + SILENCE_SECONDS + i * (READ_SECONDS + PAUSE_SECONDS);
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
 * The windows the recorder service measures: the noise floor over the
 * silence less a reaction margin at each end, and the speech loudness over
 * each "Read line N", starting a margin late and running a margin over. The
 * loud line is in no window: it is measured only by the true peak, which the
 * service takes over the whole take.
 */
export const MEASUREMENT_WINDOWS: {
  silence: TimeWindow;
  speech: TimeWindow[];
} = {
  silence: SCRIPT_SCHEDULE.filter((s) => s.kind === "silence").map((s) => ({
    startSeconds: s.startSeconds + REACTION_MARGIN_SECONDS,
    endSeconds: s.endSeconds - REACTION_MARGIN_SECONDS,
  }))[0]!,
  speech: SCRIPT_SCHEDULE.filter((s) => s.kind === "read").map((s) => ({
    startSeconds: s.startSeconds + REACTION_MARGIN_SECONDS,
    endSeconds: s.endSeconds + REACTION_MARGIN_SECONDS,
  })),
};

/**
 * THE GATE (ADR 0038). A Recorder starts only under a passed Audio
 * Calibration less than this old, taken on the current audio input device.
 */
export const CALIBRATION_VALIDITY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Whether a stored calibration passed under TODAY's rules: its own outcome
 * was a pass, its true peak was measured, and its stored measurements still
 * pass `judgeCalibration` now. So a rule change (the target moving from -21
 * to -27 LUFS, the peak check) takes old passes out of the gate by itself,
 * with no rules version to remember to bump.
 */
export const passesCurrentRules = (c: {
  outcome: CalibrationOutcome;
  speechLufs: number;
  truePeakDb: number | null;
}): boolean =>
  c.outcome === "passed" &&
  c.truePeakDb !== null &&
  judgeCalibration(c).outcome === "passed";

/**
 * The latest Audio Calibration that passes under today's rules
 * (`passesCurrentRules`), as the gate and a Record need it: when it was
 * taken, on which input device, and the threshold it set.
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
};

/**
 * The audio input device now, as far as the asker knows it: the recorder
 * service its mic (CVM recorder), the editor its getUserMedia audio track's
 * label (OBS; null when it has none open). A device left out is not compared.
 */
export type CurrentInputDevice = {
  recorderMic?: string;
  browserInputLabel?: string | null;
};

export type CalibrationInvalidReason =
  | { kind: "none" }
  | { kind: "expired"; expiredAtMs: number }
  | {
      kind: "device-changed";
      device: "recorder-mic" | "browser-input";
      from: string | null;
      to: string | null;
    };

export type CalibrationValidity =
  | { valid: true; calibration: LastPassedCalibration; expiresAtMs: number }
  | { valid: false; reason: CalibrationInvalidReason };

export const calibrationExpiresAtMs = (c: LastPassedCalibration): number =>
  c.createdAtMs + CALIBRATION_VALIDITY_MS;

/**
 * Whether a Recorder may start now: the latest calibration passed under
 * today's rules exists, is less than 7 days old (exactly 7 days is expired),
 * and was taken on every input device `current` names.
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
  return { valid: true, calibration: lastPassed, expiresAtMs };
};

/** Where Matt runs an Audio Calibration. */
export const AUDIO_CALIBRATION_PATH = "/audio-calibration";

/** Every gate refusal starts with this, so the editor can link the page. */
export const CALIBRATION_REFUSAL_PREFIX =
  "Recording needs a fresh Audio Calibration: ";

/** A moment as Matt reads it, the same on every machine (UTC). */
export const formatCalibrationTime = (ms: number): string =>
  `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;

const deviceName = (device: "recorder-mic" | "browser-input") =>
  device === "recorder-mic" ? "The recorder's mic" : "The browser's mic input";

/** Why a Recorder will not start, in a sentence, with the refusal prefix. */
export const describeCalibrationRefusal = (
  reason: CalibrationInvalidReason
): string => {
  switch (reason.kind) {
    case "none":
      return `${CALIBRATION_REFUSAL_PREFIX}none has passed under the current rules (${TARGET_LOUDNESS_LUFS} LUFS ± ${TARGET_TOLERANCE_DB}, peak at most ${MAX_TRUE_PEAK_DBTP} dBTP) yet.`;
    case "expired":
      return `${CALIBRATION_REFUSAL_PREFIX}the last one expired on ${formatCalibrationTime(reason.expiredAtMs)} (they last 7 days).`;
    case "device-changed":
      return `${CALIBRATION_REFUSAL_PREFIX}${deviceName(reason.device)} changed from "${reason.from ?? "none"}" to "${reason.to ?? "none"}" since the last one.`;
  }
};

export const isCalibrationRefusal = (message: string | null): boolean =>
  message?.includes(CALIBRATION_REFUSAL_PREFIX) ?? false;
