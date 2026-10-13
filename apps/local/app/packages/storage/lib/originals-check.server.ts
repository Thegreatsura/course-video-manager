import nodeFs from "node:fs/promises";
import path from "node:path";
import { and, inArray } from "drizzle-orm";
import { jobs, recordingSessions } from "@cvm/core/db/schema";
import type { Database } from "@cvm/core/services/drizzle-service.server";
import { assertUnder } from "@/services/assert-under";
import { STORAGE_BUSY_JOB_KINDS } from "./delete-safety.server";
import {
  Cancelled,
  hashFile,
  Interrupted,
  type Control,
} from "./move-copy.server";
import { codeOf, isInside, messageOf, realpathOrNull } from "./move-io.server";
import { rootLabel } from "./storage-roots";

/**
 * "Delete originals" (#2110): the checks on one original and its copy, and
 * the delete. Every rule is listed at the top of `originals.server.ts`.
 */

/**
 * The one thing tests replace: the delete itself (to play a file Windows
 * holds open, or something changing at the last moment).
 */
export interface StorageOriginalsDisk {
  readonly unlink: (file: string) => Promise<void>;
}

export const realStorageOriginalsDisk: StorageOriginalsDisk = {
  unlink: (file) => nodeFs.unlink(file),
};

/**
 * Besides every Storage page write's own (an export, a Publish, a move):
 * a transcription writes its transcript beside the Footage, and a Clip
 * Mockup's voice writes into `clip-mockups/`.
 */
export const ORIGINALS_BUSY_JOB_KINDS = [
  ...STORAGE_BUSY_JOB_KINDS,
  "transcribe-footage",
  "transcribe-clips",
  "clip-mockup-voice",
] as const;

/** Why nothing may be deleted right now, or null. Reads the database. */
export const busyNow = async (
  db: Database,
  /** This run's own `storage-delete` Job: not "another delete". */
  selfJobId: string | null
): Promise<{
  reason: "export-running" | "recording-active";
  message: string;
} | null> => {
  const live = (
    await db
      .select({ id: jobs.id, kind: jobs.kind, title: jobs.title })
      .from(jobs)
      .where(
        and(
          inArray(jobs.kind, [...ORIGINALS_BUSY_JOB_KINDS]),
          inArray(jobs.status, ["queued", "running"])
        )
      )
  ).filter((j) => j.id !== selfJobId);
  if (live.length > 0) {
    return {
      reason: "export-running",
      message: `"${live[0]!.title}" (${live[0]!.kind}) is queued or running${live.length > 1 ? `, and ${live.length - 1} more` : ""}. Try again once it has finished.`,
    };
  }
  const recording = await db
    .select({ id: recordingSessions.id })
    .from(recordingSessions)
    .where(inArray(recordingSessions.status, ["recording"]));
  if (recording.length > 0) {
    return {
      reason: "recording-active",
      message: "A Recording Session is active. Stop recording first.",
    };
  }
  return null;
};

export type BigStats = Awaited<ReturnType<typeof nodeFs.lstat>> & {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
};

export const bigLstat = (p: string) =>
  nodeFs
    .lstat(p, { bigint: true })
    .catch(() => null) as Promise<BigStats | null>;

export const bigStat = (p: string) =>
  nodeFs
    .stat(p, { bigint: true })
    .catch(() => null) as Promise<BigStats | null>;

/**
 * Whether two existing paths may be the very same thing on disk: the same
 * device and inode, or a device that reports no inode (0) to tell them
 * apart by. Unsure is "may be".
 */
export const maybeSame = (a: BigStats, b: BigStats) =>
  a.dev === b.dev && (a.ino === b.ino || a.ino === 0n || b.ino === 0n);

export const unchanged = (before: BigStats, after: BigStats | null) =>
  after !== null &&
  after.isFile() &&
  after.dev === before.dev &&
  after.ino === before.ino &&
  after.size === before.size &&
  after.mtimeNs === before.mtimeNs;

/** One other root that may hold copies of the kind's files. */
export type CopyRoot = {
  readonly root: string;
  /** Its real `<root>/<folder>`. */
  readonly realFolder: string;
};

/**
 * Why `from` and `other` (both online) may be the same place, or null. Their
 * real paths must differ and neither be inside the other, and neither the
 * roots nor the kind's folders on them may be the same directory.
 */
export const sameRootReason = async (
  from: string,
  other: string,
  folder: string
): Promise<string | null> => {
  const [realFrom, realOther] = await Promise.all([
    realpathOrNull(from),
    realpathOrNull(other),
  ]);
  if (realFrom === null || realOther === null) return null;
  const nested = (a: string, b: string) => a === b || isInside(a, b);
  if (nested(realFrom, realOther) || nested(realOther, realFrom)) {
    return `${from} and ${other} are the same place on disk (${realFrom}, ${realOther})`;
  }
  for (const [a, b] of [
    [from, other],
    [path.join(from, folder), path.join(other, folder)],
  ] as const) {
    const [sa, sb] = await Promise.all([bigStat(a), bigStat(b)]);
    if (sa !== null && sb !== null && maybeSame(sa, sb)) {
      return `${a} and ${b} may be the same folder (the same drive mounted twice?)`;
    }
  }
  return null;
};

