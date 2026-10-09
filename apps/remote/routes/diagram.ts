import { DiagramOperationsService } from "@cvm/core/services/db-diagram-operations.server";
import { Hono } from "hono";
import { forward } from "../rpc.js";
import type { RemoteRuntime } from "../runtime.js";

/**
 * The `diagram` verb group: `cvm diagram create` — a new Diagram, drawn by an
 * agent in the simple shape format and kept as Preserved Snapshots, the first
 * restored to the head; `snapshot add` — one more Preserved Snapshot, restored
 * to the head; `render` — reads one snapshot to draw it.
 */
export const diagramRoutes = (runtime: RemoteRuntime) =>
  new Hono()
    .post(
      "/createDiagramFromSnapshots",
      forward(runtime, DiagramOperationsService, "createDiagramFromSnapshots")
    )
    .post(
      "/addSnapshotToHead",
      forward(runtime, DiagramOperationsService, "addSnapshotToHead")
    )
    .post(
      "/getDiagram",
      forward(runtime, DiagramOperationsService, "getDiagram")
    )
    .post(
      "/getDiagramSnapshot",
      forward(runtime, DiagramOperationsService, "getDiagramSnapshot")
    );
