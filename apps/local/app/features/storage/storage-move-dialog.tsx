import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { STORAGE_MOVE_KIND_LABELS } from "@/packages/storage/client";
import {
  moveConfirmation,
  type storagePageReducer,
} from "./storage-page-reducer";

/** Gigabytes as Windows counts them (GiB), to one decimal place. */
const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

/**
 * The move confirmation (#2109): the size to copy (files not on the target
 * yet), the target's free space, and why it is blocked, if it is. Originals
 * are kept: "Delete originals" is a separate step.
 */
export function MoveConfirmation({
  state,
  labelOf,
  onConfirm,
  onCancel,
}: {
  state: storagePageReducer.State;
  labelOf: (location: string) => string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const move = state.move;
  const confirmation = moveConfirmation(state);
  const open =
    move?.status === "planning" ||
    move?.status === "confirming" ||
    move?.status === "starting";
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && move?.status !== "starting") onCancel();
      }}
    >
      {open && (
        <DialogContent data-testid="storage-move-confirmation">
          {move.status === "planning" || confirmation === null ? (
            <DialogHeader>
              <DialogTitle>Checking the move…</DialogTitle>
              <DialogDescription className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Counting what would
                be copied and checking for running work.
              </DialogDescription>
            </DialogHeader>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>
                  Move {confirmation.plan.bucketName}{" "}
                  {STORAGE_MOVE_KIND_LABELS[confirmation.plan.kind]} to{" "}
                  {labelOf(confirmation.plan.target)}?
                </DialogTitle>
                <DialogDescription>
                  Each file is copied, then checked against its original's
                  checksum. Originals stay where they are until you delete them
                  from the bucket's page; no Video needs a new export.
                </DialogDescription>
              </DialogHeader>
              <dl
                className="grid grid-cols-2 gap-1 text-sm"
                data-testid="storage-move-numbers"
              >
                <dt className="text-muted-foreground">To copy</dt>
                <dd>
                  {gb(confirmation.bytesToCopy)} (
                  {confirmation.plan.filesToCopy} files)
                </dd>
                {confirmation.plan.filesOnTarget > 0 && (
                  <>
                    <dt className="text-muted-foreground">Already there</dt>
                    <dd>{confirmation.plan.filesOnTarget} files, re-checked</dd>
                  </>
                )}
                <dt className="text-muted-foreground">
                  Free on {labelOf(confirmation.plan.target)}
                </dt>
                <dd>
                  {confirmation.freeBytes === null
                    ? "unknown"
                    : gb(confirmation.freeBytes)}
                </dd>
                {confirmation.freeAfter !== null && (
                  <>
                    <dt className="text-muted-foreground">Free after</dt>
                    <dd
                      className={
                        confirmation.freeAfter < 0 ? "text-destructive" : ""
                      }
                    >
                      {gb(confirmation.freeAfter)}
                    </dd>
                  </>
                )}
                {confirmation.plan.conflicts > 0 && (
                  <>
                    <dt className="text-muted-foreground">In the way</dt>
                    <dd>
                      {confirmation.plan.conflicts} different files, never
                      overwritten
                    </dd>
                  </>
                )}
              </dl>
              {confirmation.blocked && (
                <ul
                  className="list-disc pl-5 text-sm text-destructive"
                  data-testid="storage-move-blocked"
                >
                  {confirmation.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              )}
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={onCancel}
                  disabled={confirmation.starting}
                >
                  Cancel
                </Button>
                <Button
                  onClick={onConfirm}
                  disabled={confirmation.blocked || confirmation.starting}
                  data-testid="storage-move-confirm"
                >
                  {confirmation.starting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Starting…
                    </>
                  ) : (
                    <>Move {gb(confirmation.bytesToCopy)}</>
                  )}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}

export function MoveStatus({
  state,
  onDismiss,
}: {
  state: storagePageReducer.State;
  onDismiss: () => void;
}) {
  const move = state.move;
  if (move?.status === "failed") {
    return (
      <div
        className="flex items-start justify-between gap-4 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm"
        data-testid="storage-move-result"
      >
        <span>
          <strong>{move.bucket.name} was not moved.</strong> {move.message}
        </span>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    );
  }
  if (move?.status !== "started") return null;
  return (
    <div
      className="flex items-start justify-between gap-4 rounded-lg border p-3 text-sm"
      data-testid="storage-move-result"
    >
      <span>
        <strong>
          Moving {move.plan.bucketName}{" "}
          {STORAGE_MOVE_KIND_LABELS[move.plan.kind]} to {move.plan.targetLabel}
        </strong>{" "}
        in the background. Its progress, and its Cancel, are in the Upload
        Manager; come back to this page to count again.
      </span>
      <Button variant="ghost" size="sm" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  );
}
