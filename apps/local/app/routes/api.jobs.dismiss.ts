import { Effect, Schema } from "effect";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { makeAction } from "@/services/route-action.server";
import { nudgeSidecar } from "@/services/sidecar-socket.server";

/**
 * The author's **Dismiss** (one row's X, or "Clear finished"): a `dismissed`
 * Job Event on each settled Job, so no snapshot sends it again — not in a new
 * tab, not after a restart. Then the sidecar is nudged, so its event feed
 * tells every open tab to drop it now. A Job still queued or running is left
 * alone: dismissing never cancels.
 */
const DismissJobsRequest = Schema.Struct({
  jobIds: Schema.Array(Schema.String),
});

export const action = makeAction({
  input: "json",
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const request = yield* Schema.decodeUnknown(DismissJobsRequest)(payload);
      const ops = yield* JobOperationsService;
      const dismissed = yield* ops.dismissJobs({ jobIds: request.jobIds });
      if (dismissed.length > 0) yield* nudgeSidecar();
      return { dismissed };
    }),
});
