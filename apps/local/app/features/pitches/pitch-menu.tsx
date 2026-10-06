import { useConfirmDelete } from "@/components/confirm-delete-dialog";
import type { ActionMenuGroups } from "@/features/action-menu/action-menu-model";
import { STANDARD_ACTIONS } from "@/features/action-menu/standard-actions";
import { useFetcher } from "react-router";

/**
 * A Pitch's actions, built once and rendered from every door: the /pitches
 * card's right-click and the Pitch page's "…" button. Deleting a Pitch is a
 * hard delete (its Videos are unlinked, not deleted), so it confirms first;
 * render `deleteDialog` beside the menu.
 */
export function usePitchMenu({
  pitch,
  onAddVideo,
  isAddingVideo,
  redirectTo,
}: {
  pitch: { id: string; title: string };
  onAddVideo: () => void;
  isAddingVideo: boolean;
  /** Where to go once the Pitch is gone — the Pitch page leaves itself. */
  redirectTo?: string;
}) {
  const deleteFetcher = useFetcher();
  const isDeleting = deleteFetcher.state !== "idle";

  const confirmDelete = useConfirmDelete<{ id: string; title: string }>({
    title: "Delete Pitch",
    description: (p) =>
      `Delete "${p.title || "Untitled Pitch"}"? Its Videos stay, unlinked from it. This cannot be undone.`,
    onConfirm: (p) => {
      deleteFetcher.submit(redirectTo ? { redirectTo } : {}, {
        method: "post",
        action: `/api/pitches/${p.id}/delete`,
      });
    },
  });

  const groups: ActionMenuGroups = {
    create: [
      {
        ...STANDARD_ACTIONS.add,
        label: "Add Video",
        disabled: isAddingVideo,
        onSelect: onAddVideo,
      },
    ],
    danger: [
      {
        ...STANDARD_ACTIONS.delete,
        opensDialog: true,
        disabled: isDeleting,
        onSelect: () => confirmDelete.request(pitch),
      },
    ],
  };

  return { groups, deleteDialog: confirmDelete.dialog, isDeleting };
}
