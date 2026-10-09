import type { Database } from "./drizzle-service.server.js";
import { diagrams, diagramSnapshots } from "../db/schema.js";
import { NotFoundError, UnknownDBServiceError } from "./db-service-errors.js";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { hashHead, hashScene } from "../lib/scene-hash.js";
import {
  isHeadCaptured,
  isVisibleInTimeline,
} from "../lib/timeline-visibility.js";
import { withDbTransaction } from "./with-db-transaction.server.js";
import { lockDiagram } from "./lock-diagram.server.js";

type Diagram = typeof diagrams.$inferSelect;
type DiagramSnapshot = typeof diagramSnapshots.$inferSelect;
type DbError = UnknownDBServiceError;

/**
 * The Diagram operations `db-diagram-operations.server.ts` lends to the agent
 * writes below — the same ones the playground uses, so there is one code path.
 */
export interface DiagramPrimitives {
  createDiagram: (opts?: { name?: string }) => Effect.Effect<Diagram, DbError>;
  storeSnapshot: (
    diagramId: string,
    scene: unknown,
    opts: { preserved?: boolean }
  ) => Effect.Effect<DiagramSnapshot, DbError>;
  setSnapshotArchived: (
    snapshotId: string,
    archived: boolean
  ) => Effect.Effect<DiagramSnapshot, NotFoundError | DbError>;
  restoreSnapshotToHead: (
    diagramId: string,
    snapshotId: string
  ) => Effect.Effect<Diagram, NotFoundError | DbError>;
}

/** Whether a stored tldraw scene has any shape on it (not just a page). */
const hasShapes = (scene: unknown): boolean => {
  if (scene == null || typeof scene !== "object") return false;
  const store = (scene as { store?: unknown }).store;
  if (store == null || typeof store !== "object") return false;
  return Object.keys(store).some((key) => key.startsWith("shape:"));
};

/**
 * What `cvm diagram` and the Playground's restore write. DiagramSnapshots are immutable: an agent never
 * writes a Diagram's head, it ADDS Preserved Snapshots and moves the head to
 * one with `restoreSnapshotToHead` — a Restore to Head.
 *
 * Each write is ONE transaction: `primitivesFor(tx)` binds the primitives to
 * it, so a scene that fails to store leaves nothing behind — no half-made
 * Diagram for a re-run to duplicate.
 */
export const agentDiagramOperations = (
  db: Database,
  primitivesFor: (db: Database) => DiagramPrimitives
) => {
  const createDiagramFromSnapshots = (opts: {
    name?: string;
    scenes: readonly unknown[];
  }) =>
    withDbTransaction(db, (tx) =>
      writesIn(tx, primitivesFor(tx)).createDiagramFromSnapshots(opts)
    );

  const addSnapshotToHead = (diagramId: string, scene: unknown) =>
    withDbTransaction(db, (tx) =>
      writesIn(tx, primitivesFor(tx)).addSnapshotToHead(diagramId, scene)
    );

  const restoreToHead = (
    diagramId: string,
    snapshotId: string,
    opts: { expectedHeadHash: string | null | undefined }
  ) =>
    withDbTransaction(db, (tx) =>
      writesIn(tx, primitivesFor(tx)).restoreToHead(diagramId, snapshotId, opts)
    );

  return { createDiagramFromSnapshots, addSnapshotToHead, restoreToHead };
};

