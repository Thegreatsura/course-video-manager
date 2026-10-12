/**
 * THE NUMBERS of an Audio Calibration (#2077, "The numbers"), beside the one
 * definition of silence (`silence-detection-constants.ts`) whose threshold an
 * Audio Calibration will set. Every number the Audio Calibration page and its
 * judgement use lives here, as a named constant.
 */

/** The speech loudness Matt sets his mic to, in LUFS: his level before it drifted. */
export const TARGET_LOUDNESS_LUFS = -21;

/** How far either side of the target still passes, in dB. */
export const TARGET_TOLERANCE_DB = 2;

/** The target band, inclusive at both ends: -23 to -19 LUFS. */
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
 * -39 to -35, so the clamp only guards a bad measurement.
 */
export const THRESHOLD_CLAMP = { lowDb: -45, highDb: -30 } as const;

/** The silence threshold an Audio Calibration sets: speech - 16 dB, clamped. */
export const deriveThreshold = (speechLufs: number): number =>
  Math.min(
    Math.max(speechLufs - THRESHOLD_OFFSET_DB, THRESHOLD_CLAMP.lowDb),
    THRESHOLD_CLAMP.highDb
  );

export type CalibrationOutcome = "passed" | "failed";

/** Whether a calibration passed, and if not, which way and how far it missed the band. */
export type CalibrationJudgement =
  | { outcome: "passed" }
  | { outcome: "failed"; miss: "too-quiet" | "too-loud"; byDb: number };

/** Passed when the speech loudness is inside the target band, edges included. */
export const judgeCalibration = (m: {
  speechLufs: number;
}): CalibrationJudgement => {
  const band = bandPosition(m.speechLufs);
  switch (band.position) {
    case "inside":
      return { outcome: "passed" };
    case "below":
      return { outcome: "failed", miss: "too-quiet", byDb: band.byDb };
    case "above":
      return { outcome: "failed", miss: "too-loud", byDb: band.byDb };
  }
};

/**
 * THE SCRIPT. The same every time, so calibrations compare; bump
 * `SCRIPT_VERSION` whenever a line or a duration below changes. Each line
 * ends on a soft, trailing syllable, so quiet tails are exercised.
 */
export const SCRIPT_VERSION = 1;

export const SCRIPT_LINES = [
  "Let's open up the editor and take a look at the code below.",
  "This function takes a user, and hands back the name that should follow.",
  "TypeScript can't know that yet, so we'll have to tell it, gently.",
  "Run the tests again, and you'll see the error vanish completely.",
  "That's the whole idea, and we'll build on it in the lesson that follows.",
] as const;

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
/** Seconds Matt may be late to react to a prompt. */
export const REACTION_MARGIN_SECONDS = 0.75;

export type ScriptStep =
  | { kind: "countdown"; startSeconds: number; endSeconds: number }
  | { kind: "silence"; startSeconds: number; endSeconds: number }
  | { kind: "read"; line: number; startSeconds: number; endSeconds: number }
  | { kind: "pause"; line: number; startSeconds: number; endSeconds: number };

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
  return steps;
})();

export const SCRIPT_END_SECONDS = SCRIPT_SCHEDULE.at(-1)!.endSeconds;

export type TimeWindow = { startSeconds: number; endSeconds: number };

/**
 * The windows the recorder service measures: the noise floor over the
 * silence less a reaction margin at each end, and the speech loudness over
 * each "Read line N", starting a margin late and running a margin over.
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
