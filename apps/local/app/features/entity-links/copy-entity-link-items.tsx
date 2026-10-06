import { ContextMenuItem } from "@/components/ui/context-menu";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
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
 * "Copy Link" and "Copy ID" for one entity — every entity's right-click menu
 * and Actions menu carries these two items (CODING_STANDARDS.md, "Every
 * entity menu can copy its link and ID"). Renders the bare items; the caller
 * places them in a group of their own. `menu` picks the item component, since
 * a context menu and a dropdown each need their own.
 */
export function CopyEntityLinkItems({
  entity,
  menu,
}: {
  entity: EntityRef;
  menu: "context" | "dropdown";
}) {
  const Item = menu === "context" ? ContextMenuItem : DropdownMenuItem;
  const label = ENTITY_LABELS[entity.type];

  return (
    <>
      <Item
        onSelect={() => {
          void copy(
            entityDeepLink(entity, window.location.origin),
            `${label} link`
          );
        }}
      >
        <Link2 className="w-4 h-4" />
        Copy Link
      </Item>
      <Item
        onSelect={() => {
          void copy(entity.id, `${label} ID`);
        }}
      >
        <Fingerprint className="w-4 h-4" />
        Copy ID
      </Item>
    </>
  );
}
