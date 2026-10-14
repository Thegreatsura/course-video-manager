import nodeFs from "node:fs/promises";
import path from "node:path";
import { Effect } from "effect";
import type { Database } from "@cvm/core/services/drizzle-service.server";
import type {
  MovePlacedProof,
  StorageMoveKind,
  StorageMoveResult,
} from "./move-wire";
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
import { removeOwnPartials } from "./move-partials.server";
import {
  Cancelled,
  checkpoint,
  DestinationFull,
  Interrupted,
  moveOne,
  PartialNotRecorded,
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
 * - Every partial is RECORDED by the Job (a `move-partial` Job Event) before
 *   it is created, and only recorded partials are ever deleted (#2169). Every
 *   end but an interruption (Cancel, a full drive, a refusal, a failure,
 *   success with files left) removes the Job's partials; an interruption keeps
 *   them for the next run to resume, and once the Job has ended for good the
 *   Sidecar's sweep (`sweepEndedMovePartials`) removes whatever is left.
 * - Every copy placed (or verified by checksum) is RECORDED with its proof (a
 *   `move-placed` Job Event: path, size, both mtimes, SHA-256; #2179). A
 *   resumed run accepts a copy this Job placed while the source's and the
 *   copy's size and mtime still match it, and hashes any other in full.
 * - Cancel leaves every original and every verified copy alone.
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
  /**
   * Record a partial's path before it is made (#2169); rejects when it could
   * not, and the move stops. Absent (tests of the copy alone): kept in memory.
   */
  readonly recordPartial?: (partial: string) => Promise<void>;
  /** Partials this Job recorded in earlier runs: its own to resume or remove. */
  readonly ownPartials?: readonly string[];
  /** Copies this Job placed in earlier runs, with their proof (#2179). */
  readonly placed?: readonly MovePlacedProof[];
  /**
   * Record a copy just placed or verified by checksum. Best-effort: a proof
   * it could not record only means a full check on the next run.
   */
  readonly recordPlaced?: (proof: MovePlacedProof) => Promise<void>;
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
    // The partials this Job made, in any of its runs: the only ones it may
    // delete. Never a pattern match over the drive.
    const own = new Set(
      (opts.ownPartials ?? []).filter((p) => p.endsWith(MOVE_PARTIAL_SUFFIX))
    );
    const recordPartial = async (partial: string) => {
      if (own.has(partial)) return;
      try {
        await opts.recordPartial?.(partial);
      } catch (error) {
        throw new PartialNotRecorded(
          `could not record the partial copy ${partial} before making it (${messageOf(error)})`
        );
      }
      own.add(partial);
    };
    const placed = new Map((opts.placed ?? []).map((p) => [p.path, p]));
    const sweepPartials = () =>
      removeOwnPartials({ partials: [...own], target: opts.target, folder });

    if (plan.refusals.length > 0) {
      yield* Effect.tryPromise({
        try: sweepPartials,
        catch: (cause) =>
          new StorageMoveFailedError({ message: messageOf(cause) }),
      }).pipe(Effect.ignore);
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
                recordPartial,
                placed,
              });
            } catch (error) {
              if (
                error instanceof Cancelled ||
                error instanceof Interrupted ||
                error instanceof DestinationFull ||
                error instanceof PartialNotRecorded
              ) {
                throw error;
              }
              // A read or write error on this file (E: retrying I/O, say):
              // its partial goes, its original stays, the rest carry on.
              const partial = `${path.join(opts.target, file.path)}${MOVE_PARTIAL_SUFFIX}`;
              if (own.has(partial)) {
                await removeOwnPartials({
                  partials: [partial],
                  target: opts.target,
                  folder,
                });
              }
              outcome = { type: "left", message: messageOf(error) };
            }
            if (outcome.type !== "left" && outcome.proof !== undefined) {
              await opts.recordPlaced?.(outcome.proof).catch(() => undefined);
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
          // Any other end: the run is over, and so are its partials.
          await sweepPartials();
          throw error;
        }
        // Every file placed, verified or left: a partial still here (a lost
        // run's, for a file now gone or in conflict) has nothing to resume.
        await sweepPartials();
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
