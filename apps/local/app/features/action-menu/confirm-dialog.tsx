import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useState, type ReactNode } from "react";

export interface ConfirmRequest {
  title: string;
  description: string;
  /** The destructive button's label: "Delete", "Overwrite". */
  confirmLabel: string;
  onConfirm: () => void;
}

/**
 * The confirmation an irreversible action asks for before it runs
 * (CODING_STANDARDS.md, "Action menus", rule 6). Give the menu item
 * `opensDialog: true` and `onSelect: () => confirm({…})`, and render `dialog`
 * anywhere in the component.
 */
export function useConfirmDialog(): {
  confirm: (request: ConfirmRequest) => void;
  dialog: ReactNode;
} {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const close = () => setRequest(null);

  const dialog = (
    <Dialog open={request !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{request?.title}</DialogTitle>
          <DialogDescription>{request?.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              request?.onConfirm();
              close();
            }}
          >
            {request?.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { confirm: setRequest, dialog };
}
