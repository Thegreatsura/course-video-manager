import { DiagramOperationsService } from "@cvm/core/services/db-diagram-operations.server";
import { Hono } from "hono";
import { forward } from "../rpc.js";
import type { RemoteRuntime } from "../runtime.js";

/**
 * The `diagram` verb group: `cvm diagram create` — a new Diagram, drawn by an
 * agent in the simple shape format and kept as Preserved Snapshots, the first
 * restored to the head; `snapshot add` — one more Preserved Snapshot, restored
 * to the head; `render` — reads one snapshot to draw it; `get` — reads the
 * head and the timeline; `update`, `delete`, `restore` — rename, archive and
 * un-archive the Diagram through `updateDiagram`, never its drawings.
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
      "/updateDiagram",
      forward(runtime, DiagramOperationsService, "updateDiagram")
    )
    .post(
      "/getDiagramSnapshot",
      forward(runtime, DiagramOperationsService, "getDiagramSnapshot")
    )
    .post(
      "/listSnapshotsWithClips",
      forward(runtime, DiagramOperationsService, "listSnapshotsWithClips")
    );
