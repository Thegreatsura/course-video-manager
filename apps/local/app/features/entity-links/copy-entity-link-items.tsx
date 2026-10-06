import { ContextMenuItem } from "@/components/ui/context-menu";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import type { ActionLeaf } from "@/features/action-menu/action-menu-model";
import { Fingerprint, Link2 } from "lucide-react";
import { toast } from "sonner";
import {
  ENTITY_LABELS,
  entityDeepLink,
  type EntityRef,
} from "./entity-deep-link";

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied to clipboard`);
  } catch {
    toast.error(`Failed to copy ${what.toLowerCase()} to clipboard`);
  }
}

/**
 * "Copy Link" and "Copy ID" for one entity, as action-menu leaves.
 * `EntityMenuContent` closes every entity menu's copy group with these
 * (CODING_STANDARDS.md, "Action menus"). `null` is an entity still being
 * saved — a Clip mid-recording, a Chapter just added: it has no id to copy
 * yet, so both show disabled rather than vanish.
 */
export function copyEntityLinkActions(entity: EntityRef | null): ActionLeaf[] {
  if (entity === null) {
    return [
      { label: "Copy Link", icon: Link2, disabled: true, onSelect: () => {} },
      {
        label: "Copy ID",
        icon: Fingerprint,
        disabled: true,
        onSelect: () => {},
      },
    ];
  }
  const label = ENTITY_LABELS[entity.type];
  return [
    {
      label: "Copy Link",
      icon: Link2,
      onSelect: () => {
        void copy(
          entityDeepLink(entity, window.location.origin),
          `${label} link`
        );
      },
    },
    {
      label: "Copy ID",
      icon: Fingerprint,
      onSelect: () => {
        void copy(entity.id, `${label} ID`);
      },
    },
  ];
}

/**
 * The same two items for a menu not yet on `EntityMenuContent` — see
 * docs/plans/action-menus.md. New menus use `EntityMenuContent`, which adds
 * them itself. Renders the bare items; the caller places them in a group of
 * their own. `menu` picks the item component.
 */
export function CopyEntityLinkItems({
  entity,
  menu,
}: {
  entity: EntityRef;
  menu: "context" | "dropdown";
}) {
  const Item = menu === "context" ? ContextMenuItem : DropdownMenuItem;
  return (
    <>
      {copyEntityLinkActions(entity).map((action) => (
        <Item key={action.label} onSelect={action.onSelect}>
          <action.icon className="w-4 h-4" />
          {action.label}
        </Item>
      ))}
    </>
  );
}
