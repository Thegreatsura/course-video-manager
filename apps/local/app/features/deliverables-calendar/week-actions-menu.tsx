import type { ReactElement } from "react";
import { useFetcher } from "react-router";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { ActionMenuContent } from "@/features/action-menu/action-menu";
import { STANDARD_ACTIONS } from "@/features/action-menu/standard-actions";

interface DuplicableItem {
  id: string;
  title: string;
}

export function WeekContextMenu({
  items,
  onAddNew,
  children,
}: {
  items: DuplicableItem[];
  onAddNew: () => void;
  children: ReactElement;
}) {
  const fetcher = useFetcher();
  const count = items.length;

  const duplicate = () => {
    if (count === 0) return;
    const fd = new FormData();
    for (const item of items) fd.append("ids", item.id);
    fetcher.submit(fd, {
      method: "post",
      action: "/api/deliverables/duplicate-week",
    });
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ActionMenuContent
        menu="context"
        groups={{
          create: [
            {
              ...STANDARD_ACTIONS.add,
              label: "Add Deliverable",
              opensDialog: true,
              onSelect: onAddNew,
            },
            count > 0 && {
              ...STANDARD_ACTIONS.duplicate,
              label: "Duplicate to Next Week",
              onSelect: duplicate,
            },
          ],
        }}
      />
    </ContextMenu>
  );
}
