import type { ActionMenuGroups } from "@/features/action-menu/action-menu-model";
import { STANDARD_ACTIONS } from "@/features/action-menu/standard-actions";
import { ChevronLeftIcon, ChevronRightIcon, FilmIcon } from "lucide-react";

type Position = "before" | "after";

/**
 * What a Clip or Chapter in a Video's timeline can do, wherever it is
 * listed. A surface passes the handlers it supports and gets back the same
 * labels, icons and order as every other surface; an action whose handler
 * is missing never applies there, so it is left out (CODING_STANDARDS.md,
 * "Action menus", rule 7). The editor's timeline passes them all; the
 * reference panel, showing another Video, passes a few.
 */
export interface TimelineItemActions {
  /** Chapter only: opens the rename dialog. */
  onRename?: () => void;
  /** Sets where the next recording lands. */
  onInsert?: (position: Position) => void;
  /** Opens the dialog that names the new Chapter. */
  onAddChapter: (position: Position) => void;
  /** Present while Clips are selected: opens the Create Video dialog. */
  onCreateVideoFromSelection?: () => void;
  move?: {
    onMove: (direction: "up" | "down") => void;
    isFirstItem: boolean;
    isLastItem: boolean;
  };
  delete?: {
    onSelect: () => void;
    /** It opens a confirmation before anything is deleted. */
    confirms: boolean;
    shortcut?: string;
  };
}

export function timelineItemMenuGroups(
  actions: TimelineItemActions
): Required<Pick<ActionMenuGroups, "edit" | "create" | "move" | "danger">> {
  const { onRename, onInsert, onCreateVideoFromSelection, move } = actions;
  return {
    edit: [
      onRename && {
        ...STANDARD_ACTIONS.rename,
        opensDialog: true,
        onSelect: onRename,
      },
    ],
    create: [
      onInsert && {
        label: "Insert Before",
        icon: ChevronLeftIcon,
        onSelect: () => onInsert("before"),
      },
      onInsert && {
        label: "Insert After",
        icon: ChevronRightIcon,
        onSelect: () => onInsert("after"),
      },
      {
        ...STANDARD_ACTIONS.add,
        label: "Add Chapter Before",
        opensDialog: true,
        onSelect: () => actions.onAddChapter("before"),
      },
      {
        ...STANDARD_ACTIONS.add,
        label: "Add Chapter After",
        opensDialog: true,
        onSelect: () => actions.onAddChapter("after"),
      },
      onCreateVideoFromSelection && {
        label: "Create Video from Selection",
        icon: FilmIcon,
        opensDialog: true,
        onSelect: onCreateVideoFromSelection,
      },
    ],
    move: move
      ? [
          {
            ...STANDARD_ACTIONS.moveUp,
            shortcut: "Alt+↑",
            disabled: move.isFirstItem,
            onSelect: () => move.onMove("up"),
          },
          {
            ...STANDARD_ACTIONS.moveDown,
            shortcut: "Alt+↓",
            disabled: move.isLastItem,
            onSelect: () => move.onMove("down"),
          },
        ]
      : [],
    danger: [
      actions.delete && {
        ...STANDARD_ACTIONS.delete,
        opensDialog: actions.delete.confirms,
        shortcut: actions.delete.shortcut,
        onSelect: actions.delete.onSelect,
      },
    ],
  };
}
