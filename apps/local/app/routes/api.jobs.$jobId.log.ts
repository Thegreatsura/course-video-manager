import { data } from "react-router";
import { makeLoader } from "@/services/route-action.server";
import { readJobLog } from "@/services/sidecar-socket.server";

/**
 * A Job's own log (`<job id>.jsonl`, kept by the Sidecar): every line it
 * logged, every stage and the whole cause of every failure. A failed Job's
 * toast and row link here.
 */
export const loader = async (args: {
  request: Request;
  params: Record<string, string | undefined>;
}) => {
  const log = await makeLoader({
    errors: { SidecarUnreachableError: 503 },
    effect: ({ params }) => readJobLog(params.jobId ?? ""),
  })(args);
  if (log === null) throw data("No log for this job", { status: 404 });
  return new Response(log, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
