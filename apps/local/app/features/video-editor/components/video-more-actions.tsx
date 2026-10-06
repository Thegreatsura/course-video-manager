import { Button } from "@/components/ui/button";
import {
  layoutActionMenu,
  type ActionMenuGroups,
} from "@/features/action-menu/action-menu-model";
import { cn } from "@/lib/utils";

/**
 * The editor's More tab: the Video's rare actions, moved out of the Actions
 * menu to keep it near a dozen items (CODING_STANDARDS.md, "Action menus",
 * rule 9). Built by `videoMenuGroups` like the menu, so each action keeps its
 * label, icon, order and disabled state; only the door differs.
 */
export const VideoMoreActions = (props: { groups: ActionMenuGroups }) => (
  <div className="space-y-3 px-2">
    {layoutActionMenu(props.groups).map((group) => (
      <div key={group.group} className="flex flex-wrap gap-2">
        {group.items.map((item) =>
          item.kind === "leaf" ? (
            <Button
              key={item.key}
              variant="outline"
              size="sm"
              disabled={item.disabled}
              title={item.description}
              onClick={item.onSelect}
              className={cn(item.destructive && "text-destructive")}
            >
              <item.icon className="size-4" />
              {item.label}
            </Button>
          ) : null
        )}
      </div>
    ))}
  </div>
);
