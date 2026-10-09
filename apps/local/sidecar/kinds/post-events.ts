import { Effect } from "effect";
import type { JobContext } from "../job-kind";
import { makeOrderedEvents } from "../ordered-events";

/**
 * How a posting Job reports: `stage` and `progress` as an export does, and
 * once it has posted, a `posted` Job Event with what the row links to (a
 * YouTube id, an AI Hero slug). All in order, through one writer.
 */
export const reportPost = (ctx: JobContext) =>
  Effect.gen(function* () {
    const events = yield* makeOrderedEvents(ctx);
    // An upload repeats a percentage; only a change is news.
    let last: { stage: string; percent: number } | null = null;
    return {
      onStage: (stage: string) => {
        last = null;
        events.emit("stage", { stage });
      },
      onProgress: (stage: string, percent: number) => {
        if (last?.stage === stage && last.percent === percent) return;
        last = { stage, percent };
        events.emit("progress", { stage, percent });
      },
      posted: (result: Record<string, unknown>) => {
        events.emit("posted", result);
      },
      flush: events.flush,
    };
  });
