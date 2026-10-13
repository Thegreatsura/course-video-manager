import nodeFs from "node:fs/promises";
import path from "node:path";
import { Effect } from "effect";
import { classifyStorageFile, UNUSED_FOOTAGE_BUCKET } from "./buckets";
import {
  messageOf,
  realConfineOf,
  realpathOrNull,
  stopIfCancelled,
} from "./delete-safety.server";
import { loadStorageOwnership } from "./ownership.server";
import { STORAGE_FOLDERS } from "./storage-roots";
import {
  TRASH_FOLDER,
  trashBatchName,
  UNUSED_FOOTAGE_MIN_AGE_MS,
  type StorageTrashResult,
} from "./trash-wire";

import {
  type Common,
  checkNotBusy,
  footagePathProblem,
  checkRoot,
  regularFileProblem,
  walk,
  extendsAny,
  removeEmptyParents,
  tally,
  held,
  logResult,
  StorageTrashRefusedError,
  StorageTrashFailedError,
  type TrashFileRef,
  trashFailure,
  type TrashCancelled,
} from "./trash-checks.server";

/**
 * THE TRASH (#2157): Unused Footage is moved to `<root>/.cvm-trash/` on its
 * own Storage Root first, put back by Restore, and deleted for good after 14
 * days (or by "Empty trash").
 *
 * Raw Footage is the one thing that can't be made again, so every check
 * leans towards keeping it:
 * - Only Unused Footage: a file no Clip, live or archived, in any Video uses
 *   (read fresh from the database here, never taken from the page), no
 *   Recording Session still recording or under 7 days old uses, and no AV
 *   Calibration or Video names. A file changed in the last 7 days is kept.
 * - A rename on the same root, never a copy, so a file never crosses drives;
 *   the trash and the file must be on the same device, or it is left.
 * - Every path is checked on disk: a regular file, never a link, whose real
 *   path is exactly where its root-relative path says (no link anywhere on
 *   the way), under the real `raw-footage/` or `.cvm-trash/` of a real root.
 * - Nothing is ever overwritten: a restore whose place is taken is left.
 * - Refused while an export, a Publish, a move, a transcription, another
 *   delete or a recording is queued or running.
 */

/**
 * Move Unused Footage to the trash on its own Storage Root (#2157).
 *
 * `files` keeps it to the files named (root and root-relative path, from the
 * per-bucket page); absent, every Unused Footage file on every root. Each is
 * classified again from the database here: a file a Clip uses, a Recording
 * Session still recording or under 7 days old, an AV Calibration, or a file
 * changed in the last 7 days is kept and reported. One that fails a check on
 * disk, or that Windows won't let go of, is left and reported; the rest
 * still go.
 */
export const trashUnusedFootage = (
  opts: Common & {
    readonly files?: readonly TrashFileRef[];
    /** Names this batch's folder; the Job's id. */
    readonly batchId?: string;
  }
): Effect.Effect<
  StorageTrashResult,
  StorageTrashRefusedError | StorageTrashFailedError | TrashCancelled
