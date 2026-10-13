import nodeFs from "node:fs/promises";
import path from "node:path";
import { Data, Effect } from "effect";
import type { Database } from "@cvm/core/services/drizzle-service.server";
import { classifyStorageFile, type StorageOwnership } from "./buckets";
import { Cancelled } from "./move-copy.server";
import {
  messageOf,
  MOVE_PARTIAL_SUFFIX,
  realpathOrNull,
} from "./move-io.server";
import {
  FILE_KIND_OF,
  FOLDER_OF,
  folderRefusal,
  listFolder,
} from "./move-plan.server";
import { movableKindsOf, type StorageMoveKind } from "./move-wire";
import {
  busyNow,
  deleteOne,
  realStorageOriginalsDisk,
  sameRootReason,
  type CopyRoot,
  type StorageOriginalsDisk,
} from "./originals-check.server";
import type {
  StorageOriginalsRefusalReason,
  StorageOriginalsResult,
} from "./originals-wire";
import { loadStorageOwnership } from "./ownership.server";
import { holdingStorageWrites } from "./storage-busy";
import { rootLabel, type StorageRoots } from "./storage-roots";

export {
  ORIGINALS_BUSY_JOB_KINDS,
  realStorageOriginalsDisk,
  type StorageOriginalsDisk,
} from "./originals-check.server";

/**
 * DELETE ORIGINALS (#2110, ADR 0041). The one place CVM deletes raw Footage,
 * and only ever as a duplicate. For each of the bucket's files on `from`:
 *
 * - The copy is the same root-relative path on ANOTHER Storage Root. Both are
 *   regular files (never a link, never followed), each really inside its own
 *   root's real folder, and they are different files: different real paths
 *   and, on the same device, different inodes. Two roots that are, or may be,
 *   the same folder (a link, a bind mount, the same drive mounted twice, a
 *   case-insensitive alias) refuse the whole run.
 * - Just before the delete, both files are read again in full and their
 *   SHA-256s compared, then both are looked at once more: same size, same
 *   modification time, same inode as when the read began. Never a stored or
 *   earlier checksum. Any mismatch or error keeps the original.
 * - One file at a time, each logged. One Windows won't let go of is left
 *   and reported, and the rest carry on.
 * - Refused while an export, a Publish, a move, a transcription, a Clip
 *   Mockup voice or a Recording Session is queued or running, or a Purge, a
 *   delete or a move is being started; looked for again before each delete,
 *   so one that starts part-way stops the run.
 *
 * No row and no Export Hash changes: paths are root-relative (ADR 0040), so
 * every file is found on the other root as soon as its original goes.
 */

export class StorageOriginalsRefusedError extends Data.TaggedError(
  "StorageOriginalsRefusedError"
)<{
  readonly bucketId: string;
  readonly reason: StorageOriginalsRefusalReason;
  readonly message: string;
}> {}

/** The author's Cancel: stopped before the next file; what went stays gone. */
export class StorageOriginalsCancelledError extends Data.TaggedError(
  "StorageOriginalsCancelledError"
)<{ readonly bucketId: string; readonly message: string }> {}

/** Reading the roots or the database failed before anything was deleted. */
export class StorageOriginalsFailedError extends Data.TaggedError(
  "StorageOriginalsFailedError"
)<{ readonly bucketId: string; readonly message: string }> {}

type CoreOptions = {
  readonly db: Database;
  readonly roots: StorageRoots;
  readonly bucketId: string;
  /** The Storage Root to delete the originals from. */
  readonly from: string;
  readonly dryRun: boolean;
  /** This run's own `storage-delete` Job, if it is one. */
  readonly selfJobId?: string;
  readonly cancelRequested?: () => boolean;
  /** 0-99 while it runs, by bytes of the originals read. */
  readonly onProgress?: (percent: number) => void;
  /** Delete nothing outside this folder (a verify-cvm run's own directory). */
  readonly confineTo?: string;
  readonly disk?: StorageOriginalsDisk;
};

type CoreError =
  | StorageOriginalsRefusedError
  | StorageOriginalsFailedError
  | StorageOriginalsCancelledError;

/**
 * Every refusal, then each of the bucket's files on `from`, one at a time.
 * `dryRun` reads no contents and deletes nothing: the confirmation's count.
 */
