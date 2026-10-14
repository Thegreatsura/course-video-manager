import { fetchMeta } from "@/features/diagrams/use-diagram-snapshot-scene";
import { resolveForClip } from "@/lib/diagram-action-resolver";
import {
  openPlayground,
  openPlaygroundWithDiagram,
} from "@/lib/diagram-window";

/** Opens the Diagram Playground on the Clip's pinned Diagram, or empty. */
export const openDiagramPlaygroundForClip = async (
  snapshotId: string | null
) => {
  let resolvedDiagramId: string | null = null;
  if (snapshotId) {
    const meta = await fetchMeta(snapshotId);
    resolvedDiagramId = meta.diagramId;
  }
  const result = resolveForClip(
    { diagramSnapshotId: snapshotId },
    () => resolvedDiagramId
  );
  if (result.kind === "diagram") {
    openPlaygroundWithDiagram(result.diagramId);
  } else {
    openPlayground();
  }
};
