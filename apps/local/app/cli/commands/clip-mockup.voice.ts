import { Effect, Logger, LogLevel } from "effect";
import { estimateSpokenSeconds } from "@cvm/core/features/clip-mockups/estimate-spoken-seconds";
import { nudgeSidecar } from "@/services/sidecar-socket.server";

/**
 * THE VOICE HALF of `cvm clip-mockup add` and `update`, which no longer
 * waits for it. The API writes the rows with their voice `pending` AND queues
 * their `clip-mockup-voice` Job in the same request (`createClipMockups`,
 * `updateClipMockups`); this machine's Sidecar runs it
 * (`sidecar/kinds/clip-mockup-voice.ts`): Kokoro, through the Clip Mockup
 * daemon, never in the `cvm` process. The CLI opens no database connection
 * for it.
 */

/**
 * Ask this machine's Sidecar to look at its queue now, when any row written
 * is waiting for its voice. Best effort, and silent: STDERR is the CLI's
 * error contract, and a Sidecar that is down finds the Job when it starts.
 */
export const nudgeVoiceJob = (
  rows: ReadonlyArray<{ readonly voiceStatus: string }>
) =>
  rows.some((r) => r.voiceStatus === "pending")
    ? nudgeSidecar().pipe(Logger.withMinimumLogLevel(LogLevel.None))
    : Effect.void;

/**
 * A Clip Mockup row as `cvm clip-mockup` prints it. A voice that is not
 * `ready` has no measured length yet, so `durationSeconds` is the guess from
 * its words and `durationEstimated` is true: summing `durationSeconds` over a
 * Video still gives its run time, and says how much of it is a guess.
 */
export const withVoiceDuration = <
  Row extends {
    readonly line: string;
    readonly durationSeconds: number | null;
    readonly voiceStatus: string;
  },
>(
  row: Row
): Omit<Row, "durationSeconds"> & {
  readonly durationSeconds: number;
  readonly durationEstimated: boolean;
} =>
  row.voiceStatus === "ready" && row.durationSeconds !== null
    ? { ...row, durationSeconds: row.durationSeconds, durationEstimated: false }
    : {
        ...row,
        durationSeconds: estimateSpokenSeconds(row.line),
        durationEstimated: true,
      };