/** The agent writes, every statement on `db` — the transaction above. */
const writesIn = (
  db: Database,
  {
    createDiagram,
    storeSnapshot,
    setSnapshotArchived,
    restoreSnapshotToHead,
  }: DiagramPrimitives
) => {
  /**
   * A new Diagram whose timeline is `scenes`, in order: each is kept as a
   * Preserved Snapshot, then the FIRST is restored to the head. The head is
   * never written any other way, so what an agent drew is always held by a
   * snapshot. `cvm diagram create` is the caller; it refuses an empty list
   * and two identical drawings before it gets here.
   */
  const createDiagramFromSnapshots = Effect.fn("createDiagramFromSnapshots")(
    function* (opts: { name?: string; scenes: readonly unknown[] }) {
      const [firstScene, ...rest] = opts.scenes;
      if (firstScene === undefined) {
        return yield* new UnknownDBServiceError({
          cause: "createDiagramFromSnapshots needs at least one scene",
        });
      }

      const created = yield* createDiagram({ name: opts.name });
      const first = yield* storeSnapshot(created.id, firstScene, {
        preserved: true,
      });
      const snapshots = [first];
      for (const scene of rest) {
        snapshots.push(
          yield* storeSnapshot(created.id, scene, { preserved: true })
        );
      }

      const diagram = yield* restoreSnapshotToHead(created.id, first.id);
      return { diagram, snapshots };
    }
  );

  /**
   * Keep `scene` in the Diagram's timeline as a Preserved Snapshot. A drawing
   * the timeline once held and then archived comes back, so what was kept is
   * always somewhere the author can see it.
   */
  const keepInTimeline = Effect.fn("keepInTimeline")(function* (
    diagramId: string,
    scene: unknown
  ) {
    const snapshot = yield* storeSnapshot(diagramId, scene, {
      preserved: true,
    });
    return snapshot.archived
      ? yield* setSnapshotArchived(snapshot.id, false)
      : snapshot;
  });

  /** The snapshots the Diagram's timeline shows — what the Playground lists. */
  const timelineSnapshots = Effect.fn("timelineSnapshots")(function* (
    diagramId: string
  ) {
    const rows = yield* Effect.tryPromise({
      try: () =>
        db.query.diagramSnapshots.findMany({
          where: and(
            eq(diagramSnapshots.diagramId, diagramId),
            eq(diagramSnapshots.archived, false)
          ),
          columns: { contentHash: true, preserved: true },
          with: { clips: { columns: { archived: true } } },
        }),
      catch: (e) => new UnknownDBServiceError({ cause: e }),
    });
    return rows.filter((s) => isVisibleInTimeline(s, s.clips));
  });

  /**
   * Add `scene` to a Diagram as a Preserved Snapshot and make it the head, by
   * the Restore to Head rules: when no snapshot in the timeline holds the
   * current head (Matt drew on it by hand since), that drawing is preserved
   * FIRST, so nothing is lost. "Held" is the Playground's own rule
   * (`isHeadCaptured`): a snapshot the timeline hides holds nothing. A head
   * with no shapes on it holds nothing worth keeping. `cvm diagram snapshot
   * add` is the caller.
   */
  const addSnapshotToHead = Effect.fn("addSnapshotToHead")(function* (
    diagramId: string,
    scene: unknown
  ) {
    const current = yield* lockDiagram(db, diagramId, "addSnapshotToHead");

    let preservedHead: DiagramSnapshot | null = null;
    if (
      hasShapes(current.headScene) &&
      !isHeadCaptured(
        yield* timelineSnapshots(diagramId),
        hashScene(current.headScene)
      )
    ) {
      preservedHead = yield* keepInTimeline(diagramId, current.headScene);
    }

    const snapshot = yield* keepInTimeline(diagramId, scene);
    const diagram = yield* restoreSnapshotToHead(diagramId, snapshot.id);
    return { diagram, snapshot, preservedHead };
  });

  /**
   * The Playground's Restore to Head. `expectedHeadHash` is the head the tab
   * last saw (`hashHead`; `null` for an empty one): the tab has already kept
   * that one if the timeline lacked it. A head it never saw — moved by
   * another tab or the CLI since — is preserved here first, under the row
   * lock, unless the timeline already holds it. So a restore never destroys a
   * head the client hasn't seen.
   */
  const restoreToHead = Effect.fn("restoreToHead")(function* (
    diagramId: string,
    snapshotId: string,
    opts: { expectedHeadHash: string | null | undefined }
  ) {
    const current = yield* lockDiagram(db, diagramId, "restoreToHead");
    const currentHash = hashHead(current.headScene);
    if (
      currentHash !== opts.expectedHeadHash &&
      hasShapes(current.headScene) &&
      !isHeadCaptured(yield* timelineSnapshots(diagramId), currentHash)
    ) {
      yield* keepInTimeline(diagramId, current.headScene);
    }
    return yield* restoreSnapshotToHead(diagramId, snapshotId);
  });

  return { createDiagramFromSnapshots, addSnapshotToHead, restoreToHead };
};
