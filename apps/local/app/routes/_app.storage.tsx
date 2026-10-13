import {
  AlertTriangle,
  ArrowRight,
  HardDrive,
  Loader2,
  Trash2,
} from "lucide-react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
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
  ExportPurgeConfirmation,
  ExportPurgeStatus,
} from "@/features/storage/export-purge-dialog";
import { purgeIsBusy } from "@/features/storage/export-purge";
import {
  driveWarnings,
  rowCanBePurged,
  rowMoveActions,
  storageCells,
  storageRows,
  type StorageRow,
  type storagePageReducer,
} from "@/features/storage/storage-page-reducer";
import { useStoragePage } from "@/features/storage/use-storage-page";
import {
  MoveConfirmation,
  MoveStatus,
} from "@/features/storage/storage-move-dialog";
import {
  bucketCanBeDeleted,
  STORAGE_MOVE_KIND_LABELS,
  type StorageFileKind,
  type StorageMoveKind,
} from "@/packages/storage/client";
import type { Route } from "./+types/_app.storage";

export const meta: Route.MetaFunction = () => [{ title: "CVM - Storage" }];

/** Gigabytes as Windows counts them (GiB), to one decimal place. */
const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

const KINDS: { kind: StorageFileKind; label: string }[] = [
  { kind: "footage", label: "Footage" },
  { kind: "exported-videos", label: "Exported Videos" },
  { kind: "other", label: "Other files" },
];

/**
 * The Storage page (#2107): each Storage Root with its free space, then one
 * row per Storage Bucket, largest first, split into Footage and Exported
 * Videos per root. Each bucket's name opens its per-bucket page. A row moves
 * its Footage, Exported Videos or Clip Mockups to another drive as a Sidecar
 * Job (#2109). A Course's, Standalone Videos' or Shorts' Exported Videos can
 * be deleted (#2111); the Other buckets that are rebuilt on demand can be
 * deleted (#2112). Counted fresh on every visit and streamed in; leaving the
 * page stops the scan.
 */
