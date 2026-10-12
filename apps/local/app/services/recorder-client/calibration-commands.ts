import type {
  CalibrationWindow,
  RecorderCommand,
  RecorderMessage,
} from "recorder-service/protocol";
import { RecorderRefusedError } from "./recorder-command";

/** What an Audio Calibration's run measured, and on which mic and file. */
export type CalibrationMeasured = Extract<
  RecorderMessage,
  { type: "calibration-measured" }
>;

/**
 * The recorder client's Audio Calibration commands (`client.server.ts`): each
 * sends one command and waits until the recorder service has carried it out.
 */
export const calibrationCommands = (o: {
  /** Sends a command and waits for the message that says it was done. */
  command: (
    sent: RecorderCommand,
    done: (message: RecorderMessage) => boolean
  ) => Promise<void>;
  /** Why the recorder service cannot be used (an older one); null when it can. */
  problem: () => string | null;
}) => ({
  /**
   * Starts an Audio Calibration's run, its mic file in a new folder under
   * `folder` (a WSL path). Answers once it is running.
   */
  async startCalibration(folder: string) {
    const problem = o.problem();
    if (problem) throw new RecorderRefusedError(problem);
    await o.command(
      { type: "start-calibration", folder },
      (m) => m.type === "calibration-started"
    );
  },

  /** Ends the run and measures its file over these windows (file seconds). */
  async finishCalibration(windows: {
    silence: CalibrationWindow;
    speech: readonly CalibrationWindow[];
  }): Promise<CalibrationMeasured> {
    let measured: CalibrationMeasured | undefined;
    await o.command({ type: "finish-calibration", ...windows }, (m) => {
      if (m.type !== "calibration-measured") return false;
      measured = m;
      return true;
    });
    return measured!;
  },

  /** Ends the run and deletes its file. */
  async cancelCalibration() {
    await o.command(
      { type: "cancel-calibration" },
      (m) => m.type === "calibration-ended"
    );
  },
});
