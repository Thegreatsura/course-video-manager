import nodeFs from "node:fs/promises";
import path from "node:path";
import { and, inArray, ne } from "drizzle-orm";
import { Data, Effect } from "effect";
import { jobs, recordingSessions } from "@cvm/core/db/schema";
import type { Database } from "@cvm/core/services/drizzle-service.server";
import {
  isAtOrInside,
  isInside,
  cancelledOr,
  messageOf,
  type StorageDeleteCancelledError,
  realpathOrNull,
  STORAGE_BUSY_JOB_KINDS,
  storageBusyMessage,
} from "./delete-safety.server";
import { holdingStorageWrites } from "./storage-busy";
import { STORAGE_FOLDERS, type StorageRoots } from "./storage-roots";
import type {
  StorageUnusedDeleteResult,
  StorageUnusedRefusalReason,
} from "./unused-wire";

/** The checks and helpers deleting Unused Footage uses (#2157, #2423). */

/** Why deleting Unused Footage did not start. Nothing was deleted. */
export class StorageUnusedDeleteRefusedError extends Data.TaggedError(
  "StorageUnusedDeleteRefusedError"
)<{
  readonly reason: StorageUnusedRefusalReason;
  readonly message: string;
}> {}

/** Reading the roots or the database failed before anything was touched. */
export class StorageUnusedDeleteFailedError extends Data.TaggedError(
  "StorageUnusedDeleteFailedError"
)<{ readonly message: string }> {}

/**
 * The Job kinds deleting Unused Footage never runs beside: every encode and
 * Publish, a Storage move, a delete Job, and transcriptions (which read
 * Footage and write its transcript beside it).
 */
export const UNUSED_DELETE_BUSY_JOB_KINDS = [
  ...STORAGE_BUSY_JOB_KINDS,
  "transcribe-footage",
  "transcribe-clips",
] as const;

/** A file to delete: on which root, at which root-relative path. */
export type UnusedFileRef = {
  readonly location: string;
  readonly path: string;
};

export type Common = {
  readonly db: Database;
  readonly roots: StorageRoots;
  /** Change nothing, answer what would be done: the confirmation. */
  readonly dryRun?: boolean;
  /** Touch nothing outside this folder (a verify-cvm run's own directory). */
  readonly confineTo?: string;
  /** The Job doing this: not a reason for it to refuse itself. */
  readonly selfJobId?: string | null;
  readonly now?: Date;
  /** Called after each file, done or not. */
  readonly onProgress?: (done: number, total: number) => void;
  /** The author's Cancel: stop before the next file. */
  readonly cancelRequested?: () => boolean;
  /** The caller holds the Storage page's write hold already (a start). */
  readonly alreadyHeld?: boolean;
};

export const refused = (reason: StorageUnusedRefusalReason, message: string) =>
  new StorageUnusedDeleteRefusedError({ reason, message });

/** Every refusal that holds right now, the first one failing. */
export const checkNotBusy = (opts: Common, needsNoRecording: boolean) =>
  Effect.gen(function* () {
    const live = yield* Effect.tryPromise({
      try: () =>
        opts.db
          .select({ id: jobs.id, kind: jobs.kind, title: jobs.title })
          .from(jobs)
          .where(
            and(
              inArray(jobs.kind, [...UNUSED_DELETE_BUSY_JOB_KINDS]),
              inArray(jobs.status, ["queued", "running"]),
              opts.selfJobId ? ne(jobs.id, opts.selfJobId) : undefined
            )
          ),
      catch: (cause) =>
        new StorageUnusedDeleteFailedError({
          message: `Could not check for running Jobs: ${messageOf(cause)}`,
        }),
    });
    if (live.length > 0) {
      return yield* refused(
        "storage-job-running",
        `Not done: "${live[0]!.title}" is queued or running${live.length > 1 ? ` (and ${live.length - 1} more)` : ""}. Try again once it has finished.`
      );
    }
    if (!needsNoRecording) return;
    const recording = yield* Effect.tryPromise({
      try: () =>
        opts.db
          .select({ id: recordingSessions.id })
          .from(recordingSessions)
          .where(inArray(recordingSessions.status, ["recording"])),
      catch: (cause) =>
        new StorageUnusedDeleteFailedError({
          message: `Could not check for a recording: ${messageOf(cause)}`,
        }),
    });
    if (recording.length > 0) {
      return yield* refused(
        "recording-active",
        "Not done: a Recording Session is recording, writing new Footage into raw-footage/. Stop recording first."
      );
    }
  });

/** A root-relative path under `raw-footage/`, with nothing odd in it. */
export const footagePathProblem = (relative: string): string | null => {
  if (relative.includes("\\") || relative.includes("\0")) {
    return "it is not a plain path";
  }
  const normalized = path.posix.normalize(relative);
  if (
    normalized !== relative ||
    path.posix.isAbsolute(relative) ||
    relative.split("/").some((s) => s === "" || s === "." || s === "..")
  ) {
    return "it is not a plain root-relative path";
  }
  if (!relative.startsWith(`${STORAGE_FOLDERS.rawFootage}/`)) {
    return "it is not under raw-footage/";
  }
  return null;
};

