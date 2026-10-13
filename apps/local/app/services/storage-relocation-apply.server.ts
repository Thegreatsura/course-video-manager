import path from "node:path";
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { eq } from "drizzle-orm";
import {
  avCalibrations,
  clips,
  recordingSessions,
  thumbnails,
  videos,
} from "@/db/schema";
import type { Database } from "@/services/drizzle-service.server";
import type { StorageRoots } from "@/packages/storage";
import { assertUnderEffect } from "./assert-under";
import { assertUnderFinishedVideos } from "./finished-videos.server";
import {
  fingerprint,
  RelocationAbortedError,
  type PlannedExportRename,
  type RelocationPlan,
} from "./storage-relocation-plan";

const failMessage = (e: unknown) =>
  e instanceof Error
    ? e.message
    : typeof e === "object" && e !== null && "message" in e
      ? String((e as { message: unknown }).message)
      : String(e);

/**
 * Perform a plan. Refused whole if it has any problem. Otherwise, in order:
 * copy every file (temp name, then rename) and check its size and SHA-256
 * against the original; rename the Exported Videos; rewrite every row in one
 * transaction. A failure at any of those removes the copies, puts the
 * exports back, and changes no row. Only then are the originals removed;
 * one that cannot be (Windows has it open) is left and counted.
 */
export const applyRelocation = (
  db: Database,
  plan: RelocationPlan,
  roots: StorageRoots
) =>
  Effect.gen(function* () {
    if (plan.problems.length > 0) {
      return yield* new RelocationAbortedError({
        message: `Refusing to relocate: ${plan.problems.length} problem(s), nothing was changed.`,
      });
    }
    const fs = yield* FileSystem.FileSystem;
    const copied: Array<{ to: string; store: string }> = [];
    const renamed: PlannedExportRename[] = [];

    const undo = Effect.gen(function* () {
      for (const rename of [...renamed].reverse()) {
        yield* Effect.gen(function* () {
          const back = yield* assertUnderFinishedVideos(roots, rename.from);
          const current = yield* assertUnderFinishedVideos(roots, rename.to);
          yield* fs.rename(current, back);
        }).pipe(Effect.ignoreLogged);
      }
      for (const copy of copied) {
        yield* Effect.gen(function* () {
          const target = yield* assertUnderEffect(copy.store, copy.to);
          yield* fs.remove(target);
        }).pipe(Effect.ignoreLogged);
      }
    });
    const abort = (what: string) => (e: unknown) =>
      Effect.zipRight(
        undo,
        Effect.fail(
          new RelocationAbortedError({
            message: `${what}: ${failMessage(e)}. Everything copied was removed and no row changed.`,
          })
        )
      );

    yield* Effect.gen(function* () {
      for (const copy of plan.copies) {
        const to = yield* assertUnderEffect(copy.store, copy.to);
        const partial = yield* assertUnderEffect(
          copy.store,
          `${copy.to}.relocating`
        );
        yield* fs.makeDirectory(path.dirname(to), { recursive: true });
        copied.push({ to: partial, store: copy.store });
        yield* fs.copyFile(copy.from, partial);
        if ((yield* fingerprint(copy.from)) !== (yield* fingerprint(partial)))
          return yield* new RelocationAbortedError({
            message: `the copy of ${copy.from} does not match it`,
          });
        yield* fs.rename(partial, to);
        copied[copied.length - 1] = { to, store: copy.store };
      }
    }).pipe(Effect.catchAll(abort("Copying failed")));

    yield* Effect.gen(function* () {
      for (const rename of plan.exportRenames) {
        if (yield* fs.exists(rename.to))
          return yield* new RelocationAbortedError({
            message: `${rename.to} appeared while relocating`,
          });
        const from = yield* assertUnderFinishedVideos(roots, rename.from);
        const to = yield* assertUnderFinishedVideos(roots, rename.to);
        yield* fs.rename(from, to);
        renamed.push(rename);
      }
    }).pipe(Effect.catchAll(abort("Renaming an Exported Video failed")));

    const { updates } = plan;
    yield* Effect.tryPromise({
      try: () =>
        db.transaction(async (tx) => {
          for (const s of updates.sessions) {
            const { id, ...set } = s;
            await tx
              .update(recordingSessions)
              .set(set)
              .where(eq(recordingSessions.id, id));
          }
          for (const c of updates.clips) {
            await tx
              .update(clips)
              .set({ videoFilename: c.videoFilename })
              .where(eq(clips.id, c.id));
          }
          for (const v of updates.videos) {
            await tx
              .update(videos)
              .set({ originalFootagePath: v.originalFootagePath })
              .where(eq(videos.id, v.id));
          }
          for (const a of updates.calibrations) {
            const { id, ...set } = a;
            await tx
              .update(avCalibrations)
              .set(set)
              .where(eq(avCalibrations.id, id));
          }
          for (const t of updates.thumbnails) {
            await tx
              .update(thumbnails)
              .set({ filePath: t.filePath, layers: t.layers })
              .where(eq(thumbnails.id, t.id));
          }
        }),
      catch: (e) => new RelocationAbortedError({ message: failMessage(e) }),
    }).pipe(Effect.catchAll(abort("Rewriting the rows failed")));

    let originalsLeft = 0;
    for (const original of plan.originals) {
      const removed = yield* Effect.gen(function* () {
        const target = yield* assertUnderEffect(
          path.dirname(original),
          original
        );
        yield* fs.remove(target, { recursive: true });
      }).pipe(Effect.either);
      if (removed._tag === "Left") originalsLeft++;
    }

    return {
      copied: plan.copies.length,
      rows: plan.rows.length,
      exportsRenamed: plan.exportRenames.length,
      originalsRemoved: plan.originals.length - originalsLeft,
      originalsLeft,
    };
  });