> =>
  held(
    "a move to the trash",
    Effect.gen(function* () {
      const now = opts.now ?? new Date();
      const dryRun = opts.dryRun ?? false;
      yield* checkNotBusy(opts, true);
      const ownership = yield* loadStorageOwnership(
        opts.db,
        opts.roots,
        now
      ).pipe(
        Effect.mapError(
          (e) => new StorageTrashFailedError({ message: e.message })
        )
      );
      // A Recording Session's (or AV Calibration's) folder in use keeps
      // everything in it, not just the files a row names.
      const protectedDirs = new Set(
        [...ownership.recordingSessionFootage, ...ownership.keptFootage]
          .map((p) => path.posix.dirname(p))
          .filter((d) => d !== STORAGE_FOLDERS.rawFootage && d !== ".")
      );
      const batch = trashBatchName(
        now,
        (opts.batchId ?? crypto.randomUUID()).slice(0, 36)
      );

      return yield* Effect.tryPromise({
        try: async (): Promise<StorageTrashResult> => {
          const realConfine = await realConfineOf(opts.confineTo);
          const kept: StorageTrashResult["kept"] = [];
          const left: StorageTrashResult["left"] = [];
          const done = tally();
          const wanted =
            opts.files === undefined
              ? null
              : new Map<string, Set<string>>(
                  opts.roots.map((r) => [
                    r,
                    new Set(
                      opts
                        .files!.filter((f) => f.location === r)
                        .map((f) => f.path)
                    ),
                  ])
                );
          for (const f of opts.files ?? []) {
            if (!opts.roots.includes(f.location)) {
              left.push({
                path: f.path,
                location: f.location,
                message: "Left: not a Storage Root",
              });
            }
          }

          // What would go, root by root, every check but the rename's own.
          type Candidate = {
            root: string;
            realRoot: string;
            relative: string;
            bytes: number;
          };
          const candidates: Candidate[] = [];
          for (const root of opts.roots) {
            const only = wanted?.get(root);
            if (only !== undefined && only.size === 0) continue;
            const checked = await checkRoot(
              root,
              STORAGE_FOLDERS.rawFootage,
              realConfine
            );
            if (checked.problem !== null || checked.realFolder === null) {
              if (checked.problem !== null && only !== undefined) {
                for (const p of only) {
                  left.push({
                    path: p,
                    location: root,
                    message: `Left: ${checked.problem}`,
                  });
                }
              }
              continue;
            }
            const links: string[] = [];
            let found: Awaited<ReturnType<typeof walk>>;
            try {
              found = await walk(
                root,
                path.join(root, STORAGE_FOLDERS.rawFootage),
                links
              );
            } catch (error) {
              for (const p of only ?? []) {
                left.push({
                  path: p,
                  location: root,
                  message: messageOf(error),
                });
              }
              continue;
            }
            const byPath = new Map(found.map((f) => [f.relative, f]));
            const consider =
              only === undefined
                ? found.map((f) => f.relative)
                : [...only].sort();
            for (const relative of consider) {
              const problem = footagePathProblem(relative);
              if (problem !== null) {
                left.push({
                  path: relative,
                  location: root,
                  message: `Left: ${problem}`,
                });
                continue;
              }
              const file = byPath.get(relative);
              if (file === undefined) {
                left.push({
                  path: relative,
                  location: root,
                  message: links.includes(relative)
                    ? "Left: it is a link, never followed"
                    : "Left: it is gone",
                });
                continue;
              }
              const cls = classifyStorageFile(ownership, relative);
              if (cls?.bucketId !== UNUSED_FOOTAGE_BUCKET.id) {
                // Whole-bucket runs only look at Unused Footage; a file named
                // on the page that is not is reported.
                if (only !== undefined) {
                  kept.push({
                    path: relative,
                    location: root,
                    reason: "a Clip or a recent Recording Session uses it",
                  });
                }
                continue;
              }
              if (extendsAny(ownership.keptFootage, relative)) {
                kept.push({
                  path: relative,
                  location: root,
                  reason: "an AV Calibration or a Video names it",
                });
                continue;
              }
              if (protectedDirs.has(path.posix.dirname(relative))) {
                kept.push({
                  path: relative,
                  location: root,
                  reason:
                    "it is in the folder of a Recording Session or AV Calibration still in use",
                });
                continue;
              }
              if (now.getTime() - file.mtimeMs < UNUSED_FOOTAGE_MIN_AGE_MS) {
                kept.push({
                  path: relative,
                  location: root,
                  reason: "it changed less than 7 days ago",
                });
                continue;
              }
              candidates.push({
                root,
                realRoot: checked.realRoot,
                relative,
                bytes: file.bytes,
              });
            }
          }

          let progressed = 0;
          const total = candidates.length;
          for (const c of candidates) {
            stopIfCancelled(opts.cancelRequested);
            const step = await trashOne(c, batch, dryRun);
            if (step === null) done.add(c.root, c.bytes);
            else
              left.push({
                path: c.relative,
                location: c.root,
                message: `Left: ${step}`,
              });
            progressed += 1;
            opts.onProgress?.(progressed, total);
          }
          return {
            operation: "trash",
            dryRun,
            batch: dryRun ? null : batch,
            done: done.list(),
            kept,
            left,
          };
        },
        catch: trashFailure,
      });
    }),
    opts.alreadyHeld
  ).pipe(Effect.tap(logResult));

/** The trash folder on `root`, made if missing, checked to be really there. */
const trashFolderOf = async (root: string, realRoot: string) => {
  const at = path.join(root, TRASH_FOLDER);
  const info = await nodeFs.lstat(at).catch(() => null);
  if (info === null) await nodeFs.mkdir(at);
  const after = await nodeFs.lstat(at);
  if (!after.isDirectory()) throw new Error(`${at} is not a folder (a link?)`);
  const real = await realpathOrNull(at);
  if (real !== path.join(realRoot, TRASH_FOLDER)) {
    throw new Error(
      `${at} really is ${real ?? "unresolvable"}, not on ${root}`
    );
  }
  return at;
};

/** Rename one file into the trash; null when done, else why it was left. */
const trashOne = async (
  c: { root: string; realRoot: string; relative: string },
  batch: string,
  dryRun: boolean
): Promise<string | null> => {
  const problem = await regularFileProblem(c.root, c.realRoot, c.relative);
  if (problem !== null) return problem;
  if (dryRun) return null;
  const source = path.join(c.root, c.relative);
  try {
    const trash = await trashFolderOf(c.root, c.realRoot);
    const batchDir = path.join(trash, batch);
    await nodeFs.mkdir(batchDir, { recursive: true });
    // Same drive, or nothing: a rename never crosses drives, and the trash
    // is checked to be on the file's own device first.
    const [fileInfo, batchInfo] = await Promise.all([
      nodeFs.lstat(source),
      nodeFs.stat(batchDir),
    ]);
    if (fileInfo.dev !== batchInfo.dev) {
      return "the trash is on another drive; a file is never moved across drives";
    }
    const dest = path.join(batchDir, c.relative);
    await nodeFs.mkdir(path.dirname(dest), { recursive: true });
    const realDestDir = await realpathOrNull(path.dirname(dest));
    if (
      realDestDir !==
      path.join(c.realRoot, TRASH_FOLDER, batch, path.dirname(c.relative))
    ) {
      return "the trash folder is not where it should be (a link?)";
    }
    if ((await nodeFs.lstat(dest).catch(() => null)) !== null) {
      return "something is already at its place in the trash";
    }
    // Checked again just before the rename.
    const again = await regularFileProblem(c.root, c.realRoot, c.relative);
    if (again !== null) return again;
    await nodeFs.rename(source, dest);
  } catch (error) {
    // Windows has it open, say (or EXDEV: never copied instead).
    return messageOf(error);
  }
  await removeEmptyParents(
    path.dirname(source),
    path.join(c.root, STORAGE_FOLDERS.rawFootage)
  );
  return null;
};
