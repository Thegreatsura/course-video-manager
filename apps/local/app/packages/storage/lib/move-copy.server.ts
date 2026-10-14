import { createHash } from "node:crypto";
import nodeFs from "node:fs/promises";
import path from "node:path";
import { assertUnder } from "@/services/assert-under";
import {
  CHUNK_BYTES,
  codeOf,
  messageOf,
  gb,
  isInside,
  lstatOrNull,
  MOVE_PARTIAL_SUFFIX,
  realpathOrNull,
  type StorageMoveDisk,
} from "./move-io.server";
import type { PlannedFile } from "./move-plan.server";
import type { MovePlacedProof } from "./move-wire";
import { rootLabel } from "./storage-roots";

/** Copying and verifying one file of a Storage move. */

export class Cancelled extends Error {}
export class Interrupted extends Error {}
export class DestinationFull extends Error {}
/** The Job could not record a partial copy it was about to make: stop. */
export class PartialNotRecorded extends Error {}

export type Control = {
  readonly cancelRequested: () => boolean;
  readonly signal: AbortSignal;
};

export const checkpoint = (control: Control) => {
  if (control.signal.aborted) throw new Interrupted("interrupted");
  if (control.cancelRequested()) throw new Cancelled("cancelled");
};

/** SHA-256 of a whole file, read in chunks, stopping on Cancel. */
export const hashFile = async (
  file: string,
  control: Control,
  onBytes: (n: number) => void
) => {
  const hash = createHash("sha256");
  const fh = await nodeFs.open(file, "r");
  try {
    const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
    let position = 0;
    for (;;) {
      checkpoint(control);
      const { bytesRead } = await fh.read(buffer, 0, CHUNK_BYTES, position);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
      onBytes(bytesRead);
    }
  } finally {
    await fh.close();
  }
  return hash.digest("hex");
};

/** Unlink a partial copy, if it is one (a regular file). */
export const removePartial = async (partial: string) => {
  const info = await lstatOrNull(partial);
  if (info?.isFile()) await nodeFs.unlink(partial).catch(() => undefined);
};

/**
 * Give the verified partial its real name, never replacing a file there: a
 * hard link fails if the name is taken; exFAT has none, so there it is
 * looked for, then renamed (CVM is the only writer of these folders).
 */
export const placeNoReplace = async (partial: string, dest: string) => {
  try {
    await nodeFs.link(partial, dest);
    await nodeFs.unlink(partial);
    return "placed" as const;
  } catch (error) {
    const code = codeOf(error);
    if (code === "EEXIST") return "exists" as const;
    if (
      !["EPERM", "ENOTSUP", "EOPNOTSUPP", "EXDEV", "EMLINK", "ENOSYS"].includes(
        code ?? ""
      )
    ) {
      throw error;
    }
  }
  if ((await lstatOrNull(dest)) !== null) return "exists" as const;
  await nodeFs.rename(partial, dest);
  return "placed" as const;
};

type Placed = {
  readonly bytes: number;
  /** New proof to record; absent when an earlier run's proof held. */
  readonly proof?: MovePlacedProof;
};
export type FileOutcome =
  | ({ readonly type: "copied" } & Placed)
  | ({ readonly type: "verified" } & Placed)
  | { readonly type: "left"; readonly message: string };

