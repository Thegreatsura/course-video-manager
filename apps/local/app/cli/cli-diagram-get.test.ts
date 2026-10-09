import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Effect, Layer } from "effect";
import nodeFs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { eq } from "drizzle-orm";
import { buildProgram } from "@/cli/main";
import { makeTestCliOutput } from "@/cli/output";
import * as schema from "@/db/schema";
import { FrameCaptureService } from "@/services/frame-capture-service";
import { createTestDb, type TestDb } from "@/test-utils/pglite";
import type { Scene } from "@cvm/core/lib/simple-diagram/index";
import { APP_URL_ENV_KEY, LOCAL_MACHINE_ENV_KEY } from "./env";
import {
  buildWriteLayer,
  ndjson,
  type RunResult,
} from "./cli-write-test-harness";

// ===========================================================================
// cvm diagram get: READ the head and the snapshot list in the simple format.
// Diagrams are made with the real `create` (browser faked, as in
// cli-diagram-snapshot.test.ts), so the round trip is create -> get.
// ===========================================================================

const fakeRender = Layer.succeed(FrameCaptureService, {
  renderDiagramToPng: (params: { outputPath: string }) =>
    Effect.sync(() => {
      nodeFs.writeFileSync(params.outputPath, "RENDERED-PNG");
      return params.outputPath;
    }),
} as unknown as FrameCaptureService);

let testDb: TestDb;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;
let dir: string;
const saved = {
  local: process.env[LOCAL_MACHINE_ENV_KEY],
  app: process.env[APP_URL_ENV_KEY],
};

const restore = (key: string, value: string | undefined) => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
  const layer = Layer.merge(buildWriteLayer(testDb), fakeRender);
  run = async (argv) => {
    const out = makeTestCliOutput();
    const exitCode = await Effect.runPromise(
      buildProgram(argv).pipe(Effect.provide(out.layer), Effect.provide(layer))
    );
    return { stdout: out.stdout(), stderr: out.stderr(), exitCode };
  };
  process.env[APP_URL_ENV_KEY] = "http://localhost:5299/";
});

afterAll(() => {
  restore(LOCAL_MACHINE_ENV_KEY, saved.local);
  restore(APP_URL_ENV_KEY, saved.app);
});

beforeEach(async () => {
  process.env[LOCAL_MACHINE_ENV_KEY] = "true";
  dir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "cvm-diagram-get-"));
  await testDb.delete(schema.diagrams);
});

const file = (body: unknown): string => {
  const path = nodePath.join(dir, "diagram.json");
  nodeFs.writeFileSync(path, JSON.stringify(body));
  return path;
};

const STEP_1 = [
  { type: "box", id: "agent", x: 0, y: 0, w: 200, h: 100 },
  { type: "text", id: "label", x: 60, y: 34, text: "Agent" },
  { type: "ellipse", id: "tools", x: 400, y: 0, w: 200, h: 100 },
  { type: "arrow", id: "call", from: "agent", to: "tools", text: "call" },
  { type: "line", id: "rule", x1: 0, y1: 200, x2: 600, y2: 200 },
  { type: "icon", id: "bot", x: 76, y: -70, name: "bot", color: "blue" },
];
const STEP_2 = [
  ...STEP_1,
  { type: "box", id: "memory", x: 800, y: 0, w: 200, h: 100, fill: "semi" },
];

type Created = { id: string; url: string; snapshots: Array<{ id: string }> };
type Got = {
  id: string;
  name: string;
  url: string;
  head: { shapes: unknown[] };
  snapshots: Array<{
    id: string;
    preserved: boolean;
    clipIds: string[];
    diagramText: string;
    createdAt: string;
  }>;
};

const create = async () => {
  const r = await run([
    "diagram",
    "create",
    "--file",
    file({
      name: "Agent loop",
      snapshots: [{ shapes: STEP_1 }, { shapes: STEP_2 }],
    }),
  ]);
  expect(r.exitCode).toBe(0);
  return ndjson(r.stdout)[0] as Created;
};

const writes = async () => ({
  diagrams: await testDb.query.diagrams.findMany(),
  snapshots: await testDb.query.diagramSnapshots.findMany(),
});

