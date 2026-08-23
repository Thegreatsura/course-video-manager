import { Effect, Layer } from "effect";
import {
  VideoEditorLoggerService,
  type LogEvent,
} from "@/services/video-editor-logger-service";

/** One line the code under test wrote to a Video's log. */
export type RecordedLogLine = {
  videoId: string;
  event: LogEvent;
};

/**
 * A Video Editor Logger that keeps its lines in memory.
 *
 * The real one appends to `.data/logs/{videoId}.log` with `appendFileSync`,
 * relative to the working directory — so a test using it would write into the
 * log directory of whatever machine ran the suite, and would leave those lines
 * there. It also makes the log assertable: a test can state that a failed
 * export explained itself, which is the whole reason the events exist.
 */
export const createFakeVideoEditorLogger = () => {
  const lines: RecordedLogLine[] = [];

  const layer = Layer.succeed(VideoEditorLoggerService, {
    log: (videoId: string, event: LogEvent) =>
      Effect.sync(() => {
        lines.push({ videoId, event });
      }),
    getLogPath: (videoId: string) => `/fake-logs/${videoId}.log`,
  } as unknown as VideoEditorLoggerService);

  return {
    layer,
    lines,
    /** Every line of one `type`, in the order it was written. */
    ofType: <T extends LogEvent["type"]>(type: T) =>
      lines
        .map((line) => line.event)
        .filter(
          (event): event is Extract<LogEvent, { type: T }> =>
            event.type === type
        ),
  };
};