/** Copy (or check) one file. Throws only Cancelled, Interrupted, DestinationFull or PartialNotRecorded. */
export const moveOne = async (opts: {
  readonly file: PlannedFile;
  readonly target: string;
  readonly targetFolder: string;
  readonly realTargetFolder: string;
  readonly folder: string;
  readonly disk: StorageMoveDisk;
  readonly control: Control;
  readonly onBytes: (n: number) => void;
  /**
   * Called with a partial's path BEFORE it is created or written, so the Job
   * has a record of every partial it made: only those are ever deleted
   * (#2169). Throws `PartialNotRecorded` when it could not record it.
   */
  readonly recordPartial: (partial: string) => Promise<void>;
  /** Copies this Job placed in earlier runs, by their absolute path (#2179). */
  readonly placed: ReadonlyMap<string, MovePlacedProof>;
}): Promise<FileOutcome> => {
  const { file, control } = opts;
  const label = rootLabel(opts.target);
  const src = path.join(file.from, file.path);
  const left = (message: string): FileOutcome => ({ type: "left", message });

  // The source: a regular file, really inside its root's folder.
  const srcInfo = await lstatOrNull(src);
  if (srcInfo === null) return left("it is gone from its drive");
  if (!srcInfo.isFile()) return left("it is not a regular file (a link?)");
  const realSrcFolder = await realpathOrNull(path.join(file.from, opts.folder));
  const realSrc = await realpathOrNull(src);
  if (
    realSrcFolder === null ||
    realSrc === null ||
    !isInside(realSrcFolder, realSrc)
  ) {
    return left(`it really is ${realSrc}, outside ${realSrcFolder}`);
  }

  // The destination and its partial: strictly inside the target's real
  // folder, every existing link along the way followed.
  let dest: string;
  let partial: string;
  try {
    dest = assertUnder(opts.targetFolder, path.join(opts.target, file.path));
    partial = assertUnder(opts.targetFolder, `${dest}${MOVE_PARTIAL_SUFFIX}`);
  } catch (error) {
    return left(messageOf(error));
  }
  const size = Number(srcInfo.size);

  const destInfo = await lstatOrNull(dest);
  if (destInfo !== null) {
    if (!destInfo.isFile()) {
      return left(
        `something that is not a file is at ${label}; never replaced`
      );
    }
    if (Number(destInfo.size) !== size) {
      return left(
        `a different file (${destInfo.size} bytes, not ${size}) is already at ${label}; never overwritten`
      );
    }
    // This Job placed it, after a full read-back match, and neither file
    // has changed since: no need to read 2 × its size again (#2179).
    const proof = opts.placed.get(dest);
    if (
      proof !== undefined &&
      proof.size === size &&
      proof.sourceMtimeMs === Number(srcInfo.mtimeMs) &&
      proof.destMtimeMs === Number(destInfo.mtimeMs)
    ) {
      return { type: "verified", bytes: size };
    }
    // A lost run's copy, or one made by hand: kept only if it is identical.
    const [a, b] = [
      await hashFile(src, control, opts.onBytes),
      await hashFile(dest, control, () => undefined),
    ];
    if (a !== b) {
      return left(
        `a different file (same size, different checksum) is already at ${label}; never overwritten`
      );
    }
    await removePartial(partial);
    return {
      type: "verified",
      bytes: size,
      proof: {
        path: dest,
        size,
        sourceMtimeMs: Number(srcInfo.mtimeMs),
        destMtimeMs: Number(destInfo.mtimeMs),
        sha256: a,
      },
    };
  }

  await nodeFs.mkdir(path.dirname(dest), { recursive: true });
  const realDir = await realpathOrNull(path.dirname(dest));
  if (
    realDir === null ||
    (realDir !== opts.realTargetFolder &&
      !isInside(opts.realTargetFolder, realDir))
  ) {
    return left(
      `its folder at ${label} really is ${realDir}, outside ${opts.realTargetFolder}`
    );
  }

  // Resume by size: a lost run's partial, if it is no longer than the source.
  const partialInfo = await lstatOrNull(partial);
  if (partialInfo !== null && !partialInfo.isFile()) {
    return left(
      `${partial} is not a file (a link?); nothing is written through it`
    );
  }
  let offset = partialInfo === null ? 0 : Number(partialInfo.size);
  if (offset > size) {
    await removePartial(partial);
    offset = 0;
  }
  const need = size - offset;
  const free = await opts.disk.freeBytes(opts.targetFolder);
  if (need > free) {
    await removePartial(partial);
    throw new DestinationFull(
      `${label} is full: ${file.path} needs ${gb(need)}, ${gb(free)} free`
    );
  }

  const sourceHash = createHash("sha256");
  await opts.recordPartial(partial);
  const out = await nodeFs.open(partial, offset > 0 ? "r+" : "wx");
  const input = await nodeFs.open(src, "r");
  // Read-ahead (#2179): the next chunk is read from the source while this one
  // is written to the target, so the two drives work at once. Two buffers:
  // one is never read into while its write is still in flight.
  const buffers = [
    Buffer.allocUnsafe(CHUNK_BYTES),
    Buffer.allocUnsafe(CHUNK_BYTES),
  ];
  const readAt = (i: number, at: number) => {
    const read = input.read(buffers[i]!, 0, CHUNK_BYTES, at);
    read.catch(() => undefined); // awaited below, or abandoned on a throw
    return read;
  };
  let current = 0;
  let reading = readAt(current, 0);
  try {
    let position = 0;
    for (;;) {
      checkpoint(control);
      const { bytesRead } = await reading;
      if (bytesRead === 0) break;
      const chunk = buffers[current]!.subarray(0, bytesRead);
      sourceHash.update(chunk);
      current = 1 - current;
      reading = readAt(current, position + bytesRead);
      if (position + bytesRead > offset) {
        // Only the part past what the lost run already wrote.
        const skip = Math.max(0, offset - position);
        await opts.disk.write(
          out,
          chunk.subarray(skip),
          bytesRead - skip,
          position + skip
        );
      }
      position += bytesRead;
      opts.onBytes(bytesRead);
    }
    await out.truncate(position);
    await out.sync();
  } catch (error) {
    if (codeOf(error) === "ENOSPC") {
      await out.close().catch(() => undefined);
      await removePartial(partial);
      throw new DestinationFull(`${label} is full (${file.path})`);
    }
    throw error;
  } finally {
    await reading.catch(() => undefined);
    await out.close().catch(() => undefined);
    await input.close().catch(() => undefined);
  }

  // Verify: what is on the target, read back, against the original.
  const copiedHash = await hashFile(partial, control, () => undefined);
  const sha256 = sourceHash.digest("hex");
  if (copiedHash !== sha256) {
    await removePartial(partial);
    return left(
      `checksum mismatch: the copy on ${label} did not match the original, so it was removed; the original is untouched`
    );
  }
  const after = await lstatOrNull(src);
  if (
    after === null ||
    Number(after.size) !== size ||
    after.mtimeMs !== srcInfo.mtimeMs
  ) {
    await removePartial(partial);
    return left(
      "it changed while it was copied (still being written?), so the copy was removed; try again later"
    );
  }

  if ((await placeNoReplace(partial, dest)) === "exists") {
    await removePartial(partial);
    return left(
      `a file appeared at ${label} while it was copied; never overwritten`
    );
  }
  const placed = await lstatOrNull(dest);
  if (placed === null || Number(placed.size) !== size) {
    return left(
      `the copy at ${label} is ${placed?.size ?? "missing"} bytes, not ${size}`
    );
  }
  return {
    type: "copied",
    bytes: size,
    proof: {
      path: dest,
      size,
      sourceMtimeMs: Number(srcInfo.mtimeMs),
      destMtimeMs: Number(placed.mtimeMs),
      sha256,
    },
  };
};
