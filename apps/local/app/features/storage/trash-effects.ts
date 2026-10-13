import type { StorageTrashEntry } from "@/packages/storage/client";

/**
 * The `load-trash` effect: what is in the Trash on every reachable Storage
 * Root (`GET /api/storage/trash`). Reads only.
 */
export const loadTrash = (
  dispatch: (
    action:
      | { type: "trash-listed"; entries: StorageTrashEntry[] }
      | { type: "trash-list-failed"; message: string }
  ) => void
) => {
  fetch("/api/storage/trash")
    .then(async (response) => {
      if (!response.ok) throw new Error(await response.text());
      const { entries } = (await response.json()) as {
        entries: StorageTrashEntry[];
      };
      dispatch({ type: "trash-listed", entries });
    })
    .catch((error: unknown) =>
      dispatch({
        type: "trash-list-failed",
        message: error instanceof Error ? error.message : String(error),
      })
    );
};
