import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";

/**
 * The confirmation an irreversible menu action asks for first
 * (CODING_STANDARDS.md, "Action menus", rule 6). `request(target)` opens it
 * — call it from the menu item, which sets `opensDialog` — and `dialog` is
 * rendered once beside the menu. `onConfirm` runs only on the red button.
 */
export function useConfirmDelete<T>({
  title,
  description,
  onConfirm,
}: {
  /** "Delete Pitch". Also the confirm button's label. */
  title: string;
  description: (target: T) => ReactNode;
  onConfirm: (target: T) => void;
}) {
  const [pending, setPending] = useState<{ target: T } | null>(null);

  const dialog = (
    <Dialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) setPending(null);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="size-5 text-destructive" />
            {title}
          </DialogTitle>
          <DialogDescription>
            {pending && description(pending.target)}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setPending(null)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (pending) onConfirm(pending.target);
              setPending(null);
            }}
          >
            {title}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return {
    request: (target: T) => setPending({ target }),
    dialog,
  };
}
