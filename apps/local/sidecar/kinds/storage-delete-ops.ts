import { Effect, type Schema } from "effect";
import type { Database } from "@cvm/core/services/drizzle-service.server";
import { exportScratchDirectory } from "@/services/storage-roots";
import { runDeleteOriginals } from "@/packages/storage/originals";
import { purgeExportedVideos } from "@/packages/storage/purge";
import { deleteOtherStorageBucket } from "@/packages/storage/delete";
import { deleteUnusedFootage } from "@/packages/storage/unused";
import { rootLabel, type StorageRoots } from "@/packages/storage";
import type {
  StorageDeleteJobResult,
  StorageUnusedDeleteResult,
} from "@/packages/storage/client";
import { JobCancelledError } from "../job-kind";
import type { JOB_PARAMS } from "../job-params";

type Params = Schema.Schema.Type<(typeof JOB_PARAMS)["storage-delete"]>;

/** What every operation needs from the Job running it. */
export type StorageDeleteRun = {
  readonly db: Database;
  readonly roots: StorageRoots;
  readonly jobId: string;
  readonly confineTo?: string;
  readonly cancelRequested: () => boolean;
  /** 0-99 while it runs. */
  readonly onPercent: (percent: number) => void;
};

const byFiles =
  (onPercent: (p: number) => void) => (done: number, total: number) =>
    onPercent(Math.min(99, Math.floor((100 * done) / Math.max(1, total))));

const sum = (list: readonly { files: number; bytes: number }[]) => ({
  files: list.reduce((n, d) => n + d.files, 0),
  bytes: list.reduce((n, d) => n + d.bytes, 0),
});

/** "D: raw-footage/a.mkv": a left file, named with its drive. */
const where = (l: { location: string; path: string; message: string }) => ({
  path: `${rootLabel(l.location)} ${l.path}`,
  message: l.message,
});

const fromUnused = (r: StorageUnusedDeleteResult): StorageDeleteJobResult => ({
  bucketId: "unused-footage",
  operation: "delete-unused",
  location: null,
  deleted: sum(r.done),
  kept: { files: r.kept.length, bytes: 0 },
  left: r.left.map(where),
});

/** The author's Cancel, from any operation, ends the Job `cancelled`. */
const cancelled = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.catchIf(
      (e): e is E & { message: string } =>
        typeof e === "object" &&
        e !== null &&
        "_tag" in e &&
        (e._tag === "StorageDeleteCancelledError" ||
          e._tag === "StorageOriginalsCancelledError"),
      (e) => Effect.fail(new JobCancelledError({ message: e.message }))
    )
  );

/**
 * One `storage-delete` Job's work, by `operation` (#2110, #2157). Each
 * checks every refusal again, excluding this Job itself, and reports the
 * same `StorageDeleteJobResult`.
 */
export const runStorageDeleteOperation = (
  params: Params,
  run: StorageDeleteRun
) => {
  const common = {
    db: run.db,
    roots: run.roots,
    selfJobId: run.jobId,
    cancelRequested: run.cancelRequested,
    ...(run.confineTo === undefined ? {} : { confineTo: run.confineTo }),
  };
  const onProgress = byFiles(run.onPercent);
  switch (params.operation) {
    case "originals":
      return cancelled(
        runDeleteOriginals({
          ...common,
          bucketId: params.bucketId,
          from: params.from,
          ...(params.paths === undefined ? {} : { paths: params.paths }),
          onProgress: run.onPercent,
        }).pipe(
          Effect.map((o): StorageDeleteJobResult => ({
            bucketId: o.bucketId,
            operation: "originals",
            location: o.from,
            deleted: o.deleted,
            kept: o.kept,
            left: o.left,
          }))
        )
      );
    case "purge-exports":
      return cancelled(
        purgeExportedVideos({
          ...common,
          bucketId: params.bucketId,
          ...(params.exportPaths === undefined
            ? {}
            : { exportPaths: params.exportPaths }),
          onProgress,
        }).pipe(
          Effect.map((r): StorageDeleteJobResult => ({
            bucketId: r.bucketId,
            operation: "purge-exports",
            location: null,
            deleted: sum(r.deleted),
            // Videos whose Footage isn't all found: their exports stay.
            kept: {
              files: r.skipped.length,
              bytes: r.skipped.reduce((n, s) => n + s.bytes, 0),
            },
            left: r.left.map(where),
          }))
        )
      );
    case "delete-bucket":
      return cancelled(
        deleteOtherStorageBucket({
          ...common,
          bucketId: params.bucketId,
          scratchDir: exportScratchDirectory(),
          ...(params.files === undefined ? {} : { files: params.files }),
          onProgress,
        }).pipe(
          Effect.map((r): StorageDeleteJobResult => ({
            bucketId: r.bucketId,
            operation: "delete-bucket",
            location: null,
            deleted: sum(r.deleted),
            kept: { files: 0, bytes: 0 },
            left: r.left.map(where),
          }))
        )
      );
    case "delete-unused":
      return cancelled(
        deleteUnusedFootage({
          ...common,
          ...(params.files === undefined ? {} : { files: params.files }),
          onProgress,
        }).pipe(Effect.map(fromUnused))
      );
  }
};
