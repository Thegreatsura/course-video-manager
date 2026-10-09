import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { DiagramOperationsService } from "./db-diagram-operations.server.js";
import { VideoOperationsService } from "./db-video-operations.server.js";
import { ClipOperationsService } from "./db-clip-operations.server.js";
import { CourseOperationsService } from "./db-course-operations.server.js";
import { DrizzleService } from "./drizzle-service.server.js";
import { DiagramThumbnailStore } from "./diagram-thumbnail-store.js";
import { diagrams, diagramSnapshots } from "../db/schema.js";
import {
  createTestDb,
  truncateAllTables,
  withQueryLog,
  type TestDb,
} from "../test-utils/pglite.js";
import { isVisibleInTimeline } from "../lib/timeline-visibility.js";
import type { PGlite } from "@electric-sql/pglite";

let testDb: TestDb;
let pglite: PGlite;
let testLayer: Layer.Layer<
  | DiagramOperationsService
  | VideoOperationsService
  | ClipOperationsService
  | CourseOperationsService
>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  pglite = result.pglite;

  const drizzleLayer = Layer.succeed(DrizzleService, testDb as any);
  testLayer = Layer.mergeAll(
    DiagramOperationsService.Default,
    VideoOperationsService.Default,
    ClipOperationsService.Default,
    CourseOperationsService.Default
  ).pipe(
    Layer.provide(drizzleLayer),
    Layer.provide(DiagramThumbnailStore.noop)
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const scene1 = {
  store: { "shape:a": { id: "a", x: 1 } },
  schema: { schemaVersion: 2 },
};
const scene2 = {
  store: { "shape:b": { id: "b", x: 2 } },
  schema: { schemaVersion: 2 },
};
/** A drawing Postgres refuses to store: jsonb has no "\u0000". */
const unstorable = {
  store: { "shape:nul": { id: "nul", props: { text: "a\u0000b" } } },
  schema: { schemaVersion: 2 },
};

describe("createDiagramFromSnapshots", () => {
  it.effect(
    "keeps every scene as a Preserved Snapshot in order and restores the FIRST to the head",
    () =>
      Effect.gen(function* () {
        const diagramOps = yield* DiagramOperationsService;
        const { diagram, snapshots } =
          yield* diagramOps.createDiagramFromSnapshots({
            name: "Build-up",
            scenes: [scene1, scene2],
          });

        expect(diagram.name).toBe("Build-up");
        expect(diagram.headScene).toEqual(scene1);
        expect(snapshots.map((s) => [s.scene, s.preserved])).toEqual([
          [scene1, true],
          [scene2, true],
        ]);
        const listed = yield* diagramOps.listSnapshots(diagram.id);
        expect(listed.map((s) => s.id)).toEqual(snapshots.map((s) => s.id));
      }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "leaves no Diagram and no snapshot behind when a later scene fails to store",
    () =>
      Effect.gen(function* () {
        const diagramOps = yield* DiagramOperationsService;
        yield* Effect.flip(
          diagramOps.createDiagramFromSnapshots({
            name: "Build-up",
            scenes: [scene1, unstorable],
          })
        );

        const left = yield* Effect.promise(() =>
          Promise.all([
            testDb.select().from(diagrams),
            testDb.select().from(diagramSnapshots),
          ])
        );
        expect(left).toEqual([[], []]);
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("names an unnamed Diagram 'Untitled N'", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const { diagram } = yield* diagramOps.createDiagramFromSnapshots({
        scenes: [scene1],
      });
      expect(diagram.name).toBe("Untitled 1");
    }).pipe(Effect.provide(testLayer))
  );
});

describe("addSnapshotToHead", () => {
  /** Matt's hand edit in the playground: a head no snapshot holds. */
  const handEdit = {
    store: { "shape:a": { id: "a", x: 1 }, "shape:hand": { id: "hand" } },
    schema: { schemaVersion: 2 },
  };

  it.effect(
    "preserves an unheld head FIRST, then keeps the new scene and restores it to the head",
    () =>
      Effect.gen(function* () {
        const diagramOps = yield* DiagramOperationsService;
        const { diagram: created, snapshots: drawn } =
          yield* diagramOps.createDiagramFromSnapshots({ scenes: [scene1] });
        yield* diagramOps.updateDiagramHead(created.id, handEdit);

        const { diagram, snapshot, preservedHead } =
          yield* diagramOps.addSnapshotToHead(created.id, scene2);

        expect(diagram.headScene).toEqual(scene2);
        expect(snapshot.scene).toEqual(scene2);
        expect(preservedHead?.scene).toEqual(handEdit);
        const listed = yield* diagramOps.listSnapshots(created.id);
        expect(listed.map((s) => [s.id, s.scene, s.preserved])).toEqual([
          [drawn[0]!.id, scene1, true],
          [preservedHead!.id, handEdit, true],
          [snapshot.id, scene2, true],
        ]);
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("swaps without a new snapshot when the head is already held", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const { diagram: created } = yield* diagramOps.createDiagramFromSnapshots(
        { scenes: [scene1] }
      );

      const { preservedHead, diagram } = yield* diagramOps.addSnapshotToHead(
        created.id,
        scene2
      );

      expect(preservedHead).toBeNull();
      expect(diagram.headScene).toEqual(scene2);
      const listed = yield* diagramOps.listSnapshots(created.id);
      expect(listed.map((s) => s.scene)).toEqual([scene1, scene2]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "preserves a head whose only snapshot was archived, and brings it back",
    () =>
      Effect.gen(function* () {
        const diagramOps = yield* DiagramOperationsService;
        const { diagram: created, snapshots: drawn } =
          yield* diagramOps.createDiagramFromSnapshots({ scenes: [scene1] });
        yield* diagramOps.setSnapshotArchived(drawn[0]!.id, true);

        const { preservedHead } = yield* diagramOps.addSnapshotToHead(
          created.id,
          scene2
        );

        expect(preservedHead?.id).toBe(drawn[0]!.id);
        expect(preservedHead?.archived).toBe(false);
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("keeps nothing for an empty head", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const created = yield* diagramOps.createDiagram();
      yield* diagramOps.updateDiagramHead(created.id, {
        store: { "page:page": { id: "page:page" } },
        schema: { schemaVersion: 2 },
      });

      const { preservedHead } = yield* diagramOps.addSnapshotToHead(
        created.id,
        scene1
      );

      expect(preservedHead).toBeNull();
      const listed = yield* diagramOps.listSnapshots(created.id);
      expect(listed.map((s) => s.scene)).toEqual([scene1]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "keeps neither snapshot when the new scene fails to store after the head was preserved",
    () =>
      Effect.gen(function* () {
        const diagramOps = yield* DiagramOperationsService;
        const { diagram: created } =
          yield* diagramOps.createDiagramFromSnapshots({ scenes: [scene1] });
        yield* diagramOps.updateDiagramHead(created.id, handEdit);

        yield* Effect.flip(
          diagramOps.addSnapshotToHead(created.id, unstorable)
        );

        const listed = yield* diagramOps.listSnapshots(created.id);
        expect(listed.map((s) => s.scene)).toEqual([scene1]);
        const diagram = yield* diagramOps.getDiagram(created.id);
        expect(diagram.headScene).toEqual(handEdit);
      }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "preserves a head whose only snapshot the timeline hides (pinned by an archived Clip)",
    () =>
      Effect.gen(function* () {
        const diagramOps = yield* DiagramOperationsService;
        const videoOps = yield* VideoOperationsService;
        const clipOps = yield* ClipOperationsService;
        const { diagram: created } =
          yield* diagramOps.createDiagramFromSnapshots({ scenes: [scene1] });
        // Matt draws by hand, films a Clip against it (an unpreserved pin)...
        yield* diagramOps.updateDiagramHead(created.id, handEdit);
        const video = yield* videoOps.createStandaloneVideo({
          title: "v.mp4",
          format: "landscape",
        });
        const [clip] = yield* clipOps.appendClips({
          videoId: video.id,
          insertionPoint: { type: "start" },
          clips: [{ inputVideo: "t.mp4", startTime: 0, endTime: 1 }],
        });
        yield* diagramOps.createSnapshotForClip(created.id, clip!.id);
        // ...then deletes that take, so the timeline no longer shows it.
        yield* clipOps.archiveClip(clip!.id);

        yield* diagramOps.addSnapshotToHead(created.id, scene2);

        const timeline = (yield* diagramOps.listSnapshotsWithClips(
          created.id
        )).filter((s) => isVisibleInTimeline(s, s.clips));
        expect(timeline.map((s) => s.scene)).toContainEqual(handEdit);
      }).pipe(Effect.provide(testLayer))
  );

  // PGlite has one connection, so two transactions cannot interleave here:
  // this asserts the SQL the guarantee rests on. The autosave PATCH
  // (updateDiagramHead) locks the same row, so with this lock taken FIRST an
  // autosave either lands before the head is read (and is preserved) or waits
  // and is refused for a moved head — it can never be silently overwritten.
  it("locks the Diagram row FOR UPDATE before it reads the head", async () => {
    const created = await Effect.runPromise(
      DiagramOperationsService.pipe(
        Effect.flatMap((ops) =>
          ops.createDiagramFromSnapshots({ scenes: [scene1] })
        ),
        Effect.provide(testLayer)
      )
    );

    const queries: string[] = [];
    const loggedDb = withQueryLog(pglite, (q) => queries.push(q.toLowerCase()));
    const loggedLayer = DiagramOperationsService.Default.pipe(
      Layer.provide(Layer.succeed(DrizzleService, loggedDb as any)),
      Layer.provide(DiagramThumbnailStore.noop)
    );
    await Effect.runPromise(
      DiagramOperationsService.pipe(
        Effect.flatMap((ops) =>
          ops.addSnapshotToHead(created.diagram.id, scene2)
        ),
        Effect.provide(loggedLayer)
      )
    );

    const diagramQueries = queries.filter((q) =>
      q.includes(`"course-video-manager_diagram"`)
    );
    expect(diagramQueries[0]).toMatch(/^select .* for update$/);
  });

  it.effect(
    "fails NotFoundError for a missing Diagram and writes nothing",
    () =>
      Effect.gen(function* () {
        const diagramOps = yield* DiagramOperationsService;
        const error = yield* Effect.flip(
          diagramOps.addSnapshotToHead(
            "00000000-0000-0000-0000-000000000000",
            scene1
          )
        );
        expect(error._tag).toBe("NotFoundError");
      }).pipe(Effect.provide(testLayer))
  );
});
