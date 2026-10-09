import { describe, it, expect } from "vitest";
import nodeFs from "node:fs";
import nodePath from "node:path";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import {
  readSimpleDiagram,
  type Scene,
} from "@cvm/core/lib/simple-diagram/index";
import { hashScene } from "@/lib/scene-hash";
import { LOCAL_MACHINE_ENV_KEY } from "./env";
import {
  DIAGRAM_RENDERS,
  failureOf,
  ndjson,
  useDiagramCli,
} from "./cli-write-test-harness";

// ===========================================================================
// cvm diagram snapshot add / render: a Diagram changes by ADDING a snapshot,
// restored to the head (an unheld head is preserved first); render draws a
// stored snapshot, never the head.
//
// The browser is faked with Layer.succeed, as in the clip-mockup suites: the
// command finds the fake through Effect.serviceOption, so no Chromium launches
// and no daemon starts. The fake writes canned bytes where it is told to and
// records the scene and app origin it was handed.
// ===========================================================================

const { render, db, dir, run, file } = useDiagramCli();

const DRAFT = {
  name: "Agent loop",
  shapes: [
    { type: "box", id: "agent", x: 0, y: 0, w: 200, h: 100 },
    { type: "text", id: "label", x: 60, y: 34, text: "Agent" },
    { type: "ellipse", id: "tools", x: 400, y: 0, w: 200, h: 100 },
    { type: "arrow", id: "call", from: "agent", to: "tools", text: "call" },
    { type: "line", id: "rule", x1: 0, y1: 200, x2: 600, y2: 200 },
    { type: "icon", id: "bot", x: 76, y: -70, name: "bot" },
  ],
};

type Created = {
  id: string;
  url: string;
  snapshots: Array<{ id: string; image: string }>;
};

/** The Diagram's snapshots, oldest first. */
const snapshotsOf = (diagramId: string) =>
  db().query.diagramSnapshots.findMany({
    where: (s, { eq }) => eq(s.diagramId, diagramId),
    orderBy: (s, { asc }) => [asc(s.createdAt)],
  });

/** Agent loop, one step further: the box Matt reveals next. */
const STEP_2 = {
  shapes: [
    ...DRAFT.shapes,
    { type: "box", id: "memory", x: 800, y: 0, w: 200, h: 100 },
  ],
};

type Added = { snapshotId: string; image: string };

/** A Diagram the CLI drew, as Matt would receive it. */
const created = async () => {
  const r = await run(["diagram", "create", "--file", file(DRAFT)]);
  expect(r.exitCode).toBe(0);
  const [line] = ndjson(r.stdout) as Created[];
  return line!;
};

/** Matt's hand edit in the playground: the head autosaved, held by no snapshot. */
const editByHand = async (diagramId: string) => {
  const row = await db().query.diagrams.findFirst({
    where: (d, { eq }) => eq(d.id, diagramId),
  });
  const scene = row!.headScene as Scene;
  const handDrawn = {
    ...scene,
    store: {
      ...scene.store,
      "shape:matt-scribble": {
        ...(scene.store["shape:label"] as object),
        id: "shape:matt-scribble",
        y: 400,
      },
    },
  };
  await db()
    .update(schema.diagrams)
    .set({ headScene: handDrawn })
    .where(eqId(diagramId));
  return handDrawn;
};

const eqId = (id: string) => eq(schema.diagrams.id, id);

/**
 * Matt polishes the drawing in the playground: what the simple format cannot
 * say, on shapes it can, plus a hand-drawn scribble it reads as `other`.
 */
