import nodeFs from "node:fs/promises";
import path from "node:path";
import { Data } from "effect";
import type { StorageMoveRefusal } from "./move-wire";

/** The disk, the errors and the small file helpers a Storage move shares. */

/** A copy in progress; never a file anything reads. */
export const MOVE_PARTIAL_SUFFIX = ".cvm-move-partial";

export const CHUNK_BYTES = 8 * 1024 * 1024;

/**
 * The disk, as the move writes to it: the one seam tests replace, to play a
 * full or a bad drive. Everything else is the real filesystem.
 */
export interface StorageMoveDisk {
  /** Bytes this process may still write on the drive holding `dir`. */
  readonly freeBytes: (dir: string) => Promise<number>;
  /** Write `length` bytes of `buffer` at `position` of the open file. */
  readonly write: (
    file: nodeFs.FileHandle,
    buffer: Buffer,
    length: number,
    position: number
  ) => Promise<void>;
}

export const realStorageMoveDisk: StorageMoveDisk = {
  freeBytes: async (dir) => {
    const s = await nodeFs.statfs(dir);
    return s.bavail * s.bsize;
  },
  write: async (file, buffer, length, position) => {
    let done = 0;
    while (done < length) {
      const { bytesWritten } = await file.write(
        buffer,
        done,
        length - done,
        position + done
      );
      done += bytesWritten;
    }
  },
};

/** The move would not start; nothing was copied. */
export class StorageMoveRefusedError extends Data.TaggedError(
  "StorageMoveRefusedError"
)<{
  readonly refusals: readonly StorageMoveRefusal[];
  readonly message: string;
}> {}

/** The move stopped part-way (a full drive, a database error). Originals intact. */
export class StorageMoveFailedError extends Data.TaggedError(
  "StorageMoveFailedError"
)<{ readonly message: string }> {}

/** The author's Cancel: partials removed, originals untouched. */
export class StorageMoveCancelledError extends Data.TaggedError(
  "StorageMoveCancelledError"
)<{ readonly message: string }> {}

export const messageOf = (e: unknown) =>
  e instanceof Error
    ? e.message
    : typeof e === "object" && e !== null && "message" in e
      ? String((e as { message: unknown }).message)
      : String(e);

export const codeOf = (e: unknown) =>
  typeof e === "object" && e !== null && "code" in e
    ? String((e as { code: unknown }).code)
    : null;

export const realpathOrNull = (p: string) =>
  nodeFs.realpath(p).catch(() => null as string | null);

export const lstatOrNull = (p: string) =>
  nodeFs
    .lstat(p)
    .catch(() => null as Awaited<ReturnType<typeof nodeFs.lstat>> | null);

export const isInside = (base: string, target: string) => {
  const relative = path.relative(base, target);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
};

export const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