const originalsCore = (
  opts: CoreOptions
): Effect.Effect<StorageOriginalsResult, CoreError> => {
  const { bucketId, roots, from, dryRun } = opts;
  const selfJobId = opts.selfJobId ?? null;
  const cancelRequested = opts.cancelRequested ?? (() => false);
  const disk = opts.disk ?? realStorageOriginalsDisk;
  const refuse = (reason: StorageOriginalsRefusalReason, message: string) =>
    new StorageOriginalsRefusedError({
      bucketId,
      reason,
      message: `Not deleted: ${message}`,
    });
  const failed = (cause: unknown) =>
    new StorageOriginalsFailedError({ bucketId, message: messageOf(cause) });
  /** A read of the disk before any file is touched; a rejection fails the run. */
  const io = <A>(f: () => Promise<A>) =>
    Effect.tryPromise({ try: f, catch: failed });

  const run = Effect.gen(function* () {
    const ownership: StorageOwnership = yield* loadStorageOwnership(
      opts.db,
      roots
    ).pipe(Effect.mapError(failed));
    const bucket = ownership.buckets.find((b) => b.id === bucketId);
    const kinds: StorageMoveKind[] = bucket ? movableKindsOf(bucket) : [];
    if (bucket === undefined || kinds.length === 0) {
      return yield* refuse(
        "not-deletable",
        `"${bucketId}" has no files that are moved, so no originals`
      );
    }
    const others = roots.filter((r) => r !== from);
    if (!roots.includes(from) || others.length === 0) {
      return yield* refuse(
        "unknown-root",
        roots.includes(from)
          ? "there is no other Storage Root to hold a copy"
          : `${from} is not a Storage Root`
      );
    }
    const busy = yield* Effect.tryPromise({
      try: () => busyNow(opts.db, selfJobId),
      catch: failed,
    });
    if (busy !== null) return yield* refuse(busy.reason, busy.message);

    const fromOnline = yield* io(() =>
      nodeFs.readdir(from).then(
        () => true,
        () => false
      )
    );
    if (!fromOnline) {
      return yield* refuse("offline", `${rootLabel(from)} is Offline`);
    }
    const realConfine =
      opts.confineTo === undefined
        ? null
        : ((yield* io(() => realpathOrNull(opts.confineTo!))) ??
          opts.confineTo);

    // Every check that refuses the whole run, before a file is looked at.
    type KindPlan = {
      kind: StorageMoveKind;
      folder: string;
      fromFolder: string;
      realFromFolder: string;
      copyRoots: CopyRoot[];
    };
    const plans: KindPlan[] = [];
    for (const kind of kinds) {
      const folder = FOLDER_OF[kind];
      const fromFolder = path.join(from, folder);
      const realFromFolder = yield* io(() => realpathOrNull(fromFolder));
      if (realFromFolder === null) continue; // nothing of this kind on `from`
      const unsafe = yield* io(() => folderRefusal(from, folder));
      if (unsafe) return yield* refuse("unsafe-folder", unsafe);
      const copyRoots: CopyRoot[] = [];
      for (const other of others) {
        const same = yield* io(() => sameRootReason(from, other, folder));
        if (same) return yield* refuse("same-root", same);
        const otherFolder = path.join(other, folder);
        const realFolder = yield* io(() => realpathOrNull(otherFolder));
        // Offline, or no such folder: holds no copies.
        if (realFolder === null) continue;
        // A folder that is not really where it is named holds no copies.
        if (yield* io(() => folderRefusal(other, folder))) continue;
        copyRoots.push({ root: other, realFolder });
      }
      plans.push({ kind, folder, fromFolder, realFromFolder, copyRoots });
    }

    const deleted = { files: 0, bytes: 0 };
    const kept = { files: 0, bytes: 0 };
    const left: { path: string; message: string }[] = [];
    // Set once an export, a recording… starts part-way: nothing more goes.
    const run_ = { stopped: null as string | null };
    const stillAllowed = async () => {
      const now = await busyNow(opts.db, selfJobId);
      if (now === null) return null;
      run_.stopped = `stopped before deleting it: ${now.message}`;
      return run_.stopped;
    };
    const stoppedFailure = (cause: unknown) =>
      cause instanceof Cancelled
        ? new StorageOriginalsCancelledError({
            bucketId,
            message: `Cancelled: ${deleted.files} originals were deleted, each with an identical copy elsewhere; every other file is still on ${rootLabel(from)}`,
          })
        : new StorageOriginalsFailedError({
            bucketId,
            message: `Stopped: ${messageOf(cause)}. ${deleted.files} originals were deleted, each with an identical copy elsewhere; every other file is still on ${rootLabel(from)}`,
          });

    // The bucket's files on `from`, every kind, before any is touched.
    const todo: { relative: string; bytes: number; plan: KindPlan }[] = [];
    for (const plan of plans) {
      const links: string[] = [];
      const found = yield* Effect.tryPromise({
        try: () => listFolder(from, plan.fromFolder, links),
        catch: stoppedFailure,
      });
      for (const link of links) {
        if (classifyStorageFile(ownership, link)?.bucketId !== bucket.id) {
          continue;
        }
        left.push({
          path: link,
          message: "it is a link, not a file: never followed or deleted",
        });
      }
      for (const f of found) {
        if (f.relative.endsWith(MOVE_PARTIAL_SUFFIX)) continue;
        const cls = classifyStorageFile(ownership, f.relative);
        if (
          cls === null ||
          cls.bucketId !== bucket.id ||
          cls.kind !== FILE_KIND_OF[plan.kind]
        )
          continue;
        todo.push({ relative: f.relative, bytes: f.bytes, plan });
      }
    }

    const total = Math.max(
      1,
      todo.reduce((n, f) => n + f.bytes, 0)
    );
    let done = 0;
    let lastPercent = -1;
    const report = (bytes: number) => {
      done += bytes;
      const percent = Math.min(99, Math.floor((100 * done) / total));
      if (percent > lastPercent) {
        lastPercent = percent;
        opts.onProgress?.(percent);
      }
    };

    for (const f of todo) {
      if (run_.stopped !== null) {
        left.push({ path: f.relative, message: run_.stopped });
        continue;
      }
      if (cancelRequested()) return yield* stoppedFailure(new Cancelled());
      const before = done;
      // One file at a time; an error on this file keeps it and moves on.
      const outcome = yield* Effect.tryPromise({
        try: (signal) =>
          deleteOne({
            relative: f.relative,
            from,
            fromFolder: f.plan.fromFolder,
            realFromFolder: f.plan.realFromFolder,
            copyRoots: f.plan.copyRoots,
            realConfine,
            dryRun,
            control: { cancelRequested, signal },
            disk,
            stillAllowed,
            onBytes: report,
          }),
        catch: stoppedFailure,
      });
      done = before;
      report(f.bytes);
      switch (outcome.type) {
        case "deleted":
          // The record of each file that went, as it goes.
          yield* Effect.logInfo(
            `[storage] deleted original ${path.join(from, f.relative)} (${outcome.bytes} bytes): an identical copy was verified on another root`
          );
          deleted.files += 1;
          deleted.bytes += outcome.bytes;
          break;
        case "candidate":
          deleted.files += 1;
          deleted.bytes += outcome.bytes;
          break;
        case "kept":
          kept.files += 1;
          kept.bytes += outcome.bytes;
          break;
        case "left":
          if (!dryRun) {
            yield* Effect.logWarning(
              `[storage] original kept ${path.join(from, f.relative)}: ${outcome.message}`
            );
          }
          left.push({ path: f.relative, message: outcome.message });
          break;
      }
    }
    return {
      bucketId,
      bucketName: bucket.name,
      from,
      dryRun,
      deleted,
      kept,
      left,
    };
  }).pipe(
    Effect.tap((r) =>
      r.dryRun
        ? Effect.void
        : Effect.logInfo(
            `[storage] deleted originals of ${r.bucketId} on ${r.from}: ${r.deleted.files} files (${r.deleted.bytes} bytes), ${r.kept.files} kept (no copy elsewhere), ${r.left.length} left`
          )
    )
  );

  return run;
};

