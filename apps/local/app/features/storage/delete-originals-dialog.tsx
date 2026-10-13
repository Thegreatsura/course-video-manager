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
import type { deleteOriginals } from "./delete-originals";

/** Gigabytes as Windows counts them (GiB); small amounts in MB. */
const gb = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${(bytes / 1024 ** 2).toFixed(1)} MB`;

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * The confirmation (#2110): how many files and GB "Delete originals" would
 * free on the root, and that each is checked by checksum first.
 */
export function DeleteOriginalsConfirmation({
  originals,
  labelOf,
  onConfirm,
  onCancel,
}: {
  originals: deleteOriginals.State | null;
  labelOf: (location: string) => string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const open =
    originals?.status === "planning" ||
    originals?.status === "confirming" ||
    originals?.status === "starting";
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      {open && (
        <DialogContent data-testid="delete-originals-confirmation">
          <DialogHeader>
            <DialogTitle>
              {originals.status === "planning"
                ? `Delete ${originals.bucket.name}'s originals on ${labelOf(originals.from)}?`
                : `Delete ${plural(originals.plan.deleted.files, "original")} on ${labelOf(originals.from)}: free ${gb(originals.plan.deleted.bytes)}?`}
            </DialogTitle>
            <DialogDescription>
              Only files with a copy of the same size on another drive. Each one
              is read again on both drives and deleted only if the checksums
              match; any mismatch or error keeps it. A file with no copy
              elsewhere is never deleted.
            </DialogDescription>
          </DialogHeader>
          {originals.status === "planning" ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Looking for copies…
            </p>
          ) : (
            <div className="space-y-2 text-sm">
              <p data-testid="delete-originals-plan">
                {plural(originals.plan.deleted.files, "file")},{" "}
                {gb(originals.plan.deleted.bytes)} on {labelOf(originals.from)}.
              </p>
              {originals.plan.kept.files > 0 && (
                <p>
                  {plural(originals.plan.kept.files, "file")} (
                  {gb(originals.plan.kept.bytes)}) with no copy elsewhere{" "}
                  {originals.plan.kept.files === 1 ? "stays" : "stay"}.
                </p>
              )}
              {originals.plan.left.length > 0 && (
                <p className="text-destructive">
                  {plural(originals.plan.left.length, "file")} will stay,
                  failing a check (a link, or a copy of a different size).
                </p>
              )}
              <p className="text-muted-foreground">
                It runs as a Job: each file is read again on both drives, then
                deleted. Its row in the Upload Manager shows the progress, a
                Cancel, and any file left.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={onCancel}
              disabled={originals.status === "starting"}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={onConfirm}
              disabled={
                originals.status !== "confirming" ||
                originals.plan.deleted.files === 0
              }
              data-testid="delete-originals-confirm"
            >
              {originals.status === "starting" ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Starting…
                </>
              ) : originals.status === "confirming" ? (
                <>Delete {gb(originals.plan.deleted.bytes)}</>
              ) : (
                <>Delete</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}

/** "Delete originals" started as a Job, or why it did not start. */
export function DeleteOriginalsStatus({
  originals,
  labelOf,
  onDismiss,
}: {
  originals: deleteOriginals.State | null;
  labelOf: (location: string) => string;
  onDismiss: () => void;
}) {
  if (originals?.status === "failed") {
    return (
      <div
        className="flex items-start justify-between gap-4 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm"
        data-testid="delete-originals-result"
      >
        <span>
          <strong>
            {originals.bucket.name}'s originals on {labelOf(originals.from)}{" "}
            were not deleted.
          </strong>{" "}
          {originals.message}
        </span>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    );
  }
  if (originals?.status !== "started") return null;
  return (
    <div
      className="flex items-start justify-between gap-4 rounded-lg border p-3 text-sm"
      data-testid="delete-originals-result"
    >
      <span>
        <strong>
          Deleting up to {plural(originals.plan.deleted.files, "original")} (
          {gb(originals.plan.deleted.bytes)}) on {labelOf(originals.from)}
        </strong>
        , each only once it matches its copy on another drive. Its row in the
        Upload Manager shows the progress and the result; dismiss this to list
        the bucket again.
      </span>
      <Button variant="ghost" size="sm" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  );
}