/**
 * A Storage Root, checked: real path, and the real path of `<root>/<folder>`
 * when it is exactly there (never a link elsewhere). `folder` null when it
 * is missing; `problem` when the root must not be touched at all.
 */
export const checkRoot = async (
  root: string,
  folder: string,
  realConfine: string | null
): Promise<
  | { problem: string }
  | { problem: null; realRoot: string; realFolder: string | null }
> => {
  const realRoot = await realpathOrNull(root);
  if (realRoot === null) return { problem: `${root} is Offline` };
  if (realConfine !== null && !isAtOrInside(realConfine, realRoot)) {
    return {
      problem: `${realRoot} is outside ${realConfine}, the only place this run may touch`,
    };
  }
  const at = path.join(root, folder);
  const info = await nodeFs.lstat(at).catch(() => null);
  if (info === null) return { problem: null, realRoot, realFolder: null };
  if (!info.isDirectory()) {
    return { problem: `${at} is not a folder (a link?)` };
  }
  const real = await realpathOrNull(at);
  if (real !== path.join(realRoot, folder)) {
    return {
      problem: `${at} really is ${real ?? "unresolvable"}, not inside ${root}`,
    };
  }
  return { problem: null, realRoot, realFolder: real };
};

/**
 * Why the regular file at `<root>/<relative>` must not be renamed, or null.
 * It must be a regular file (never a link) whose real path is exactly
 * `<realRoot>/<relative>`: no link anywhere on the way.
 */
export const regularFileProblem = async (
  root: string,
  realRoot: string,
  relative: string
): Promise<string | null> => {
  const file = path.join(root, relative);
  const info = await nodeFs.lstat(file).catch(() => null);
  if (info === null) return "it is gone";
  if (!info.isFile()) return "it is not a regular file (a link?)";
  const real = await realpathOrNull(file);
  if (real !== path.join(realRoot, relative)) {
    return `it really is ${real ?? "unresolvable"}, through a link`;
  }
  return null;
};

/** Every file under `dir`, relative to `base`; links are reported, never followed. */
export const walk = async (
  base: string,
  dir: string,
  links: string[]
): Promise<{ relative: string; bytes: number; mtimeMs: number }[]> => {
  const out: { relative: string; bytes: number; mtimeMs: number }[] = [];
  const entries = await nodeFs.readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const relative = path.relative(base, full).split(path.sep).join("/");
    if (entry.isDirectory()) out.push(...(await walk(base, full, links)));
    else if (entry.isFile()) {
      const info = await nodeFs.lstat(full).catch(() => null);
      if (info) {
        out.push({
          relative,
          bytes: Number(info.size),
          mtimeMs: info.mtimeMs,
        });
      }
    } else links.push(relative);
  }
  return out;
};

/** Whether `relative` is one of `paths`, or a file kept beside one (`a.wav.json`). */
export const extendsAny = (paths: ReadonlySet<string>, relative: string) => {
  if (paths.has(relative)) return true;
  for (let i = relative.length - 1; i > 0; i--) {
    const ch = relative[i];
    if ((ch === "." || ch === "/") && paths.has(relative.slice(0, i))) {
      return true;
    }
  }
  return false;
};

/** rmdir each empty folder from `dir` up to (not including) `stop`. */
export const removeEmptyParents = async (dir: string, stop: string) => {
  let at = dir;
  while (isInside(stop, at)) {
    // rmdir only ever removes an EMPTY folder.
    const removed = await nodeFs.rmdir(at).then(
      () => true,
      () => false
    );
    if (!removed) return;
    at = path.dirname(at);
  }
};

export const tally = () => {
  const done = new Map<string, { files: number; bytes: number }>();
  return {
    add: (location: string, bytes: number) => {
      const was = done.get(location) ?? { files: 0, bytes: 0 };
      done.set(location, { files: was.files + 1, bytes: was.bytes + bytes });
    },
    list: () =>
      [...done].map(([location, d]) => ({ location, ...d })) as {
        location: string;
        files: number;
        bytes: number;
      }[],
  };
};

export const held = <A, E, R>(
  what: string,
  effect: Effect.Effect<A, E, R>,
  alreadyHeld?: boolean
): Effect.Effect<A, E | StorageUnusedDeleteRefusedError, R> =>
  alreadyHeld
    ? effect
    : holdingStorageWrites(
        what,
        (heldBy) => refused("storage-busy", storageBusyMessage(heldBy)),
        effect
      );

export function logResult(r: StorageUnusedDeleteResult) {
  return r.dryRun
    ? Effect.void
    : Effect.logInfo(
        `[storage] deleted unused footage: ${r.done.reduce((n, d) => n + d.files, 0)} files, ${r.kept.length} kept, ${r.left.length} left`
      );
}

/** The author's Cancel stopped deleting Unused Footage. */
export type UnusedDeleteCancelled = StorageDeleteCancelledError;

/** The delete loop's failure: the author's Cancel, or a failure to read. */
export const unusedDeleteFailure = (cause: unknown) =>
  cancelledOr(
    cause,
    () => new StorageUnusedDeleteFailedError({ message: messageOf(cause) })
  );
