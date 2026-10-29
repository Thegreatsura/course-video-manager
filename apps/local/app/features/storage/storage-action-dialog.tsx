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
import { UNUSED_FOOTAGE_MIN_AGE_DAYS } from "@/packages/storage/client";
import {
  deletePlanBytes,
  deletePlanFiles,
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
    case "delete-unused":
      return `Deleted for good; this can't be undone. Footage any Clip uses, live or archived, and anything changed in the last ${UNUSED_FOOTAGE_MIN_AGE_DAYS} days, is checked again and kept.`;
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
    case "delete":
      return (
        <p className="text-sm" data-testid="storage-action-numbers">
          {plural(deletePlanFiles(plan), "item")}, {size(deletePlanBytes(plan))}
          {plan.byLocation.length > 1 &&
            `: ${plan.byLocation.map((l) => `${size(l.bytes)} on ${labelOf(l.location)}`).join(", ")}`}
          .
        </p>
      );
  }
}

/**
 * The confirmation for any move or delete on the Storage pages (#2157):
 * what it would do (a move: the server's dry run; a delete: what the page
 * has listed, so it opens at once), and why it is blocked, if it is.
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
  const destructive = action !== null && action.request.type !== "move";
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
