import { DiagramOperationsService } from "@cvm/core/services/db-diagram-operations.server";
import { Hono } from "hono";
import { forward } from "../rpc.js";
import type { RemoteRuntime } from "../runtime.js";

/**
 * The `diagram` verb group: `cvm diagram create` — a new Diagram, drawn by an
 * agent in the simple shape format and kept as Preserved Snapshots, the first
 * restored to the head.
 */
export const diagramRoutes = (runtime: RemoteRuntime) =>
  new Hono().post(
    "/createDiagramFromSnapshots",
    forward(runtime, DiagramOperationsService, "createDiagramFromSnapshots")
  );
