import path from "node:path";
import { Effect } from "effect";
import {
  avCalibrations,
  clips,
  recordingSessions,
  thumbnails,
  videos,
} from "@/db/schema";
import {
  rootRelativePath,
  STORAGE_FOLDERS,
  writeFolder,
  type StorageRoots,
} from "@/packages/storage";
import type { Database } from "@/services/drizzle-service.server";
import { planExportRenames } from "./storage-relocation-exports.server";
import {
  dbRead,
  existsOn,
  fingerprint,
  isInside,
  layerPaths,
  posix,
  rewriteLayerPaths,
  underNoRoot,
  walkFiles,
  type PlannedFileCopy,
  type PlannedRowRewrite,
  type RelocationPlan,
  type RowUpdates,
} from "./storage-relocation-plan";

export { applyRelocation } from "./storage-relocation-apply.server";
export {
  RelocationAbortedError,
  type RelocationPlan,
} from "./storage-relocation-plan";

/**
 * The one-off relocation of the files CVM wrote before they had a Storage
 * Root (#2105, run by Matt in #2106), so a Storage Bucket can account for and
 * move all of it:
 *
 * - **Recording Sessions** (and AV Calibration runs) in a folder under no
 *   root (`~/Videos/<session>/`) move, folder and all, to `raw-footage/` on
 *   the first root (`raw-footage/av-calibrations/` for a run). Their rows,
 *   and the Clips cut from them, are rewritten root-relative.
 * - **Video Files** in the legacy in-checkout stores move to `video-files/`
 *   on the first root. Nothing names them but the listing.
 * - **Thumbnail** rows (the composite and every layer) are rewritten to
 *   `video-files/{lineageId}/…`. A path into an old `.worktrees` checkout is
 *   repaired: it points at the file where it actually is (the legacy store,
 *   or the worktree, copied in), or is reported if it is gone.
 * - Moving a Recording Session changes its Clips' Export Hash (the hash names
 *   Footage by its root-relative path, ADR 0040), so each affected Video's
 *   Exported Video is renamed to its new address rather than re-encoded.
 *
 * {@link planRelocation} reads and writes nothing. {@link applyRelocation}
 * copies every file and checks each copy (size and SHA-256) BEFORE any row or
 * export changes; any failure removes what it copied and changes nothing.
 * Only once the rows are committed are the originals removed.
 */

/**
 * Plan the relocation from the database and what is on disk. Reads only.
 *
 * `legacyVideoFilesStores` are the in-checkout Video Files stores, in order
 * (`legacyVideoFilesStores()`); a file in an earlier one wins.
 */
