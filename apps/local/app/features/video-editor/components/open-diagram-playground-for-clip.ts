import { fetchMeta } from "@/features/diagrams/use-diagram-snapshot-scene";
import { resolveForClip } from "@/lib/diagram-action-resolver";
import {
  openPlayground,
  openPlaygroundWithDiagram,
} from "@/lib/diagram-window";

/**
 * Opens the Diagram Playground on the Clip's pinned DiagramSnapshot, restored
 * to its Diagram's head, or empty.
 */
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
    openPlaygroundWithDiagram(result.diagramId, {
      snapshotId: snapshotId ?? undefined,
    });
  } else {
    openPlayground();
  }
};
