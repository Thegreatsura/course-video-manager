import nodeFs from "node:fs/promises";
import path from "node:path";
import { Effect } from "effect";
import type { Database } from "@cvm/core/services/drizzle-service.server";
import { assertUnder } from "@/services/assert-under";
import type { StorageMoveKind, StorageMoveResult } from "./move-wire";
import {
  gb,
  messageOf,
  MOVE_PARTIAL_SUFFIX,
  realpathOrNull,
  realStorageMoveDisk,
  StorageMoveCancelledError,
  StorageMoveFailedError,
  StorageMoveRefusedError,
  type StorageMoveDisk,
} from "./move-io.server";
import { FOLDER_OF, gather } from "./move-plan.server";
import {
  Cancelled,
  checkpoint,
  DestinationFull,
  Interrupted,
  moveOne,
  removePartial,
  type Control,
  type FileOutcome,
} from "./move-copy.server";
import type { StorageRoots } from "./storage-roots";

export {
  MOVE_PARTIAL_SUFFIX,
  realStorageMoveDisk,
  StorageMoveCancelledError,
  StorageMoveFailedError,
  StorageMoveRefusedError,
  type StorageMoveDisk,
} from "./move-io.server";
export { planStorageMove } from "./move-plan.server";
export { startStorageMove } from "./move-start.server";

/**
 * MOVING A STORAGE BUCKET BETWEEN DRIVES (#2109, ADR 0041). Raw Footage is
 * copied here, so every rule leans towards never losing a take:
 *
 * - Nothing is ever deleted, renamed or written on the SOURCE. Originals stay
 *   until Matt clicks "Delete originals" (#2110).
 * - Each file is copied to `<dest>.cvm-move-partial`, resumed by size after a
 *   lost run, synced, read back and compared by SHA-256 with the original,
 *   and only then given its real name. A file at its real name on the target
 *   is therefore always a verified copy; a partial never is.
 * - An existing destination file is never overwritten: one at the same size is
 *   checked by checksum (a lost run's copy), any other is left and reported.
 * - Every folder written is checked to really be `<root>/<folder>` (no
 *   symlinked folder), and every file path to stay inside it.
 * - No database row and no Export Hash changes: paths are root-relative
 *   (ADR 0040), so the copy is found as soon as the original goes.
 * - Cancel removes the partials (this run's and any a lost run left) and
 *   leaves every original and every verified copy alone.
 */

/**
 * Move one bucket's files of `kind` to `target`: plan, refuse if anything
 * says not to, then copy and verify each file. See the top of this file for
 * the guarantees. `cancelRequested` is polled between chunks; interrupting
 * the Effect (a stopping Sidecar) stops between chunks too, leaving the
 * partial for the next run to resume.
 */
export const runStorageMove = (opts: {
  readonly db: Database;
  readonly roots: StorageRoots;
  readonly bucketId: string;
  readonly kind: StorageMoveKind;
  readonly target: string;
  /** This move's own Job: not "another move of this bucket". */
  readonly jobId?: string;
  /** Only these files (root-relative), and their companions; absent, all. */
  readonly paths?: readonly string[];
  readonly cancelRequested: () => boolean;
  readonly onProgress?: (percent: number) => void;
  readonly disk?: StorageMoveDisk;
}): Effect.Effect<
  StorageMoveResult,
  StorageMoveRefusedError | StorageMoveFailedError | StorageMoveCancelledError
