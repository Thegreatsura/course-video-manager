import type { ActionLeaf } from "@/features/action-menu/action-menu-model";
import { Link2 } from "lucide-react";
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
 * "Copy Link" for one entity, as an action-menu leaf. `EntityMenuContent`
 * closes every entity menu's copy group with it (CODING_STANDARDS.md, "Action
 * menus"). The link names the entity's whole hierarchy and `cvm` takes it
 * wherever it takes an id, so there is no separate raw-id item. `null` is an
 * entity still being saved — a Clip mid-recording, a Chapter just added: it
 * has no id to link to yet, so the item shows disabled rather than vanish.
 */
export function copyEntityLinkActions(entity: EntityRef | null): ActionLeaf[] {
  if (entity === null) {
    return [
      { label: "Copy Link", icon: Link2, disabled: true, onSelect: () => {} },
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
  ];
}
