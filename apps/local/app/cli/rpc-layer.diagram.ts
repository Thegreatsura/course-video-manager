import type { DiagramOperationsService } from "@/services/db-diagram-operations.server";
import { rpcMethod, type RemoteService, type RpcClient } from "./rpc-client";

/**
 * The `diagram` verb group's RPC-backed service, split out of rpc-layer.ts to
 * keep that file under the repo's per-file token budget. Same contract as
 * every service there: one `rpcMethod` line per endpoint, checked against the
 * service's own signature by `satisfies`.
 */
export const diagramService = (client: RpcClient) =>
  ({
    _tag: "DiagramOperationsService",
    createDiagramFromSnapshots: rpcMethod((json) =>
      client.rpc.diagram.createDiagramFromSnapshots.$post({ json })
    ),
    addSnapshotToHead: rpcMethod((json) =>
      client.rpc.diagram.addSnapshotToHead.$post({ json })
    ),
    getDiagram: rpcMethod((json) =>
      client.rpc.diagram.getDiagram.$post({ json })
    ),
    getDiagramSnapshot: rpcMethod((json) =>
      client.rpc.diagram.getDiagramSnapshot.$post({ json })
    ),
  }) satisfies RemoteService<DiagramOperationsService>;
