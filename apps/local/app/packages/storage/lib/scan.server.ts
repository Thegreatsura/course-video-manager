import { statfs } from "node:fs/promises";
import path from "node:path";
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import type { Database } from "@cvm/core/services/drizzle-service.server";
import {
  classifyStorageFile,
  EXPORT_SCRATCH_BUCKET,
  type StorageFileKind,
  type StorageOwnership,
} from "./buckets";
import { loadStorageOwnership } from "./ownership.server";
import type {
  StorageRootReport,
  StorageScanMessage,
  StorageSizeDelta,
} from "./scan-wire";
import { rootLabel, STORAGE_FOLDERS, type StorageRoots } from "./storage-roots";

/** Flush counted sizes after this many files, or this long, whichever first. */
const FLUSH_EVERY_FILES = 200;
const FLUSH_EVERY_MS = 250;
/** How many files in one folder are stat-ed at once. */
const STAT_CONCURRENCY = 16;

const messageOf = (e: unknown) =>
  e instanceof Error
    ? e.message
    : typeof e === "object" && e !== null && "message" in e
      ? String((e as { message: unknown }).message)
      : String(e);

/** Each root's size and free space; a root that can't be read is Offline. */
const measureRoots = (roots: StorageRoots) =>
  Effect.forEach(
    roots,
    (root): Effect.Effect<StorageRootReport, never, FileSystem.FileSystem> =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const label = rootLabel(root);
        const readable = yield* fs.readDirectory(root).pipe(Effect.either);
        if (readable._tag === "Left") {
          return {
            root,
            label,
            online: false,
            reason: messageOf(readable.left),
          } as const;
        }
        return yield* Effect.tryPromise(() => statfs(root)).pipe(
          Effect.map((s): StorageRootReport => ({
            root,
            label,
            online: true,
            totalBytes: s.blocks * s.bsize,
            freeBytes: s.bavail * s.bsize,
          })),
          Effect.orElseSucceed((): StorageRootReport => ({
            root,
            label,
            online: false,
            reason: "could not read its free space",
          }))
        );
      }),
    { concurrency: "unbounded" }
  );

/**
 * Every file under `dir`, with its size, handed to `onFile` as it is found.
 * A file that vanishes mid-walk is skipped; a folder that can't be read fails.
 */
const walk = (
  dir: string,
  onFile: (file: string, bytes: number) => Effect.Effect<void>
): Effect.Effect<void, unknown, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const names = yield* fs.readDirectory(dir);
    const subdirs: string[] = [];
    yield* Effect.forEach(
      names,
      (name) => {
        const full = path.join(dir, name);
        return fs.stat(full).pipe(
          Effect.flatMap((info) => {
            if (info.type === "Directory") {
              subdirs.push(full);
              return Effect.void;
            }
            if (info.type !== "File") return Effect.void;
            return onFile(full, Number(info.size));
          }),
          // A file that vanished mid-walk is not counted, and not fatal.
          Effect.catchAll((error) =>
            Effect.logWarning(`[storage] skipped ${full}: ${messageOf(error)}`)
          )
        );
      },
      { concurrency: STAT_CONCURRENCY, discard: true }
    );
    for (const sub of subdirs.sort()) yield* walk(sub, onFile);
  });

/**
 * Walk the roots (and export scratch) and stream per-bucket, per-location,
 * per-kind byte totals as they are counted. Pure reading: nothing is written,
 * moved or saved.
 */
export const scanStorageFolders = (opts: {
  readonly roots: StorageRoots;
  readonly onlineRoots: readonly string[];
  readonly ownership: StorageOwnership;
  readonly scratchDir?: string;
  readonly emit: (message: StorageScanMessage) => void;
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pending = new Map<string, StorageSizeDelta>();
    let pendingFiles = 0;
    let lastFlush = Date.now();

    const flush = () => {
      if (pending.size > 0) {
        opts.emit({ type: "sizes-counted", sizes: [...pending.values()] });
      }
      pending.clear();
      pendingFiles = 0;
      lastFlush = Date.now();
    };

    const count = (
      bucketId: string,
      location: string,
      kind: StorageFileKind,
      bytes: number
    ) => {
      const key = `${bucketId}\u0000${location}\u0000${kind}`;
      const was = pending.get(key);
      pending.set(key, {
        bucketId,
        location,
        kind,
        bytes: (was?.bytes ?? 0) + bytes,
        files: (was?.files ?? 0) + 1,
      });
      pendingFiles++;
      if (
        pendingFiles >= FLUSH_EVERY_FILES ||
        Date.now() - lastFlush >= FLUSH_EVERY_MS
      ) {
        flush();
      }
    };

    for (const root of opts.onlineRoots) {
      const folders = Object.values(STORAGE_FOLDERS).map((f) =>
        path.join(root, f)
      );
      const walked = yield* Effect.forEach(
        folders,
        (folder) =>
          Effect.gen(function* () {
            const exists = yield* fs
              .exists(folder)
              .pipe(Effect.orElseSucceed(() => false));
            if (!exists) return;
            yield* walk(folder, (file, bytes) =>
              Effect.sync(() => {
                const relative = path.relative(root, file).split(path.sep);
                const owner = classifyStorageFile(
                  opts.ownership,
                  relative.join("/")
                );
                if (owner) count(owner.bucketId, root, owner.kind, bytes);
              })
            );
          }),
        { discard: true }
      ).pipe(Effect.either);
      flush();
      if (walked._tag === "Left") {
        opts.emit({
          type: "root-unreadable",
          root,
          message: messageOf(walked.left),
        });
      }
    }

    if (opts.scratchDir !== undefined) {
      const scratchDir = opts.scratchDir;
      const exists = yield* fs
        .exists(scratchDir)
        .pipe(Effect.orElseSucceed(() => false));
      if (exists) {
        yield* walk(scratchDir, (_file, bytes) =>
          Effect.sync(() =>
            count(EXPORT_SCRATCH_BUCKET.id, scratchDir, "other", bytes)
          )
        ).pipe(
          Effect.catchAll((error) =>
            Effect.logWarning(
              `[storage] export scratch ${scratchDir} could not be read: ${messageOf(error)}`
            )
          )
        );
        flush();
      }
    }
  });

/**
 * The Storage page's scan, start to finish: measure the roots, read what
 * owns each file, walk, and say when it is done. Meant to run inside an SSE
 * response: interrupting it (the page closed the stream) stops the walk, and
 * the log says so.
 */
export const streamStorageScan = (opts: {
  readonly db: Database;
  readonly roots: StorageRoots;
  readonly scratchDir?: string;
  readonly emit: (message: StorageScanMessage) => void;
}) =>
  Effect.gen(function* () {
    yield* Effect.logInfo("[storage] scan started");
    const reports = yield* measureRoots(opts.roots);
    opts.emit({ type: "roots-measured", roots: reports });
    const ownership = yield* loadStorageOwnership(opts.db, opts.roots);
    opts.emit({ type: "buckets-listed", buckets: [...ownership.buckets] });
    yield* scanStorageFolders({
      roots: opts.roots,
      onlineRoots: reports.filter((r) => r.online).map((r) => r.root),
      ownership,
      scratchDir: opts.scratchDir,
      emit: opts.emit,
    });
    opts.emit({ type: "scan-completed" });
    yield* Effect.logInfo("[storage] scan finished");
  }).pipe(
    Effect.onInterrupt(() =>
      Effect.logInfo(
        "[storage] scan aborted: the page closed the stream, the walk stopped"
      )
    )
  );