export default function StoragePage() {
  const [state, dispatch] = useStoragePage();
  const rows = storageRows(state);
  const warnings = driveWarnings(state);
  // A drive reads "D:"; any other folder by its last segment (the full path
  // is on the root's card).
  const labelOf = (location: string) => {
    const label =
      state.roots?.find((r) => r.root === location)?.label ?? location;
    return label.startsWith("/") ? `…/${label.split("/").pop()}` : label;
  };

  return (
    <div className="flex-1 overflow-y-auto bg-background text-foreground">
      <div className="p-8 max-w-6xl space-y-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">Storage</h1>
          <p className="text-muted-foreground">
            Where the space is going, counted fresh on every visit.
          </p>
          <ScanStatus state={state} />
        </div>

        <DeletionStatus
          state={state}
          labelOf={labelOf}
          onDismiss={() => dispatch({ type: "deletion-dismissed" })}
        />
        <ExportPurgeStatus
          purge={state.purge}
          labelOf={labelOf}
          onDismiss={() => dispatch({ type: "purge-dismissed" })}
        />
        <ExportPurgeConfirmation
          purge={state.purge}
          onConfirm={() => dispatch({ type: "purge-confirmed" })}
          onCancel={() => dispatch({ type: "purge-cancelled" })}
        />
        <DeleteConfirmation
          state={state}
          onConfirm={() => dispatch({ type: "delete-confirmed" })}
          onCancel={() => dispatch({ type: "delete-cancelled" })}
        />
        <MoveStatus
          state={state}
          onDismiss={() => dispatch({ type: "move-dismissed" })}
        />
        <MoveConfirmation
          state={state}
          labelOf={labelOf}
          onConfirm={() => dispatch({ type: "move-confirmed" })}
          onCancel={() => dispatch({ type: "move-cancelled" })}
        />

        {(warnings.offline.length > 0 || warnings.dirty.length > 0) && (
          <section className="space-y-2" data-testid="drive-warnings">
            {warnings.offline.map((root) => (
              <div
                key={root.root}
                className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm"
                data-testid="drive-offline"
              >
                <AlertTriangle className="w-4 h-4 shrink-0 text-destructive" />
                <span>
                  <strong>{labelOf(root.root)} is Offline.</strong> Its files
                  can't be counted, played or exported, and nothing can be moved
                  to it until it is plugged in.
                </span>
              </div>
            ))}
            {warnings.dirty.map((root) => (
              <div
                key={root.root}
                className="flex items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm"
                data-testid="drive-dirty"
              >
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500" />
                <span>
                  <strong>{labelOf(root.root)} is Dirty:</strong> run chkdsk,
                  keep originals.
                </span>
              </div>
            ))}
          </section>
        )}

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(state.roots ?? []).map((root) => (
            <div
              key={root.root}
              className="rounded-lg border p-4 space-y-1"
              data-testid="storage-root"
            >
              <div className="flex items-center gap-2 font-semibold">
                <HardDrive className="w-4 h-4 shrink-0" />
                {labelOf(root.root)}
                <span
                  className="text-xs text-muted-foreground font-normal truncate"
                  title={root.root}
                >
                  {root.root}
                </span>
                {!root.online && <Badge variant="destructive">Offline</Badge>}
                {root.online && root.dirtyBit === "dirty" && (
                  <Badge className="bg-amber-500 text-black">Dirty</Badge>
                )}
                {root.online && root.root in state.unreadableRoots && (
                  <Badge variant="destructive">Unreadable</Badge>
                )}
              </div>
              {root.online ? (
                <div className="text-sm text-muted-foreground">
                  {gb(root.freeBytes)} free of {gb(root.totalBytes)} (
                  {gb(root.totalBytes - root.freeBytes)} used)
                </div>
              ) : (
                <div className="text-sm text-muted-foreground break-all">
                  {root.reason}
                </div>
              )}
            </div>
          ))}
        </section>

        <table className="w-full text-sm" data-testid="storage-table">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Storage Bucket</th>
              <th className="py-2 pr-4 font-medium text-right">Total</th>
              {KINDS.map(({ kind, label }) => (
                <th key={kind} className="py-2 pr-4 font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <BucketRow
                key={row.bucket.id}
                state={state}
                row={row}
                labelOf={labelOf}
                onDelete={() =>
                  dispatch({
                    type: "delete-bucket-clicked",
                    bucketId: row.bucket.id,
                  })
                }
                onPurge={() =>
                  dispatch({
                    type: "purge-bucket-clicked",
                    bucketId: row.bucket.id,
                  })
                }
                onMove={(kind, target) =>
                  dispatch({
                    type: "move-clicked",
                    bucketId: row.bucket.id,
                    kind,
                    target,
                  })
                }
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ScanStatus({ state }: { state: storagePageReducer.State }) {
  if (state.status === "scanning") {
    return (
      <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Scanning…
      </p>
    );
  }
  if (state.status === "failed") {
    return (
      <p className="mt-2 text-sm text-destructive">
        Scan failed: {state.failure}
      </p>
    );
  }
  return <p className="mt-2 text-sm text-muted-foreground">Scan complete.</p>;
}

function BucketRow({
  state,
  row,
  labelOf,
  onDelete,
  onPurge,
  onMove,
}: {
  state: storagePageReducer.State;
  row: StorageRow;
  labelOf: (location: string) => string;
  onDelete: () => void;
  onPurge: () => void;
  onMove: (kind: StorageMoveKind, target: string) => void;
}) {
  const moveBusy =
    state.move?.status === "planning" ||
    state.move?.status === "confirming" ||
    state.move?.status === "starting";
  return (
    <tr className="border-b align-top" data-testid="storage-row">
      <td className="py-2 pr-4">
        <Link
          to={`/storage/${encodeURIComponent(row.bucket.id)}`}
          className="font-medium hover:underline"
          data-testid="storage-bucket-link"
        >
          {row.bucket.name}
        </Link>
        {row.bucket.sharedBy && row.bucket.sharedBy.length > 0 && (
          <div className="text-xs text-muted-foreground">
            Used by {row.bucket.sharedBy.join(", ")}
          </div>
        )}
      </td>
      <td className="py-2 pr-4 text-right font-medium tabular-nums whitespace-nowrap">
        {gb(row.totalBytes)}
      </td>
      {KINDS.map(({ kind }) => (
        <td key={kind} className="py-2 pr-4 tabular-nums whitespace-nowrap">
          {row.bytes[kind] === 0 &&
          !storageCells(state, row, kind).some((c) => c.type === "offline") ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            storageCells(state, row, kind).map((cell) => (
              <div key={cell.location}>
                <span className="text-muted-foreground">
                  {labelOf(cell.location)}
                </span>{" "}
                {cell.type === "offline" ? (
                  <span className="text-destructive">Offline</span>
                ) : (
                  gb(cell.bytes)
                )}
              </div>
            ))
          )}
        </td>
      ))}
      <td className="py-2 pr-4 text-right space-y-1">
        {rowMoveActions(state, row).map(({ kind, target, refusal }) => (
          <Button
            key={`${kind}:${target.root}`}
            variant="outline"
            size="sm"
            className="ml-1"
            disabled={refusal !== null || moveBusy}
            title={
              refusal ??
              `Copy ${row.bucket.name}'s ${STORAGE_MOVE_KIND_LABELS[kind]} to ${labelOf(target.root)}, checked by checksum. Originals are kept.`
            }
            onClick={() => onMove(kind, target.root)}
            data-testid="storage-bucket-move"
          >
            {STORAGE_MOVE_KIND_LABELS[kind]} <ArrowRight className="w-3 h-3" />{" "}
            {labelOf(target.root)}
          </Button>
        ))}
        {bucketCanBeDeleted(row.bucket) && (
          <Button
            variant="outline"
            size="sm"
            disabled={
              state.status !== "complete" ||
              state.deletion?.status === "deleting"
            }
            title={
              state.status !== "complete"
                ? "Wait for the count to finish"
                : `Delete every file in ${row.bucket.name}`
            }
            onClick={onDelete}
            data-testid="storage-bucket-delete"
          >
            <Trash2 className="w-4 h-4" /> Delete
          </Button>
        )}
        {rowCanBePurged(row) && (
          <Button
            variant="outline"
            size="sm"
            disabled={
              state.status !== "complete" ||
              purgeIsBusy(state.purge) ||
              state.deletion?.status === "deleting"
            }
            title={
              state.status !== "complete"
                ? "Wait for the count to finish"
                : `Delete ${row.bucket.name}'s Exported Videos whose Footage is all found. Footage is never deleted.`
            }
            onClick={onPurge}
            data-testid="storage-bucket-purge"
          >
            <Trash2 className="w-4 h-4" /> Delete Exported Videos
          </Button>
        )}
      </td>
    </tr>
  );
}

/** What deleting each Other bucket means, in the confirmation. */
const DELETE_EXPLANATIONS: Record<string, string> = {
  "overlay-render-cache":
    "Every Overlay render on every drive. Each is rendered again, on demand, the next time an export needs it.",
  "export-scratch":
    "Every leftover file exports were encoded in. Refused while an export is running.",
  "orphaned-exports":
    "Every Exported Video (and its companions) that is no Video's current export, on every drive. A Video's current Exported Video is never deleted.",
};

function DeleteConfirmation({
  state,
  onConfirm,
  onCancel,
}: {
  state: storagePageReducer.State;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const deletion = state.deletion;
  const open =
    deletion?.status === "confirming" || deletion?.status === "deleting";
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      {open && (
        <DialogContent data-testid="storage-delete-confirmation">
          <DialogHeader>
            <DialogTitle>
              Delete {deletion.bucket.name}: free {gb(deletion.bytes)}?
            </DialogTitle>
            <DialogDescription>
              {DELETE_EXPLANATIONS[deletion.bucket.id]} Raw Footage is never
              deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={onCancel}
              disabled={deletion.status === "deleting"}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={onConfirm}
              disabled={deletion.status === "deleting"}
              data-testid="storage-delete-confirm"
            >
              {deletion.status === "deleting" ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Deleting…
                </>
              ) : (
                <>Delete {gb(deletion.bytes)}</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}

function DeletionStatus({
  state,
  labelOf,
  onDismiss,
}: {
  state: storagePageReducer.State;
  labelOf: (location: string) => string;
  onDismiss: () => void;
}) {
  const deletion = state.deletion;
  if (deletion?.status === "failed") {
    return (
      <div
        className="flex items-start justify-between gap-4 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm"
        data-testid="storage-delete-result"
      >
        <span>
          <strong>{deletion.bucket.name} was not deleted.</strong>{" "}
          {deletion.message}
        </span>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    );
  }
  if (deletion?.status !== "deleted") return null;
  const { deleted, left } = deletion.result;
  const files = deleted.reduce((n, d) => n + d.files, 0);
  const bytes = deleted.reduce((n, d) => n + d.bytes, 0);
  return (
    <div
      className="flex items-start justify-between gap-4 rounded-lg border p-3 text-sm"
      data-testid="storage-delete-result"
    >
      <div className="space-y-1">
        <div>
          <strong>
            Deleted {gb(bytes)} from {deletion.bucket.name}
          </strong>{" "}
          ({files} {files === 1 ? "file" : "files"}
          {deleted.length > 0 &&
            `: ${deleted.map((d) => `${gb(d.bytes)} on ${labelOf(d.location)}`).join(", ")}`}
          ).
        </div>
        {left.length > 0 && (
          <div className="text-destructive" data-testid="storage-delete-left">
            {left.length} {left.length === 1 ? "file" : "files"} left (a locked
            file can be retried):
            <ul className="list-disc pl-5">
              {left.slice(0, 10).map((l) => (
                <li key={`${l.location}:${l.path}`} className="break-all">
                  {labelOf(l.location)} {l.path}: {l.message}
                </li>
              ))}
              {left.length > 10 && <li>…and {left.length - 10} more</li>}
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
