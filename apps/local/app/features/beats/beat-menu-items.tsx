import {
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import type {
  ActionLeaf,
  ActionMenuGroups,
} from "@/features/action-menu/action-menu-model";
import { STANDARD_ACTIONS } from "@/features/action-menu/standard-actions";
import { Plus, Shapes } from "lucide-react";
import {
  BEAT_KINDS,
  BEAT_KIND_DESCRIPTIONS,
  BEAT_KIND_ICONS,
  BEAT_KIND_LABELS,
  type BeatKind,
} from "./beat-kinds";

/**
 * One action-menu leaf per Beat kind, with its icon and description. Used
 * to create a Beat of a kind (which opens the create-Beat dialog) and to
 * reclassify one (`current` marks its kind).
 */
export function beatKindLeaves(
  onSelect: (kind: BeatKind) => void,
  options: { current?: BeatKind; opensDialog?: boolean } = {}
): ActionLeaf[] {
  return BEAT_KINDS.map((kind) => ({
    label: BEAT_KIND_LABELS[kind],
    icon: BEAT_KIND_ICONS[kind],
    description: BEAT_KIND_DESCRIPTIONS[kind],
    opensDialog: options.opensDialog,
    checked:
      options.current === undefined ? undefined : kind === options.current,
    onSelect: () => onSelect(kind),
  }));
}

/**
 * A Beat's actions: change its kind, add a neighbour before/after, delete.
 * Deleting archives the Beat with no way back in the app, so `onDelete`
 * should ask first (it carries the ellipsis).
 */
export function beatMenuGroups({
  kind,
  onSetKind,
  onAddBefore,
  onAddAfter,
  onDelete,
}: {
  kind: BeatKind;
  onSetKind: (kind: BeatKind) => void;
  onAddBefore: (kind: BeatKind) => void;
  onAddAfter: (kind: BeatKind) => void;
  onDelete: () => void;
}): ActionMenuGroups {
  return {
    edit: [
      {
        label: "Change Kind",
        icon: Shapes,
        items: beatKindLeaves(onSetKind, { current: kind }),
      },
    ],
    create: [
      {
        ...STANDARD_ACTIONS.add,
        label: "Add Beat Before",
        items: beatKindLeaves(onAddBefore, { opensDialog: true }),
      },
      {
        ...STANDARD_ACTIONS.add,
        label: "Add Beat After",
        items: beatKindLeaves(onAddAfter, { opensDialog: true }),
      },
    ],
    danger: [
      { ...STANDARD_ACTIONS.delete, opensDialog: true, onSelect: onDelete },
    ],
  };
}

/**
 * @deprecated Hand-built; only the course view's Video menu still uses it,
 * via {@link AddBeatSubMenu}. Delete both once that menu builds its "Add
 * Beat" leaves itself (Batch 2 of docs/plans/action-menus.md).
 */
function BeatKindMenuItems({
  onSelect,
}: {
  onSelect: (kind: BeatKind) => void;
}) {
  return (
    <>
      {BEAT_KINDS.map((kind) => {
        const Icon = BEAT_KIND_ICONS[kind];
        return (
          <ContextMenuItem
            key={kind}
            onSelect={() => onSelect(kind)}
            className="items-start gap-2"
          >
            <Icon className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="flex flex-col">
              <span>{BEAT_KIND_LABELS[kind]}</span>
              <span className="text-xs text-muted-foreground">
                {BEAT_KIND_DESCRIPTIONS[kind]}
              </span>
            </div>
          </ContextMenuItem>
        );
      })}
    </>
  );
}

/**
 * "Add beat ▸ <kind>" submenu for a Video's context menu.
 * @deprecated See {@link BeatKindMenuItems}.
 */
export function AddBeatSubMenu({ onAdd }: { onAdd: (kind: BeatKind) => void }) {
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <Plus className="w-4 h-4" />
        Add beat
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <BeatKindMenuItems onSelect={onAdd} />
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
