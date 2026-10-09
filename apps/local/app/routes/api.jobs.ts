import { Effect, Schema } from "effect";
import { makeAction } from "@/services/route-action.server";
import { nudgeSidecar } from "@/services/sidecar-socket.server";
import { enqueueJob, JOB_KINDS } from "../../sidecar/job-kinds";

/**
 * Enqueue a background **Job** for the **Sidecar** to run: a row, then a
 * nudge. It succeeds whether or not the sidecar is up — a Job waits in the
 * queue until one runs it. The browser names the Job (`id`) so it can follow
 * it, and wait on it, before this answers.
 */
const EnqueueJobRequest = Schema.Struct({
  id: Schema.UUID,
  kind: Schema.String,
  title: Schema.String,
  params: Schema.Unknown,
  subject: Schema.NullOr(
    Schema.Struct({ type: Schema.String, id: Schema.String })
  ),
  attemptsSpent: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  dependsOn: Schema.optionalWith(Schema.NullOr(Schema.UUID), {
    default: () => null,
  }),
});

export const action = makeAction({
  input: "json",
  errors: {
    UnknownJobKindError: 400,
    NoAttemptsLeftError: 400,
    JobIdTakenError: 409,
  },
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const request = yield* Schema.decodeUnknown(EnqueueJobRequest)(payload);
      const job = yield* enqueueJob({
        id: request.id,
        kind: request.kind,
        title: request.title,
        params: request.params,
        dependsOn: request.dependsOn,
        subject: request.subject,
        attemptsSpent: request.attemptsSpent,
        registry: JOB_KINDS,
      });
      yield* nudgeSidecar();
      return { id: job.id };
    }),
});
