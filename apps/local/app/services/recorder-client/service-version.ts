import type { VideoFormat } from "@/features/videos/video-format";
import {
  RECORDER_PROTOCOL_VERSION,
  type RecorderMessage,
  type RecorderState,
} from "../../../recorder-service/protocol";

/**
 * A recorder service started from older code. It outlives `pnpm dev`
 * restarts on purpose (ADR 0034; `ensure-recorder-service.ts` leaves a
 * running one alone), so after a pull the app can meet one that speaks an
 * older wire. Nothing works reliably against it, so it is a `problem` that
 * says how to restart it.
 */

/** Why the recorder cannot record, from its greeting; null when it can. */
export const helloProblem = (
  hello: Extract<RecorderMessage, { type: "hello" }>,
  httpUrl: string
): string | null => {
  if (hello.protocol !== RECORDER_PROTOCOL_VERSION)
    return (
      "The recorder service is running older code: restart it. When it is not recording, " +
      `stop its process (\`kill <pid>\`; \`curl ${httpUrl}/health\` gives the pid), ` +
      "then `pnpm dev` (or `pnpm start`) starts it again."
    );
  return hello.ffmpeg.ok ? null : hello.ffmpeg.message;
};

/** An open recorder's format: a service from before Shorts sends none, and is Landscape. */
export const stateFormat = (
  state: Exclude<RecorderState, { kind: "closed" }>
): VideoFormat => (state as { format?: VideoFormat }).format ?? "landscape";