> =>
  Effect.gen(function* () {
    const disk = opts.disk ?? realStorageMoveDisk;
    const { plan, files, links } = yield* gather({
      ...opts,
      disk,
      selfJobId: opts.jobId ?? null,
    });
    const folder = FOLDER_OF[opts.kind];
    const targetFolder = path.join(opts.target, folder);
    const partialsOf = () =>
      files
        .filter((f) => f.state === "copy")
        .map((f) => `${path.join(opts.target, f.path)}${MOVE_PARTIAL_SUFFIX}`);
    const sweepPartials = async () => {
      for (const partial of partialsOf()) {
        try {
          await removePartial(assertUnder(targetFolder, partial));
        } catch {
          // Outside the target's folder: never touched.
        }
      }
    };

    if (plan.refusals.length > 0) {
      return yield* new StorageMoveRefusedError({
        refusals: plan.refusals,
        message: `Not moved: ${plan.refusals.map((r) => r.message).join("; ")}`,
      });
    }

    yield* Effect.logInfo(
      `[storage] move ${plan.bucketId} ${plan.kind} to ${plan.target}: ${plan.files} files, ${plan.filesToCopy} to copy (${gb(plan.bytesToCopy)})`
    );

    return yield* Effect.tryPromise({
      try: async (signal): Promise<StorageMoveResult> => {
        const control: Control = {
          cancelRequested: opts.cancelRequested,
          signal,
        };
        const left: { path: string; message: string }[] = links.map((p) => ({
          path: p,
          message: "it is a link, not a file: never followed or moved",
        }));
        const copied = { files: 0, bytes: 0 };
        const verified = { files: 0, bytes: 0 };
        const total = Math.max(1, plan.bytes);
        let done = 0;
        let lastPercent = -1;
        const onBytes = (n: number) => {
          done += n;
          const percent = Math.min(99, Math.floor((100 * done) / total));
          if (percent > lastPercent) {
            lastPercent = percent;
            opts.onProgress?.(percent);
          }
        };
        try {
          checkpoint(control);
          await nodeFs.mkdir(targetFolder, { recursive: true });
          const realTargetFolder = await realpathOrNull(targetFolder);
          const realTarget = await realpathOrNull(opts.target);
          if (
            realTargetFolder === null ||
            realTarget === null ||
            realTargetFolder !== path.join(realTarget, folder)
          ) {
            throw new StorageMoveFailedError({
              message: `${targetFolder} really is ${realTargetFolder}: nothing was moved`,
            });
          }
          for (const file of files) {
            checkpoint(control);
            const before = done;
            let outcome: FileOutcome;
            try {
              outcome = await moveOne({
                file,
                target: opts.target,
                targetFolder,
                realTargetFolder,
                folder,
                disk,
                control,
                onBytes,
              });
            } catch (error) {
              if (
                error instanceof Cancelled ||
                error instanceof Interrupted ||
                error instanceof DestinationFull
              ) {
                throw error;
              }
              // A read or write error on this file (E: retrying I/O, say):
              // its partial goes, its original stays, the rest carry on.
              await removePartial(
                `${path.join(opts.target, file.path)}${MOVE_PARTIAL_SUFFIX}`
              ).catch(() => undefined);
              outcome = { type: "left", message: messageOf(error) };
            }
            done = before + file.bytes;
            onBytes(0);
            if (outcome.type === "copied") {
              copied.files += 1;
              copied.bytes += outcome.bytes;
            } else if (outcome.type === "verified") {
              verified.files += 1;
              verified.bytes += outcome.bytes;
            } else {
              left.push({ path: file.path, message: outcome.message });
            }
          }
        } catch (error) {
          if (error instanceof Interrupted) {
            // A stopping Sidecar: the partial stays, and the next run resumes.
            throw error;
          }
          if (error instanceof Cancelled) {
            await sweepPartials();
            throw new StorageMoveCancelledError({
              message: `Cancelled: ${copied.files} files were copied and verified and stay on ${plan.targetLabel}; partial copies were removed and every original is untouched`,
            });
          }
          if (error instanceof DestinationFull) {
            await sweepPartials();
            throw new StorageMoveFailedError({
              message: `${error.message}. ${copied.files} files were copied and verified; partial copies were removed and every original is untouched`,
            });
          }
          throw error;
        }
        opts.onProgress?.(100);
        return {
          bucketId: plan.bucketId,
          kind: plan.kind,
          target: plan.target,
          copied,
          verified,
          left,
        };
      },
      catch: (error) =>
        error instanceof StorageMoveCancelledError ||
        error instanceof StorageMoveFailedError
          ? error
          : new StorageMoveFailedError({
              message: `The move stopped: ${messageOf(error)}. Every original is untouched`,
            }),
    });
  }).pipe(
    Effect.tap((r) =>
      Effect.logInfo(
        `[storage] moved ${r.bucketId} ${r.kind} to ${r.target}: ${r.copied.files} copied, ${r.verified.files} already there, ${r.left.length} left`
      )
    )
  );
