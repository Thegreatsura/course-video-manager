import type { DiagramComponentOperationsService } from "@/services/db-diagram-component-operations.server";
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
    updateSnapshot: rpcMethod((json) =>
      client.rpc.diagram.updateSnapshot.$post({ json })
    ),
    getDiagram: rpcMethod((json) =>
      client.rpc.diagram.getDiagram.$post({ json })
    ),
    updateDiagram: rpcMethod((json) =>
      client.rpc.diagram.updateDiagram.$post({ json })
    ),
    getDiagramSnapshot: rpcMethod((json) =>
      client.rpc.diagram.getDiagramSnapshot.$post({ json })
    ),
    listSnapshotsWithClips: rpcMethod((json) =>
      client.rpc.diagram.listSnapshotsWithClips.$post({ json })
    ),
    listDiagramSummaries: rpcMethod((json) =>
      client.rpc.diagram.listDiagramSummaries.$post({ json })
    ),
    searchDiagrams: rpcMethod((json) =>
      client.rpc.diagram.searchDiagrams.$post({ json })
    ),
  }) satisfies RemoteService<DiagramOperationsService>;

/** Components, read-only: the one endpoint `cvm diagram component list` uses. */
export const diagramComponentService = (client: RpcClient) =>
  ({
    _tag: "DiagramComponentOperationsService",
    listComponentFragments: rpcMethod((json) =>
      client.rpc["diagram-component"].listComponentFragments.$post({ json })
    ),
  }) satisfies RemoteService<DiagramComponentOperationsService>;