/** A clip on a fresh video, pinning `snapshotId`. */
const pin = async (snapshotId: string, archived = false) => {
  const [video] = await testDb
    .insert(schema.videos)
    .values({ title: "v.mp4", originalFootagePath: "f.mp4" })
    .returning();
  const [clip] = await testDb
    .insert(schema.clips)
    .values({
      videoId: video!.id,
      videoFilename: "a.mp4",
      sourceStartTime: 0,
      sourceEndTime: 1,
      order: "0001",
      text: "hello",
      archived,
      diagramSnapshotId: snapshotId,
    })
    .returning();
  return clip!.id;
};

describe("cvm diagram get", () => {
  it("round-trips create: the head and each snapshot read back as the shapes given", async () => {
    const created = await create();
    const clipId = await pin(created.snapshots[1]!.id);
    await pin(created.snapshots[1]!.id, true);
    const before = await writes();

    const r = await run(["diagram", "get", created.id]);

    expect(r.stderr).toBe("");
    expect(r.exitCode).toBe(0);
    const [got, ...rest] = ndjson(r.stdout) as Got[];
    expect(rest).toEqual([]);
    expect(got!.id).toBe(created.id);
    expect(got!.name).toBe("Agent loop");
    expect(got!.url).toBe(created.url);
    expect(got!.head).toEqual({ shapes: STEP_1 });
    expect(got!.snapshots.map(({ createdAt: _, ...s }) => s)).toEqual([
      {
        id: created.snapshots[0]!.id,
        preserved: true,
        clipIds: [],
        diagramText: expect.stringContaining("Agent"),
      },
      {
        id: created.snapshots[1]!.id,
        preserved: true,
        clipIds: [clipId],
        diagramText: expect.stringContaining("call"),
      },
    ]);
    expect(Number.isNaN(Date.parse(got!.snapshots[0]!.createdAt))).toBe(false);

    const second = await run([
      "diagram",
      "get",
      "--snapshot",
      created.snapshots[1]!.id,
      created.id,
    ]);
    expect(second.exitCode).toBe(0);
    expect(ndjson(second.stdout)).toEqual([
      { snapshotId: created.snapshots[1]!.id, shapes: STEP_2 },
    ]);

    expect(await writes()).toEqual(before);
  });

  it("reads a hand-drawn shape in the head as `other`", async () => {
    const created = await create();
    const row = await testDb.query.diagrams.findFirst({
      where: (d, { eq }) => eq(d.id, created.id),
    });
    const scene = row!.headScene as Scene;
    const label = scene.store["shape:label"] as Record<string, unknown>;
    await testDb
      .update(schema.diagrams)
      .set({
        headScene: {
          ...scene,
          store: {
            ...scene.store,
            "shape:scribble": {
              ...label,
              id: "shape:scribble",
              type: "draw",
              index: "a9",
              props: { segments: [], color: "black" },
            },
          },
        },
      })
      .where(eq(schema.diagrams.id, created.id));

    const r = await run(["diagram", "get", created.url]);

    expect(r.exitCode).toBe(0);
    expect((ndjson(r.stdout)[0] as Got).head.shapes).toEqual([
      ...STEP_1,
      { type: "other", id: "scribble" },
    ]);
  });

  it("is NotFoundError, exit 2, for a missing Diagram or another Diagram's snapshot", async () => {
    const a = await create();
    const b = await create();

    const missing = await run([
      "diagram",
      "get",
      "00000000-0000-0000-0000-000000000000",
    ]);
    const foreign = await run([
      "diagram",
      "get",
      "--snapshot",
      b.snapshots[0]!.id,
      a.id,
    ]);

    for (const r of [missing, foreign]) {
      expect(r.exitCode).toBe(2);
      expect(JSON.parse(r.stderr.trim())._tag).toBe("NotFoundError");
    }
  });

  it("is not local-only: it only reads", async () => {
    const created = await create();
    delete process.env[LOCAL_MACHINE_ENV_KEY];

    const r = await run(["diagram", "get", created.id]);

    expect(r.exitCode).toBe(0);
  });
});
