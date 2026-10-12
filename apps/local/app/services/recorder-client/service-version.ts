import {
  RECORDER_PROTOCOL_VERSION,
  type RecorderMessage,
} from "../../../recorder-service/protocol";

/**
 * A recorder service running older code than the app. The service starts and
 * stops with `pnpm dev` and is never watched (ADR 0035), while the app server
 * reloads on a change: after a pull mid-session the app can meet a service
 * that speaks an older wire. Nothing works reliably against it, so it is a
 * `problem` that says to restart `pnpm dev`.
 */

/** Why the recorder cannot record, from its greeting; null when it can. */
export const helloProblem = (
  hello: Extract<RecorderMessage, { type: "hello" }>
): string | null => {
  if (hello.protocol !== RECORDER_PROTOCOL_VERSION)
    return (
      "The recorder service is running older code than the app: " +
      "restart `pnpm dev` (or `pnpm start`) when it is not recording."
    );
  return hello.ffmpeg.ok ? null : hello.ffmpeg.message;
};
