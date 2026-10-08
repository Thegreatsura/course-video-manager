import { Effect, Fiber, Queue } from "effect";
import type { JobContext } from "./job-kind";

type Report =
  | {
      readonly type: "event";
      readonly event: string;
      readonly data: Record<string, unknown>;
    }
  | { readonly type: "done" };

/**
 * The services a handler drives report through plain callbacks (`onStage`,
 * `onProgress`, a batch's `onDetailEvent`), but a Job Event is a database
 * write. The callbacks drop each report into a queue, and one fiber writes
 * them in order — so a `progress` event never lands before the `stage` it
 * belongs to, and none is lost when the work finishes.
 */
export const makeOrderedEvents = (ctx: JobContext) =>
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<Report>();
    const writer = yield* Effect.fork(
      Effect.gen(function* () {
        while (true) {
          const report = yield* Queue.take(queue);
          if (report.type === "done") return;
          yield* ctx.emit(report.event, report.data);
        }
      })
    );
    return {
      /** Queue one Job Event; safe to call from a synchronous callback. */
      emit: (event: string, data: Record<string, unknown>) => {
        Queue.unsafeOffer(queue, { type: "event", event, data });
      },
      /** Write what is still queued, then stop the writer. */
      flush: Effect.suspend(() => {
        Queue.unsafeOffer(queue, { type: "done" });
        return Fiber.join(writer);
      }),
    };
  });