const busyRefusal = (bucketId: string) => (heldBy: string) =>
  new StorageOriginalsRefusedError({
    bucketId,
    reason: "storage-busy",
    message: `Not deleted: ${heldBy} is under way on the Storage page. Try again in a moment.`,
  });

/**
 * The confirmation: how many of the bucket's files on `from` have a same-size
 * copy on another root, and their bytes, and every refusal. Reads only; no
 * file's contents.
 */
export const planStorageOriginals = (
  opts: Omit<
    CoreOptions,
    "dryRun" | "selfJobId" | "cancelRequested" | "onProgress" | "disk"
  >
) =>
  originalsCore({ ...opts, dryRun: true }).pipe(
    Effect.catchTag("StorageOriginalsCancelledError", (e) =>
      Effect.fail(
        new StorageOriginalsFailedError({
          bucketId: e.bucketId,
          message: e.message,
        })
      )
    )
  );

/**
 * Start "Delete originals" (#2110): check every refusal, and that there is
 * something to delete, then `enqueue` its `storage-delete` Job, all while
 * holding the Storage page's write hold, so no Purge, delete or move is
 * part-way through when it is queued (after which they refuse while it is
 * queued or running).
 */
export const startDeleteOriginals = <A, E, R>(
  opts: Omit<
    CoreOptions,
    "dryRun" | "selfJobId" | "cancelRequested" | "onProgress" | "disk"
  > & {
    readonly enqueue: (plan: StorageOriginalsResult) => Effect.Effect<A, E, R>;
  }
): Effect.Effect<
  A,
  E | StorageOriginalsRefusedError | StorageOriginalsFailedError,
  R
> =>
  holdingStorageWrites(
    "Delete originals being started",
    busyRefusal(opts.bucketId),
    Effect.gen(function* () {
      const plan = yield* planStorageOriginals(opts);
      if (plan.deleted.files === 0) {
        return yield* new StorageOriginalsRefusedError({
          bucketId: opts.bucketId,
          reason: "nothing-to-delete",
          message: `Not deleted: no file on ${rootLabel(opts.from)} has a copy of the same size on another drive`,
        });
      }
      return yield* opts.enqueue(plan);
    })
  );

/**
 * The `storage-delete` Job's work for "Delete originals": every refusal
 * checked again, then each file checked against its copy and deleted. See
 * the top of this file.
 */
export const runDeleteOriginals = (
  opts: Omit<CoreOptions, "dryRun">
): Effect.Effect<StorageOriginalsResult, CoreError> =>
  holdingStorageWrites(
    "Deleting originals",
    busyRefusal(opts.bucketId),
    originalsCore({ ...opts, dryRun: false })
  );