export type Outcome =
  | { readonly type: "deleted"; readonly bytes: number }
  | { readonly type: "candidate"; readonly bytes: number }
  | { readonly type: "kept"; readonly bytes: number }
  | { readonly type: "left"; readonly message: string };

/**
 * Check one original against its copy and, unless `dryRun`, delete it. Never
 * throws for this file's sake: any error is `left`, the original kept.
 */
export const deleteOne = async (opts: {
  readonly relative: string;
  readonly from: string;
  readonly fromFolder: string;
  readonly realFromFolder: string;
  readonly copyRoots: readonly CopyRoot[];
  readonly realConfine: string | null;
  readonly dryRun: boolean;
  readonly control: Control;
  readonly disk: StorageOriginalsDisk;
  readonly stillAllowed: () => Promise<string | null>;
  /** Bytes of the original read so far, for the Job's progress. */
  readonly onBytes: (n: number) => void;
}): Promise<Outcome> => {
  const left = (message: string): Outcome => ({ type: "left", message });

  // The original: a regular file, really inside `<from>/<folder>`.
  let src: string;
  try {
    src = assertUnder(opts.fromFolder, path.join(opts.from, opts.relative));
  } catch (error) {
    return left(messageOf(error));
  }
  const srcBefore = await bigLstat(src);
  if (srcBefore === null) return left("it is gone from its drive");
  if (!srcBefore.isFile()) return left("it is not a regular file (a link?)");
  const realSrc = await realpathOrNull(src);
  if (realSrc === null || !isInside(opts.realFromFolder, realSrc)) {
    return left(`it really is ${realSrc}, outside ${opts.realFromFolder}`);
  }
  if (opts.realConfine !== null && !isInside(opts.realConfine, realSrc)) {
    return left(
      `it really is ${realSrc}, outside ${opts.realConfine}, the only place this run may delete`
    );
  }
  const bytes = Number(srcBefore.size);

  // Its copies: the same path on each other root, regular files of the
  // same size, really inside that root's folder, and not the same file.
  const problems: string[] = [];
  const copies: { copy: string; label: string; before: BigStats }[] = [];
  for (const other of opts.copyRoots) {
    const label = rootLabel(other.root);
    const copy = path.join(other.root, opts.relative);
    const before = await bigLstat(copy);
    if (before === null) continue;
    if (!before.isFile()) {
      problems.push(`the one on ${label} is not a regular file (a link?)`);
      continue;
    }
    if (before.size !== srcBefore.size) {
      problems.push(
        `the one on ${label} is ${before.size} bytes, not ${srcBefore.size}`
      );
      continue;
    }
    const realCopy = await realpathOrNull(copy);
    if (realCopy === null || !isInside(other.realFolder, realCopy)) {
      problems.push(
        `the one on ${label} really is ${realCopy}, outside ${other.realFolder}`
      );
      continue;
    }
    if (realCopy === realSrc || maybeSame(before, srcBefore)) {
      problems.push(`the one on ${label} may be this very file`);
      continue;
    }
    copies.push({ copy, label, before });
  }
  if (copies.length === 0) {
    return problems.length === 0
      ? { type: "kept", bytes }
      : left(`kept, no identical copy elsewhere: ${problems.join("; ")}`);
  }
  if (opts.dryRun) return { type: "candidate", bytes };

  // Read both again, now, and compare. Never a checksum from earlier.
  for (const { copy, label, before } of copies) {
    let srcHash: string;
    let copyHash: string;
    try {
      [srcHash, copyHash] = await Promise.all([
        hashFile(src, opts.control, opts.onBytes),
        hashFile(copy, opts.control, () => undefined),
      ]);
    } catch (error) {
      // Cancel or a stopping Sidecar: nothing was deleted; stop here.
      if (error instanceof Cancelled || error instanceof Interrupted) {
        throw error;
      }
      problems.push(
        `the one on ${label} could not be read: ${messageOf(error)}`
      );
      continue;
    }
    if (srcHash !== copyHash) {
      problems.push(
        `checksum mismatch: the one on ${label} is not identical (same size, different contents)`
      );
      continue;
    }
    // Nothing changed or was swapped while they were read.
    const [srcAfter, copyAfter] = await Promise.all([
      bigLstat(src),
      bigLstat(copy),
    ]);
    if (!unchanged(srcBefore, srcAfter)) {
      return left("it changed while it was checked (still being written?)");
    }
    if (!unchanged(before, copyAfter)) {
      problems.push(`the one on ${label} changed while it was checked`);
      continue;
    }
    const busy = await opts.stillAllowed();
    if (busy !== null) return left(busy);
    // The last look, right before the delete: the copy is still there.
    if (!unchanged(before, await bigLstat(copy))) {
      problems.push(`the one on ${label} changed just before the delete`);
      continue;
    }
    try {
      await opts.disk.unlink(src);
    } catch (error) {
      const code = codeOf(error);
      return left(
        code === "EBUSY" || code === "EPERM" || code === "EACCES"
          ? `it is in use or locked (${code}): ${messageOf(error)}`
          : messageOf(error)
      );
    }
    return { type: "deleted", bytes };
  }
  return left(`kept, no identical copy elsewhere: ${problems.join("; ")}`);
};