const polishByHand = async (diagramId: string) => {
  const row = await db().query.diagrams.findFirst({
    where: (d, { eq }) => eq(d.id, diagramId),
  });
  const scene = structuredClone(row!.headScene as Scene);
  type Rec = { props: Record<string, unknown>; [k: string]: unknown };
  const at = (id: string) => scene.store[id] as unknown as Rec;
  Object.assign(at("shape:bot").props, { w: 96, h: 96 });
  Object.assign(at("shape:label").props, {
    font: "sans",
    autoSize: false,
    w: 300,
  });
  at("shape:agent").props.size = "xl";
  at("shape:tools").opacity = 0.5;
  Object.assign(at("binding:call-end").props, {
    normalizedAnchor: { x: 0.1, y: 0.9 },
    isPrecise: true,
  });
  scene.store["shape:scribble"] = {
    ...scene.store["shape:rule"]!,
    id: "shape:scribble",
    type: "draw",
    index: "a9",
    props: { segments: [], color: "black", size: "m", isComplete: true },
  } as Scene["store"][string];
  await db()
    .update(schema.diagrams)
    .set({ headScene: scene })
    .where(eqId(diagramId));
  return scene;
};

describe("cvm diagram snapshot add", () => {
  it("preserves Matt's unheld hand edit FIRST, then adds the drawing as a Preserved Snapshot and makes it the head", async () => {
    const diagram = await created();
    const handDrawn = await editByHand(diagram.id);

    const r = await run([
      "diagram",
      "snapshot",
      "add",
      "--file",
      file(STEP_2),
      diagram.id,
    ]);

    expect(r.stderr).toBe("");
    expect(r.exitCode).toBe(0);
    const [line, ...rest] = ndjson(r.stdout) as Added[];
    expect(rest).toEqual([]);
    expect(Object.keys(line!).sort()).toEqual(["image", "snapshotId"]);

    const snapshots = await snapshotsOf(diagram.id);
    // Nothing is lost: the first drawing, Matt's hand edit, then the new one.
    expect(snapshots.map((s) => [s.scene, s.preserved])).toEqual([
      [snapshots[0]!.scene, true],
      [handDrawn, true],
      [snapshots[2]!.scene, true],
    ]);
    expect(snapshots[0]!.id).toBe(diagram.snapshots[0]!.id);
    expect(readSimpleDiagram((snapshots[2]!.scene as Scene).store)).toEqual({
      shapes: STEP_2.shapes,
    });
    expect(line!.snapshotId).toBe(snapshots[2]!.id);

    const [row] = await db().query.diagrams.findMany();
    expect(row!.headScene).toEqual(snapshots[2]!.scene);

    expect(render.calls.at(-1)!.scene).toEqual(snapshots[2]!.scene);
    expect(line!.image).toBe(
      nodePath.join(DIAGRAM_RENDERS, `${line!.snapshotId}.png`)
    );
    expect(nodeFs.readFileSync(line!.image, "utf8")).toBe("RENDERED-PNG");
    nodeFs.rmSync(line!.image);
  });

  it("applies the drawing ONTO the head: get -> change one text -> snapshot add changes only that text", async () => {
    const diagram = await created();
    const head = await polishByHand(diagram.id);

    const got = await run(["diagram", "get", diagram.id]);
    const [{ head: read }] = ndjson(got.stdout) as [
      { head: { shapes: Array<Record<string, unknown>> } },
    ];
    const edited = read.shapes.map((s) =>
      s.id === "label" ? { ...s, text: "Agent v2" } : s
    );
    const r = await run([
      "diagram",
      "snapshot",
      "add",
      "--file",
      file({ shapes: edited }),
      diagram.id,
    ]);

    expect(r.stderr).toBe("");
    expect(r.exitCode).toBe(0);
    const added = (await snapshotsOf(diagram.id)).at(-1)!.scene as Scene;
    // Everything Matt did by hand survives — icon size, font, wrapping
    // width, stroke size, opacity, a dragged arrow anchor, a scribble the
    // format cannot say — and the one text is the only change.
    const label = "shape:label";
    expect({ ...added.store, [label]: head.store[label] }).toEqual(head.store);
    expect(added.schema).toEqual(head.schema);
    expect(readSimpleDiagram(added.store).shapes).toEqual(edited);
  });

  it("removes a shape the drawing leaves out, gives a new one Matt's defaults, and keeps an unlisted 'other'", async () => {
    const diagram = await created();
    const head = await polishByHand(diagram.id);
    const shapes = readSimpleDiagram(head.store).shapes.filter(
      (s) => s.id !== "rule" && s.type !== "other"
    );
    const memory = { type: "box", id: "memory", x: 800, y: 0, w: 200, h: 100 };

    const r = await run([
      "diagram",
      "snapshot",
      "add",
      "--file",
      file({ shapes: [...shapes, memory] }),
      diagram.id,
    ]);

    expect(r.exitCode).toBe(0);
    const added = (await snapshotsOf(diagram.id)).at(-1)!.scene as Scene;
    expect(added.store["shape:rule"]).toBeUndefined();
    expect(added.store["shape:scribble"]).toEqual(head.store["shape:scribble"]);
    expect(readSimpleDiagram(added.store).shapes.at(-1)).toEqual(memory);
    expect(added.store["shape:memory"]!.props).toEqual(
      expect.objectContaining({ font: "draw", size: "m", dash: "draw" })
    );
  });

  it("refuses an 'other' the head does not have, exit 3, and draws nothing", async () => {
    const diagram = await created();
    render.calls = [];

    const r = await run([
      "diagram",
      "snapshot",
      "add",
      "--file",
      file({ shapes: [...STEP_2.shapes, { type: "other", id: "ghost" }] }),
      diagram.id,
    ]);

    expect(r.exitCode).toBe(3);
    expect(failureOf(r).message).toContain('other "ghost"');
    expect(await snapshotsOf(diagram.id)).toHaveLength(1);
    expect(render.calls).toEqual([]);
  });

  it("adds no extra snapshot when the head is already held by one", async () => {
    const diagram = await created();

    const r = await run([
      "diagram",
      "snapshot",
      "add",
      "--file",
      file(STEP_2),
      diagram.id,
    ]);

    expect(r.exitCode).toBe(0);
    const snapshots = await snapshotsOf(diagram.id);
    expect(snapshots.map((s) => s.id)).toEqual([
      diagram.snapshots[0]!.id,
      (ndjson(r.stdout)[0] as Added).snapshotId,
    ]);
  });

  it("takes the Diagram's playground url as its id", async () => {
    const diagram = await created();

    const r = await run([
      "diagram",
      "snapshot",
      "add",
      "--file",
      file(STEP_2),
      diagram.url,
    ]);

    expect(r.exitCode).toBe(0);
    expect(await snapshotsOf(diagram.id)).toHaveLength(2);
  });

  it("refuses a name or a batch, exit 3, and writes and draws nothing", async () => {
    const diagram = await created();
    render.calls = [];

    for (const body of [DRAFT, { snapshots: [STEP_2] }]) {
      const r = await run([
        "diagram",
        "snapshot",
        "add",
        "--file",
        file(body),
        diagram.id,
      ]);
      expect(r.exitCode).toBe(3);
      expect(failureOf(r).message).toContain('a snapshot has no "name"');
    }
    expect(await snapshotsOf(diagram.id)).toHaveLength(1);
    expect(render.calls).toEqual([]);
  });

  it("is NotFoundError, exit 2, for a missing Diagram, and draws nothing", async () => {
    const r = await run([
      "diagram",
      "snapshot",
      "add",
      "--file",
      file(STEP_2),
      "00000000-0000-0000-0000-000000000000",
    ]);

    expect(r.exitCode).toBe(2);
    expect(failureOf(r)._tag).toBe("NotFoundError");
    expect(render.calls).toEqual([]);
  });

  it("writes nothing when the PNG cannot be drawn (exit 4) — not even the hand edit's snapshot", async () => {
    const diagram = await created();
    const handDrawn = await editByHand(diagram.id);
    render.fail = true;

    const r = await run([
      "diagram",
      "snapshot",
      "add",
      "--file",
      file(STEP_2),
      diagram.id,
    ]);

    expect(r.exitCode).toBe(4);
    expect(await snapshotsOf(diagram.id)).toHaveLength(1);
    const [row] = await db().query.diagrams.findMany();
    expect(row!.headScene).toEqual(handDrawn);
  });

  it("is local-only: exit 7", async () => {
    delete process.env[LOCAL_MACHINE_ENV_KEY];
    const r = await run([
      "diagram",
      "snapshot",
      "add",
      "--file",
      nodePath.join(dir(), "missing.json"),
      "x",
    ]);
    expect(r.exitCode).toBe(7);
  });
});

