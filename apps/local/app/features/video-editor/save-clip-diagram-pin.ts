/** Pin a Diagram snapshot to a Clip, or unpin it with null. Rejects on a non-2xx answer. */
export const saveClipDiagramPin = async (
  clipDatabaseId: string,
  diagramSnapshotId: string | null
) => {
  const res = await fetch(`/api/clips/${clipDatabaseId}/diagram-pin`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ diagramSnapshotId }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
};
