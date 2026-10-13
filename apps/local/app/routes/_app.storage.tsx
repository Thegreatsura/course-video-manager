import { HardDrive, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  storageLocations,
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
  const locations = storageLocations(state);
  // A drive reads "D:"; any other folder by its last segment (the full path
  // is on the root's card).
  const labelOf = (location: string) => {
    const label =
      state.roots?.find((r) => r.root === location)?.label ?? location;
    return label.startsWith("/") ? `…/${label.split("/").pop()}` : label;
  };
  const isRoot = (location: string) =>
    state.roots?.some((r) => r.root === location && r.online) ?? false;

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
                <div className="text-sm text-muted-foreground">
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
                row={row}
                locations={locations}
                labelOf={labelOf}
                isRoot={isRoot}
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
  row,
  locations,
  labelOf,
  isRoot,
}: {
  row: StorageRow;
  locations: string[];
  labelOf: (location: string) => string;
  isRoot: (location: string) => boolean;
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
          {row.bytes[kind] === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            locations
              .filter(
                (location) =>
                  isRoot(location) ||
                  (row.byLocation[location]?.[kind] ?? 0) > 0
              )
              .map((location) => (
                <div key={location}>
                  <span className="text-muted-foreground">
                    {labelOf(location)}
                  </span>{" "}
                  {gb(row.byLocation[location]?.[kind] ?? 0)}
                </div>
              ))
          )}
        </td>
      ))}
    </tr>
  );
}
