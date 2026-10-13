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
  TRASH_RETENTION_DAYS,
  trashDoneBytes,
  trashDoneFiles,
} from "@/packages/storage/client";
import {
  planBlockers,
  storageActionLabel,
  type storageAction,
} from "./storage-action";

/** Gigabytes as Windows counts them (GiB); small sizes in MB. */
const size = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${(bytes / 1024 ** 2).toFixed(1)} MB`;

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** What deleting each Other bucket means, in the confirmation. */
const DELETE_EXPLANATIONS: Record<string, string> = {
  "overlay-render-cache":
    "Overlay renders. Each is rendered again, on demand, the next time an export needs it.",
  "export-scratch":
    "Leftover files exports were encoded in. Refused while an export is running.",
  "orphaned-exports":
    "Exported Videos (and their companions) that are no Video's current export. A Video's current Exported Video is never deleted.",
};

const explanation = (request: storageAction.Request): string => {
  switch (request.type) {
    case "move":
      return "Each file is copied, then checked against its original's checksum. Originals stay where they are until you delete them; no Video needs a new export.";
    case "purge":
      return "Only Exported Videos whose Footage is all found. Each becomes an Unexported Video, and the next Publish (or export) makes it again. Raw Footage is never deleted.";
    case "delete-bucket":
      return `${DELETE_EXPLANATIONS[request.bucket.id] ?? ""} Raw Footage is never deleted.`;
    case "originals":
      return "Only files with an identical copy (size and checksum, read again just before) on another drive. A file with no copy elsewhere is kept.";
    case "trash-unused":
      return `Each file is moved into the Trash (.cvm-trash) on its own drive, never across drives. You can Restore it for ${TRASH_RETENTION_DAYS} days; then it is deleted for good. Footage any Clip uses, live or archived, and anything from the last 7 days, is never moved.`;
    case "restore-trash":
      return "Each file goes back where it was, on its own drive. Nothing is ever overwritten.";
    case "empty-trash":
      return "Everything in the Trash is deleted for good, on every drive. This can't be undone.";
  }
};

/** The plan's numbers, as the dialog lists them. */
function PlanNumbers({
  plan,
  labelOf,
}: {
  plan: storageAction.Plan;
  labelOf: (location: string) => string;
}) {
  switch (plan.type) {
    case "move": {
      const p = plan.plan;
      const freeAfter =
        p.freeBytes === null ? null : p.freeBytes - p.bytesToCopy;
      return (
        <dl
          className="grid grid-cols-2 gap-1 text-sm"
          data-testid="storage-action-numbers"
        >
          <dt className="text-muted-foreground">To copy</dt>
          <dd>
            {size(p.bytesToCopy)} ({plural(p.filesToCopy, "file")})
          </dd>
          {p.filesOnTarget > 0 && (
            <>
              <dt className="text-muted-foreground">Already there</dt>
              <dd>{plural(p.filesOnTarget, "file")}, re-checked</dd>
            </>
          )}
          <dt className="text-muted-foreground">Free on {labelOf(p.target)}</dt>
          <dd>{p.freeBytes === null ? "unknown" : size(p.freeBytes)}</dd>
          {freeAfter !== null && (
            <>
              <dt className="text-muted-foreground">Free after</dt>
              <dd className={freeAfter < 0 ? "text-destructive" : ""}>
                {size(freeAfter)}
              </dd>
            </>
          )}
          {p.conflicts > 0 && (
            <>
              <dt className="text-muted-foreground">In the way</dt>
              <dd>
                {plural(p.conflicts, "different file")}, never overwritten
              </dd>
            </>
          )}
        </dl>
      );
    }
    case "purge":
      return (
        <div className="space-y-2 text-sm" data-testid="storage-action-numbers">
          <p>
            {plural(plan.result.videos, "Video")}:{" "}
            {plural(purgedFiles(plan.result), "file")},{" "}
            {size(purgedBytes(plan.result))}.
          </p>
          {plan.result.skipped.length > 0 && (
            <div>
              <strong>
                {plural(plan.result.skipped.length, "Video")} skipped
              </strong>{" "}
              (its Footage isn't all found, so it couldn't be exported again):
              <ul className="list-disc pl-5 max-h-32 overflow-y-auto">
                {plan.result.skipped.slice(0, 10).map((s) => (
                  <li key={s.videoId} className="break-all">
                    {s.title || s.videoId}: {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      );
    case "delete-bucket": {
      const files = plan.result.deleted.reduce((n, d) => n + d.files, 0);
      const bytes = plan.result.deleted.reduce((n, d) => n + d.bytes, 0);
      return (
        <p className="text-sm" data-testid="storage-action-numbers">
          {plural(files, "file")}, {size(bytes)}
          {plan.result.deleted.length > 0 &&
            `: ${plan.result.deleted.map((d) => `${size(d.bytes)} on ${labelOf(d.location)}`).join(", ")}`}
          .
        </p>
      );
    }
    case "originals":
      return (
        <p className="text-sm" data-testid="storage-action-numbers">
          {plural(plan.result.deleted.files, "file")} (
          {size(plan.result.deleted.bytes)}) to check and delete;{" "}
          {plural(plan.result.kept.files, "file")} with no copy elsewhere stay.
        </p>
      );
    case "trash":
      return (
        <div className="space-y-2 text-sm" data-testid="storage-action-numbers">
          <p>
            {plural(trashDoneFiles(plan.result), "file")},{" "}
            {size(trashDoneBytes(plan.result))}
            {plan.result.done.length > 0 &&
              `: ${plan.result.done.map((d) => `${size(d.bytes)} on ${labelOf(d.location)}`).join(", ")}`}
            .
          </p>
          {plan.result.kept.length > 0 && (
            <div data-testid="storage-action-kept">
              <strong>{plural(plan.result.kept.length, "file")} kept:</strong>
              <ul className="list-disc pl-5 max-h-32 overflow-y-auto">
                {plan.result.kept.slice(0, 10).map((k) => (
                  <li key={`${k.location}:${k.path}`} className="break-all">
                    {labelOf(k.location)} {k.path}: {k.reason}
                  </li>
                ))}
                {plan.result.kept.length > 10 && (
                  <li>…and {plan.result.kept.length - 10} more</li>
                )}
              </ul>
            </div>
          )}
        </div>
      );
  }
}

/** Files a plan would leave (a link, a folder not where it is named). */
const leftOf = (plan: storageAction.Plan) =>
  plan.type === "move" || plan.type === "originals"
    ? 0
    : plan.result.left.length;

/**
 * The confirmation for any move or delete on the Storage pages (#2157):
 * what it would do (the server's dry run), and why it is blocked, if it is.
 * Confirming queues its Sidecar Job.
 */
export function StorageActionDialog({
  action,
  labelOf,
  onConfirm,
  onCancel,
}: {
  action: storageAction.State | null;
  labelOf: (location: string) => string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const open =
    action?.status === "planning" ||
    action?.status === "confirming" ||
    action?.status === "starting";
  const destructive =
    action !== null &&
    action.request.type !== "move" &&
    action.request.type !== "restore-trash";
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && action?.status !== "starting") onCancel();
      }}
    >
      {open && (
        <DialogContent data-testid="storage-action-confirmation">
          <DialogHeader>
            <DialogTitle>
              {storageActionLabel(action.request, labelOf)}?
            </DialogTitle>
            <DialogDescription>{explanation(action.request)}</DialogDescription>
          </DialogHeader>
          {action.status === "planning" ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Checking what it
              would do, and for running work…
            </p>
          ) : (
            <>
              <PlanNumbers plan={action.plan} labelOf={labelOf} />
              {leftOf(action.plan) > 0 && (
                <p className="text-sm text-destructive">
                  {plural(leftOf(action.plan), "file")} will be left, failing a
                  safety check (a link, or a folder not where it is named).
                </p>
              )}
              {planBlockers(action.plan).length > 0 && (
                <ul
                  className="list-disc pl-5 text-sm text-destructive"
                  data-testid="storage-action-blocked"
                >
                  {planBlockers(action.plan).map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              )}
            </>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={onCancel}
              disabled={action.status === "starting"}
            >
              Cancel
            </Button>
            <Button
              variant={destructive ? "destructive" : "default"}
              onClick={onConfirm}
              disabled={
                action.status !== "confirming" ||
                planBlockers(action.plan).length > 0
              }
              data-testid="storage-action-confirm"
            >
              {action.status === "starting" ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Starting…
                </>
              ) : (
                storageActionLabel(action.request, labelOf)
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}

/** Why an action did not start. */
export function StorageActionFailure({
  action,
  labelOf,
  onDismiss,
}: {
  action: storageAction.State | null;
  labelOf: (location: string) => string;
  onDismiss: () => void;
}) {
  if (action?.status !== "failed") return null;
  return (
    <div
      className="flex items-start justify-between gap-4 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm"
      data-testid="storage-action-failed"
    >
      <span>
        <strong>
          {storageActionLabel(action.request, labelOf)}: not started.
        </strong>{" "}
        {action.message}
      </span>
      <Button variant="ghost" size="sm" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  );
}
