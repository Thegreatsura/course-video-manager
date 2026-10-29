import { AgentSessionOperationsService } from "@cvm/core/services/db-agent-session-operations.server";
import { Hono } from "hono";
import { forward } from "../rpc.js";
import type { RemoteRuntime } from "../runtime.js";

/**
 * The `video agent-sessions` verb group: `cvm video agent-sessions set | get |
 * clear`. Not local-only: the CLI reads the session files on its own machine
 * and sends their entries, so nothing here touches a disk.
 */
export const agentSessionRoutes = (runtime: RemoteRuntime) =>
  new Hono()
    .post(
      "/setVideoAgentSessions",
      forward(runtime, AgentSessionOperationsService, "setVideoAgentSessions")
    )
    .post(
      "/getVideoAgentSessions",
      forward(runtime, AgentSessionOperationsService, "getVideoAgentSessions")
    )
    .post(
      "/clearVideoAgentSessions",
      forward(runtime, AgentSessionOperationsService, "clearVideoAgentSessions")
    );
