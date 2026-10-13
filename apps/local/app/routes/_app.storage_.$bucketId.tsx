import { ArrowLeft, CopyX, Loader2, Trash2 } from "lucide-react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  bucketFiles,
  bucketTotals,
  fileCanBeTicked,
  originalsOffers,
  selectedBytes,
  type bucketPageReducer,
} from "@/features/storage/bucket-page-reducer";
import { deleteOriginalsIsBusy } from "@/features/storage/delete-originals";
import {
  DeleteOriginalsConfirmation,
  DeleteOriginalsStatus,
} from "@/features/storage/delete-originals-dialog";
import { purgeIsBusy } from "@/features/storage/export-purge";
import {
  ExportPurgeConfirmation,
  ExportPurgeStatus,
} from "@/features/storage/export-purge-dialog";
import { useBucketPage } from "@/features/storage/use-bucket-page";
import type { StorageFileRole } from "@/packages/storage/client";
import type { Route } from "./+types/_app.storage_.$bucketId";

export const meta: Route.MetaFunction = () => [
  { title: "CVM - Storage Bucket" },
];

/** Gigabytes as Windows counts them (GiB); small files in MB. */
const size = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${(bytes / 1024 ** 2).toFixed(1)} MB`;

const ROLE_LABELS: Record<StorageFileRole, string> = {
  footage: "Footage",
  "recording-session": "Footage (Recording Session)",
  "footage-companion": "Transcript / Whisper piece",
  "exported-video": "Exported Video",
  "export-companion": "Exported Video companion",
  "clip-mockup": "Clip Mockup",
  "overlay-render": "Overlay render",
  "export-scratch": "Export scratch",
};

/**
 * The per-bucket page (#2108): one Storage Bucket's files, largest first,
 * each with what it is and the Storage Root(s) it is on (both, mid-move).
 * Exported Videos can be ticked and deleted (#2111), if their Footage is all
 * found; every other file is listed only. After a move, "Delete originals
 * on D:" deletes the files on D: with an identical copy elsewhere (#2110).
 * Listed fresh on every visit and streamed in; leaving the page stops the
 * walk.
 */
export default function StorageBucketPage({ params }: Route.ComponentProps) {
  // A new bucket is a new listing: remount rather than reuse the state.
  return <BucketPage key={params.bucketId} bucketId={params.bucketId} />;
}

function BucketPage({ bucketId }: { bucketId: string }) {
  const [state, dispatch] = useBucketPage(bucketId);
  const files = bucketFiles(state);
  const canTick = files.some((f) => fileCanBeTicked(state, f.path));
  const totals = bucketTotals(state);
  const offers = originalsOffers(state);
  const busy =
    purgeIsBusy(state.purge) || deleteOriginalsIsBusy(state.originals);
  const labelOf = (location: string) => {
    const label =
      state.roots?.find((r) => r.root === location)?.label ?? location;
    return label.startsWith("/") ? `…/${label.split("/").pop()}` : label;
  };

  return (
    <div className="flex-1 overflow-y-auto bg-background text-foreground">
      <div className="p-8 max-w-6xl space-y-6">
        <div>
          <Link
            to="/storage"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
            data-testid="back-to-storage"
          >
            <ArrowLeft className="w-4 h-4" /> Storage
          </Link>
          <h1 className="text-3xl font-bold mb-2">
            {state.bucket?.name ?? "Storage Bucket"}
          </h1>
          {state.bucket?.sharedBy && state.bucket.sharedBy.length > 0 && (
            <p className="text-muted-foreground" data-testid="shared-by">
              Used by {state.bucket.sharedBy.join(", ")}
            </p>
          )}
          <ListingStatus state={state} fileCount={files.length} />
        </div>

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

        <DeleteOriginalsStatus
          originals={state.originals}
          labelOf={labelOf}
          onDismiss={() => dispatch({ type: "delete-originals-dismissed" })}
        />
        <DeleteOriginalsConfirmation
          originals={state.originals}
          labelOf={labelOf}
          onConfirm={() => dispatch({ type: "delete-originals-confirmed" })}
          onCancel={() => dispatch({ type: "delete-originals-cancelled" })}
        />

        {offers.length > 0 && (
          <div className="flex flex-wrap items-center gap-4 text-sm">
            {offers.map((o) => (
              <Button
                key={o.location}
                variant="outline"
                size="sm"
                disabled={busy}
                title="Delete the files here that have an identical copy (size and checksum) on another drive. A file with no copy elsewhere is never deleted."
                onClick={() =>
                  dispatch({
                    type: "delete-originals-clicked",
                    from: o.location,
                  })
                }
                data-testid="delete-originals"
              >
                <CopyX className="w-4 h-4" /> Delete originals on{" "}
                {labelOf(o.location)} ({o.files}{" "}
                {o.files === 1 ? "file" : "files"}, {size(o.bytes)})
              </Button>
            ))}
          </div>
        )}

        {canTick && (
          <div className="flex items-center gap-4 text-sm">
            <Button
              variant="outline"
              size="sm"
              disabled={
                state.status !== "complete" ||
                state.selected.length === 0 ||
                busy
              }
              title={
                state.status !== "complete"
                  ? "Wait for the listing to finish"
                  : "Delete the ticked Exported Videos whose Footage is all found. Footage is never deleted."
              }
              onClick={() => dispatch({ type: "purge-selected-clicked" })}
              data-testid="bucket-purge-selected"
            >
              <Trash2 className="w-4 h-4" /> Delete selected Exported Videos
            </Button>
            <span className="text-muted-foreground">
              {state.selected.length} ticked ({size(selectedBytes(state))})
            </span>
          </div>
        )}

        <div className="flex flex-wrap gap-4 text-sm">
          {totals.map((t) => (
            <div
              key={t.location}
              className="rounded-lg border px-4 py-2"
              title={t.location}
              data-testid="bucket-total"
            >
              <span className="font-semibold">{labelOf(t.location)}</span>{" "}
              {size(t.bytes)}{" "}
              <span className="text-muted-foreground">
                ({t.files} {t.files === 1 ? "file" : "files"})
              </span>
              {state.roots?.some(
                (r) =>
                  r.root === t.location && r.online && r.dirtyBit === "dirty"
              ) && (
                <Badge variant="destructive" className="ml-2">
                  Dirty
                </Badge>
              )}
              {t.location in state.unreadableRoots && (
                <Badge variant="destructive" className="ml-2">
                  Unreadable
                </Badge>
              )}
            </div>
          ))}
          {(state.roots ?? [])
            .filter((r) => !r.online)
            .map((r) => (
              <div key={r.root} className="rounded-lg border px-4 py-2">
                <span className="font-semibold">{r.label}</span>{" "}
                <Badge variant="destructive">Offline</Badge>
              </div>
            ))}
        </div>

        <table className="w-full text-sm" data-testid="bucket-files">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              {canTick && <th className="py-2 pr-2 w-6" />}
              <th className="py-2 pr-4 font-medium">File</th>
              <th className="py-2 pr-4 font-medium">Kind</th>
              <th className="py-2 pr-4 font-medium text-right">Size</th>
              <th className="py-2 pr-4 font-medium">On</th>
            </tr>
          </thead>
          <tbody>
            {files.map((file) => (
              <tr
                key={file.path}
                className="border-b align-top"
                data-testid="bucket-file"
              >
                {canTick && (
                  <td className="py-2 pr-2">
                    {fileCanBeTicked(state, file.path) && (
                      <input
                        type="checkbox"
                        aria-label={`Tick ${file.path}`}
                        checked={state.selected.includes(file.path)}
                        disabled={busy}
                        onChange={() =>
                          dispatch({
                            type: "export-checkbox-toggled",
                            path: file.path,
                          })
                        }
                        data-testid="bucket-file-tick"
                      />
                    )}
                  </td>
                )}
                <td className="py-2 pr-4 break-all">
                  <div>{file.path}</div>
                  {file.companionOf && (
                    <div className="text-xs text-muted-foreground">
                      beside {file.companionOf}
                    </div>
                  )}
                </td>
                <td className="py-2 pr-4 whitespace-nowrap">
                  {ROLE_LABELS[file.role]}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums whitespace-nowrap">
                  {size(file.bytes)}
                </td>
                <td className="py-2 pr-4 whitespace-nowrap space-x-1">
                  {Object.keys(file.copies).map((location) => (
                    <Badge key={location} variant="secondary" title={location}>
                      {labelOf(location)}
                    </Badge>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ListingStatus({
  state,
  fileCount,
}: {
  state: bucketPageReducer.State;
  fileCount: number;
}) {
  if (state.status === "listing") {
    return (
      <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Listing… {fileCount} files
        so far
      </p>
    );
  }
  if (state.status === "failed") {
    return (
      <p className="mt-2 text-sm text-destructive">
        Listing failed: {state.failure}
      </p>
    );
  }
  return (
    <p className="mt-2 text-sm text-muted-foreground">
      Listing complete: {fileCount} {fileCount === 1 ? "file" : "files"}.
    </p>
  );
}