describe("cvm diagram render", () => {
  it("draws the SNAPSHOT, not the head, to <snapshotId>.png", async () => {
    const diagram = await created();
    await editByHand(diagram.id);
    const [stored] = await snapshotsOf(diagram.id);
    render.calls = [];

    const r = await run(["diagram", "render", stored!.id]);

    expect(r.stderr).toBe("");
    expect(r.exitCode).toBe(0);
    const image = nodePath.join(DIAGRAM_RENDERS, `${stored!.id}.png`);
    expect(ndjson(r.stdout)).toEqual([{ snapshotId: stored!.id, image }]);
    expect(render.calls).toHaveLength(1);
    expect(render.calls[0]!.scene).toEqual(stored!.scene);
    expect(render.calls[0]!.appUrl).toBe("http://localhost:5299");
    expect(nodeFs.readFileSync(image, "utf8")).toBe("RENDERED-PNG");
    nodeFs.rmSync(image);
  });

  it("is NotFoundError, exit 2, for a missing snapshot", async () => {
    const r = await run([
      "diagram",
      "render",
      "00000000-0000-0000-0000-000000000000",
    ]);

    expect(r.exitCode).toBe(2);
    expect(failureOf(r)._tag).toBe("NotFoundError");
    expect(render.calls).toEqual([]);
  });

  it("is local-only: exit 7", async () => {
    delete process.env[LOCAL_MACHINE_ENV_KEY];
    const r = await run(["diagram", "render", "x"]);
    expect(r.exitCode).toBe(7);
    expect(render.calls).toEqual([]);
  });
});

