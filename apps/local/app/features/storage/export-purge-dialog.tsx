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
import {
  purgedBytes,
  purgedFiles,
  type StoragePurgeResult,
} from "@/packages/storage/client";
import type { exportPurge } from "./export-purge";

/** Gigabytes as Windows counts them (GiB), to one decimal place. */
const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

function SkippedVideos({ result }: { result: StoragePurgeResult }) {
  if (result.skipped.length === 0) return null;
  return (
    <div className="text-sm" data-testid="storage-purge-skipped">
      <strong>
        {plural(result.skipped.length, "Video")} skipped (
        {gb(result.skipped.reduce((n, s) => n + s.bytes, 0))} kept)
      </strong>
      , so it can always be exported again:
      <ul className="list-disc pl-5 max-h-40 overflow-y-auto">
        {result.skipped.slice(0, 20).map((s) => (
          <li key={s.videoId} className="break-all">
            {s.title || s.videoId}: {s.reason}
          </li>
        ))}
        {result.skipped.length > 20 && (
          <li>…and {result.skipped.length - 20} more</li>
        )}
      </ul>
    </div>
  );
}

/**
 * The Purge's confirmation (#2111): the GB it frees, how many Videos it
 * makes Unexported, and the Videos it skips because their Footage isn't
 * found.
 */
export function ExportPurgeConfirmation({
  purge,
  onConfirm,
  onCancel,
}: {
  purge: exportPurge.State | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const open =
    purge?.status === "planning" ||
    purge?.status === "confirming" ||
    purge?.status === "purging";
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      {open && (
        <DialogContent data-testid="storage-purge-confirmation">
          <DialogHeader>
            <DialogTitle>
              {purge.status === "planning"
                ? `Delete ${purge.bucket.name}'s Exported Videos?`
                : `Delete ${purge.bucket.name}'s Exported Videos: free ${gb(purgedBytes(purge.plan))}?`}
            </DialogTitle>
            <DialogDescription>
              {purge.exportPaths === null
                ? "Every Exported Video in this bucket whose Footage is all found, on every drive."
                : `The ${plural(purge.exportPaths.length, "ticked Exported Video")}, on every drive, if its Footage is all found.`}{" "}
              Each one becomes an Unexported Video, and the next Publish (or
              export) makes it again. Raw Footage is never deleted.
            </DialogDescription>
          </DialogHeader>
          {purge.status === "planning" ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Checking which
              Videos' Footage is found…
            </p>
          ) : (
            <div className="space-y-2 text-sm">
              <p data-testid="storage-purge-plan">
                {plural(purge.plan.videos, "Video")}:{" "}
                {plural(purgedFiles(purge.plan), "file")},{" "}
                {gb(purgedBytes(purge.plan))}.
              </p>
              <SkippedVideos result={purge.plan} />
              {purge.plan.left.length > 0 && (
                <p className="text-destructive">
                  {plural(purge.plan.left.length, "file")} will be left, failing
                  a safety check (a link, or a folder that is not where it is
                  named).
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={onCancel}
              disabled={purge.status === "purging"}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={onConfirm}
              disabled={
                purge.status !== "confirming" || purgedFiles(purge.plan) === 0
              }
              data-testid="storage-purge-confirm"
            >
              {purge.status === "purging" ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Deleting…
                </>
              ) : purge.status === "confirming" ? (
                <>Delete {gb(purgedBytes(purge.plan))}</>
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

/** What the Purge did, or why it was refused. */
export function ExportPurgeStatus({
  purge,
  labelOf,
  onDismiss,
}: {
  purge: exportPurge.State | null;
  labelOf: (location: string) => string;
  onDismiss: () => void;
}) {
  if (purge?.status === "failed") {
    return (
      <div
        className="flex items-start justify-between gap-4 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm"
        data-testid="storage-purge-result"
      >
        <span>
          <strong>
            {purge.bucket.name}'s Exported Videos were not deleted.
          </strong>{" "}
          {purge.message}
        </span>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    );
  }
  if (purge?.status !== "purged") return null;
  const { result } = purge;
  return (
    <div
      className="flex items-start justify-between gap-4 rounded-lg border p-3 text-sm"
      data-testid="storage-purge-result"
    >
      <div className="space-y-1">
        <div>
          <strong>
            Deleted {gb(purgedBytes(result))} of {purge.bucket.name}'s Exported
            Videos
          </strong>{" "}
          ({plural(result.videos, "Video")} now Unexported,{" "}
          {plural(purgedFiles(result), "file")}
          {result.deleted.length > 0 &&
            `: ${result.deleted.map((d) => `${gb(d.bytes)} on ${labelOf(d.location)}`).join(", ")}`}
          ).
        </div>
        <SkippedVideos result={result} />
        {result.left.length > 0 && (
          <div className="text-destructive" data-testid="storage-purge-left">
            {plural(result.left.length, "file")} left (a locked file can be
            retried):
            <ul className="list-disc pl-5">
              {result.left.slice(0, 10).map((l) => (
                <li key={`${l.location}:${l.path}`} className="break-all">
                  {labelOf(l.location)} {l.path}: {l.message}
                </li>
              ))}
              {result.left.length > 10 && (
                <li>…and {result.left.length - 10} more</li>
              )}
            </ul>
          </div>
        )}
      </div>
      <Button variant="ghost" size="sm" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  );
}
