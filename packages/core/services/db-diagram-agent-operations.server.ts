import type { Database } from "./drizzle-service.server.js";
import { diagrams, diagramSnapshots } from "../db/schema.js";
import { NotFoundError, UnknownDBServiceError } from "./db-service-errors.js";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { hashScene } from "../lib/scene-hash.js";
import {
  isHeadCaptured,
  isVisibleInTimeline,
} from "../lib/timeline-visibility.js";
import { withDbTransaction } from "./with-db-transaction.server.js";

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
 * What `cvm diagram` writes. DiagramSnapshots are immutable: an agent never
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

  return { createDiagramFromSnapshots, addSnapshotToHead };
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

  /**
   * The Diagram, its row locked until the transaction ends. The autosave PATCH
   * (`updateDiagramHead`) locks the same row, so a head read here cannot be
   * overwritten by one in between: an autosave either commits first — and is
   * the head this sees — or waits and is refused for a moved head.
   */
  const lockDiagram = Effect.fn("lockDiagram")(function* (diagramId: string) {
    const [diagram] = yield* Effect.tryPromise({
      try: () =>
        db
          .select()
          .from(diagrams)
          .where(eq(diagrams.id, diagramId))
          .for("update"),
      catch: (e) => new UnknownDBServiceError({ cause: e }),
    });
    if (!diagram) {
      return yield* new NotFoundError({
        type: "addSnapshotToHead",
        params: { diagramId },
      });
    }
    return diagram;
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
    const current = yield* lockDiagram(diagramId);

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

  return { createDiagramFromSnapshots, addSnapshotToHead };
};
