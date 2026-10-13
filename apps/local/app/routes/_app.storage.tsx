import { AlertTriangle, HardDrive, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  driveWarnings,
  storageCells,
  storageRows,
  type StorageRow,
  type storagePageReducer,
} from "@/features/storage/storage-page-reducer";
import { useStoragePage } from "@/features/storage/use-storage-page";
import type { StorageFileKind } from "@/packages/storage/client";
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
 * Videos per root. Read-only. Counted fresh on every visit and streamed in;
 * leaving the page stops the scan.
 */
export default function StoragePage() {
  const [state] = useStoragePage();
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
}: {
  state: storagePageReducer.State;
  row: StorageRow;
  labelOf: (location: string) => string;
}) {
  return (
    <tr className="border-b align-top" data-testid="storage-row">
      <td className="py-2 pr-4">
        <div className="font-medium">{row.bucket.name}</div>
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
    </tr>
  );
}