describe("cvm diagram snapshot update", () => {
  type Updated = Added & {
    changed: boolean;
    headMoved: boolean;
    previous: { shapes: Array<Record<string, unknown>> };
  };

  /** A batch: the head is the first drawing, STEP_2 the second. */
  const createdWithTwo = async () => {
    const r = await run([
      "diagram",
      "create",
      "--file",
      file({
        name: "Agent loop",
        snapshots: [DRAFT, STEP_2].map(({ shapes }) => ({ shapes })),
      }),
    ]);
    expect(r.exitCode).toBe(0);
    return ndjson(r.stdout)[0] as Created;
  };

  /** The first drawing with its label nudged off the box edge. */
  const NUDGED = {
    shapes: DRAFT.shapes.map((s) =>
      s.id === "label" ? { ...s, x: 70, y: 40, text: "Agent v2" } : s
    ),
  };

  const update = (snapshotId: string, body: unknown) =>
    run(["diagram", "snapshot", "update", "--file", file(body), snapshotId]);

  it("redraws the snapshot IN PLACE — same id, place and Preserved mark — moves the head that showed it, and prints the old drawing", async () => {
    const diagram = await createdWithTwo();
    const before = await snapshotsOf(diagram.id);
    const target = before[0]!;

    const r = await update(target.id, NUDGED);

    expect(r.stderr).toBe("");
    expect(r.exitCode).toBe(0);
    const [line] = ndjson(r.stdout) as Updated[];
    expect(line).toEqual({
      snapshotId: target.id,
      image: nodePath.join(DIAGRAM_RENDERS, `${target.id}.png`),
      changed: true,
      headMoved: true,
      previous: { shapes: DRAFT.shapes },
    });
    nodeFs.rmSync(line!.image);

    const after = await snapshotsOf(diagram.id);
    expect(after.map((s) => [s.id, s.preserved, s.createdAt])).toEqual(
      before.map((s) => [s.id, s.preserved, s.createdAt])
    );
    const scene = after[0]!.scene as Scene;
    expect(readSimpleDiagram(scene.store).shapes).toEqual(NUDGED.shapes);
    expect(after[0]!.searchText).toContain("Agent v2");
    expect(after[1]!.scene).toEqual(before[1]!.scene);
    const [row] = await db().query.diagrams.findMany();
    expect(row!.headScene).toEqual(scene);
  });

  it("REFUSES a filmed snapshot (a live Clip pins it), exit 3, and writes nothing", async () => {
    const diagram = await createdWithTwo();
    const [target] = await snapshotsOf(diagram.id);
    const [video] = await db()
      .insert(schema.videos)
      .values({ title: "v.mp4", originalFootagePath: "f.mp4" })
      .returning();
    const [clip] = await db()
      .insert(schema.clips)
      .values({
        videoId: video!.id,
        videoFilename: "a.mp4",
        sourceStartTime: 0,
        sourceEndTime: 1,
        order: "0001",
        text: "hello",
        diagramSnapshotId: target!.id,
      })
      .returning();

    const r = await update(target!.id, NUDGED);

    expect(r.exitCode).toBe(3);
    expect(failureOf(r).message).toContain(
      `REFUSED: snapshot ${target!.id} was FILMED — 1 Clip pins it (${clip!.id})`
    );
    expect(await snapshotsOf(diagram.id)).toEqual(
      expect.arrayContaining([target])
    );
    const [row] = await db().query.diagrams.findMany();
    expect(row!.headScene).toEqual(target!.scene);
  });

  /** Matt's polish (hidden styles, an `other` scribble) on the second snapshot. */
  const polishedSecond = async () => {
    const diagram = await createdWithTwo();
    const polished = await polishByHand(diagram.id);
    const [, target] = await snapshotsOf(diagram.id);
    await db()
      .update(schema.diagramSnapshots)
      .set({ scene: polished, contentHash: hashScene(polished) })
      .where(eq(schema.diagramSnapshots.id, target!.id));
    return { diagram, target: (await snapshotsOf(diagram.id))[1]! };
  };

  it("undoes a bad update with a second one: 'previous' brings the old drawing back exactly — 'other' and hidden styles included", async () => {
    const { diagram, target } = await polishedSecond();
    const shapes = readSimpleDiagram((target.scene as Scene).store).shapes;
    expect(shapes).toContainEqual({ type: "other", id: "scribble" });

    const bad = await update(target.id, {
      shapes: shapes.map((s) =>
        s.id === "label"
          ? { ...s, x: 70, text: "Agent v2" }
          : s.id === "agent"
            ? { ...s, color: "red" }
            : s
      ),
    });
    expect(bad.exitCode).toBe(0);
    const { previous } = ndjson(bad.stdout)[0] as Updated;

    const undo = await update(target.id, previous);

    expect(undo.exitCode).toBe(0);
    const restored = (await snapshotsOf(diagram.id))[1]!;
    expect(restored.id).toBe(target.id);
    expect(restored.scene).toEqual(target.scene);
    expect(restored.contentHash).toBe(target.contentHash);
  });

  it("REFUSES an update 'previous' could not undo exactly (a removed hand-sized icon), exit 3, and writes and draws nothing", async () => {
    const { diagram, target } = await polishedSecond();
    const shapes = readSimpleDiagram((target.scene as Scene).store).shapes;
    render.calls = [];

    const r = await update(target.id, {
      shapes: shapes.filter((s) => s.id !== "bot"),
    });

    expect(r.exitCode).toBe(3);
    expect(failureOf(r).message).toContain(
      'could not be undone exactly — "previous" would not bring back shape:bot'
    );
    expect((await snapshotsOf(diagram.id))[1]).toEqual(target);
    expect(render.calls).toEqual([]);
  });
});