export const planRelocation = (
  db: Database,
  o: {
    readonly roots: StorageRoots;
    readonly legacyVideoFilesStores: readonly string[];
  }
) =>
  Effect.gen(function* () {
    const { roots } = o;
    const rawFootage = writeFolder(roots, STORAGE_FOLDERS.rawFootage);
    const videoFiles = writeFolder(roots, STORAGE_FOLDERS.videoFiles);

    const copies = new Map<string, PlannedFileCopy>();
    const rows: PlannedRowRewrite[] = [];
    const originals = new Set<string>();
    const missing: string[] = [];
    const shadowed: string[] = [];
    const problems: string[] = [];

    /** Two different files planned onto one path refuse the relocation. */
    const planCopy = (copy: PlannedFileCopy) => {
      const taken = copies.get(copy.to);
      if (taken && taken.from !== copy.from) {
        problems.push(
          `${taken.from} and ${copy.from} would both go to ${copy.to}.`
        );
        return;
      }
      copies.set(copy.to, copy);
    };

    /**
     * Copy every file of `fromDir` to `toDir` on the first root. A file
     * already there with the same bytes needs no copy; a different one is a
     * problem (the folder name is taken).
     */
    const planFolder = (fromDir: string, toDir: string, store: string) =>
      Effect.gen(function* () {
        for (const file of yield* walkFiles(fromDir)) {
          const from = path.join(fromDir, file);
          const to = path.join(toDir, file);
          if (yield* existsOn(to)) {
            const same =
              (yield* fingerprint(from)) === (yield* fingerprint(to));
            if (!same)
              problems.push(`${to} already exists and is not ${from}.`);
            continue;
          }
          planCopy({ from, to, store });
        }
      });

    // --- Recording Sessions, and the Clips cut from them ---------------------
    const sessionUpdates: Array<RowUpdates["sessions"][number]> = [];
    /** Each moved session folder and the root-relative folder it becomes. */
    const movedFolders = new Map<string, string>();
    const sessionRows = yield* dbRead(() =>
      db.select().from(recordingSessions)
    );
    for (const session of sessionRows) {
      const files = [
        session.cameraFilePath,
        session.screenFilePath,
        session.micFilePath,
      ];
      if (!files.some((f) => underNoRoot(f, roots))) continue;
      const folder = posix.dirname(session.micFilePath);
      if (files.some((f) => posix.dirname(f) !== folder)) {
        problems.push(
          `Recording Session ${session.id} has its files in more than one folder: ${files.join(", ")}`
        );
        continue;
      }
      if (!(yield* existsOn(folder))) {
        missing.push(`Recording Session ${session.id}: ${folder}`);
        continue;
      }
      const relativeFolder = posix.join(
        STORAGE_FOLDERS.rawFootage,
        posix.basename(folder)
      );
      if (!movedFolders.has(folder)) {
        yield* planFolder(
          folder,
          path.join(roots[0], relativeFolder),
          rawFootage
        );
        movedFolders.set(folder, relativeFolder);
        originals.add(folder);
      }
      const moved = (f: string) =>
        posix.join(relativeFolder, posix.basename(f));
      sessionUpdates.push({
        id: session.id,
        cameraFilePath: moved(session.cameraFilePath),
        screenFilePath: moved(session.screenFilePath),
        micFilePath: moved(session.micFilePath),
      });
      for (const f of files)
        rows.push({
          row: `recording_session ${session.id}`,
          from: f,
          to: moved(f),
        });
    }

    /** A path inside a moved session folder, as it becomes. */
    const inMovedFolder = (stored: string): string | null => {
      for (const [folder, relative] of movedFolders) {
        if (isInside(folder, stored))
          return posix.join(relative, stored.slice(folder.length + 1));
      }
      return null;
    };

    const clipUpdates: Array<RowUpdates["clips"][number]> = [];
    const clipRows = yield* dbRead(() =>
      db
        .select({ id: clips.id, videoFilename: clips.videoFilename })
        .from(clips)
    );
    for (const clip of clipRows) {
      const to = inMovedFolder(clip.videoFilename);
      if (to === null) continue;
      clipUpdates.push({ id: clip.id, videoFilename: to });
      rows.push({ row: `clip ${clip.id}`, from: clip.videoFilename, to });
    }

    const videoUpdates: Array<RowUpdates["videos"][number]> = [];
    const videoRows = yield* dbRead(() =>
      db
        .select({
          id: videos.id,
          originalFootagePath: videos.originalFootagePath,
        })
        .from(videos)
    );
    for (const video of videoRows) {
      const to = inMovedFolder(video.originalFootagePath);
      if (to === null) continue;
      videoUpdates.push({ id: video.id, originalFootagePath: to });
      rows.push({
        row: `video ${video.id}`,
        from: video.originalFootagePath,
        to,
      });
    }

    // --- AV Calibration runs --------------------------------------------------
    const calibrationUpdates: Array<RowUpdates["calibrations"][number]> = [];
    const calibrationRows = yield* dbRead(() =>
      db.select().from(avCalibrations)
    );
    for (const run of calibrationRows) {
      const files = [
        run.micFilePath,
        run.scriptFilePath,
        ...(run.cameraFilePath === null ? [] : [run.cameraFilePath]),
      ];
      if (!files.some((f) => underNoRoot(f, roots))) continue;
      const folder = posix.dirname(run.micFilePath);
      if (files.some((f) => posix.dirname(f) !== folder)) {
        problems.push(
          `AV Calibration ${run.id} has its files in more than one folder: ${files.join(", ")}`
        );
        continue;
      }
      if (!(yield* existsOn(folder))) {
        missing.push(`AV Calibration ${run.id}: ${folder}`);
        continue;
      }
      const relativeFolder = posix.join(
        STORAGE_FOLDERS.rawFootage,
        "av-calibrations",
        posix.basename(folder)
      );
      yield* planFolder(
        folder,
        path.join(roots[0], relativeFolder),
        rawFootage
      );
      originals.add(folder);
      const moved = (f: string) =>
        posix.join(relativeFolder, posix.basename(f));
      calibrationUpdates.push({
        id: run.id,
        micFilePath: moved(run.micFilePath),
        scriptFilePath: moved(run.scriptFilePath),
        cameraFilePath:
          run.cameraFilePath === null ? null : moved(run.cameraFilePath),
      });
      for (const f of files)
        rows.push({ row: `av_calibration ${run.id}`, from: f, to: moved(f) });
    }

    // --- Video Files ------------------------------------------------------------
    /** `{lineageId}/{file}` → the legacy file that becomes it. */
    const legacyFiles = new Map<string, string>();
    for (const store of o.legacyVideoFilesStores) {
      for (const file of yield* walkFiles(store)) {
        const from = path.join(store, file);
        if (legacyFiles.has(file)) {
          shadowed.push(`${from} (${legacyFiles.get(file)} is moved instead)`);
          continue;
        }
        legacyFiles.set(file, from);
        const onRoots = roots.map((root) =>
          path.join(root, STORAGE_FOLDERS.videoFiles, file)
        );
        let already: string | null = null;
        for (const candidate of onRoots) {
          if (yield* existsOn(candidate)) {
            already = candidate;
            break;
          }
        }
        if (already !== null) {
          // Written since the switch (first root wins): the root's copy is
          // the newer one. An identical legacy copy just goes.
          if ((yield* fingerprint(from)) === (yield* fingerprint(already)))
            originals.add(from);
          else shadowed.push(`${from} (${already} is newer and is kept)`);
          continue;
        }
        planCopy({ from, to: path.join(videoFiles, file), store: videoFiles });
        originals.add(from);
      }
    }

    // --- Thumbnails -------------------------------------------------------------
    const thumbnailUpdates: Array<RowUpdates["thumbnails"][number]> = [];
    const thumbnailRows = yield* dbRead(() => db.select().from(thumbnails));
    for (const thumbnail of thumbnailRows) {
      let changed = false;
      const rewrite = (stored: string) =>
        Effect.gen(function* () {
          if (!posix.isAbsolute(stored)) return stored;
          const underRoot = rootRelativePath(stored, roots);
          if (underRoot !== null) {
            changed = true;
            return underRoot;
          }
          // `…/video-files/{lineageId}/{file}`: a legacy store, or an old
          // `.worktrees` checkout's.
          const at = stored.lastIndexOf(`/${STORAGE_FOLDERS.videoFiles}/`);
          if (at === -1) {
            missing.push(
              `thumbnail ${thumbnail.id}: ${stored} (not a Video File)`
            );
            return stored;
          }
          const file = stored.slice(at + STORAGE_FOLDERS.videoFiles.length + 2);
          const to = posix.join(STORAGE_FOLDERS.videoFiles, file);
          let found = legacyFiles.has(file);
          for (const root of roots) {
            if (found) break;
            found = yield* existsOn(path.join(root, to));
          }
          if (!found && (yield* existsOn(stored))) {
            // Only in the worktree it was written from: copied in.
            const target = path.join(videoFiles, file);
            planCopy({ from: stored, to: target, store: videoFiles });
            found = true;
          }
          if (!found) {
            missing.push(`thumbnail ${thumbnail.id}: ${stored}`);
            return stored;
          }
          changed = true;
          rows.push({ row: `thumbnail ${thumbnail.id}`, from: stored, to });
          return to;
        });
      const filePath =
        thumbnail.filePath === null ? null : yield* rewrite(thumbnail.filePath);
      const rewritten = new Map<string, string>();
      for (const p of layerPaths(thumbnail.layers)) {
        if (!rewritten.has(p)) rewritten.set(p, yield* rewrite(p));
      }
      if (changed) {
        thumbnailUpdates.push({
          id: thumbnail.id,
          filePath,
          layers: rewriteLayerPaths(
            thumbnail.layers,
            (p) => rewritten.get(p) ?? p
          ),
        });
      }
    }

    // --- Exported Videos whose Export Hash the moved sessions change ----------
    const exported = yield* planExportRenames(db, {
      roots,
      sessions: sessionUpdates,
      clips: clipUpdates,
    });
    problems.push(...exported.problems);
    const exportRenames = exported.renames;

    return {
      copies: [...copies.values()],
      rows,
      exportRenames,
      originals: [...originals],
      missing,
      shadowed,
      problems,
      updates: {
        sessions: sessionUpdates,
        clips: clipUpdates,
        videos: videoUpdates,
        calibrations: calibrationUpdates,
        thumbnails: thumbnailUpdates,
      },
    } satisfies RelocationPlan;
  });
