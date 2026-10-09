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
import { APP_URL_ENV_KEY, LOCAL_MACHINE_ENV_KEY } from "./env";
import {
  buildWriteLayer,
  ndjson,
  type RunResult,
} from "./cli-write-test-harness";

// ===========================================================================
// cvm diagram update / delete / restore: the Diagram's name and archive state,
// never its drawings. Diagrams are made with the real `create` (browser
// faked, as in cli-diagram-get.test.ts).
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

const restoreEnv = (key: string, value: string | undefined) => {
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
  restoreEnv(LOCAL_MACHINE_ENV_KEY, saved.local);
  restoreEnv(APP_URL_ENV_KEY, saved.app);
});

beforeEach(async () => {
  process.env[LOCAL_MACHINE_ENV_KEY] = "true";
  dir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "cvm-diagram-update-"));
  await testDb.delete(schema.diagrams);
});

const STEP_1 = [
  { type: "box", id: "agent", x: 0, y: 0, w: 200, h: 100 },
  { type: "text", id: "label", x: 60, y: 34, text: "Agent" },
];
const STEP_2 = [
  ...STEP_1,
  { type: "icon", id: "bot", x: 76, y: -70, name: "bot" },
];

type Written = { id: string; name: string; archived: boolean; url: string };

const create = async () => {
  const path = nodePath.join(dir, "diagram.json");
  nodeFs.writeFileSync(
    path,
    JSON.stringify({
      name: "Agent loop",
      snapshots: [{ shapes: STEP_1 }, { shapes: STEP_2 }],
    })
  );
  const r = await run(["diagram", "create", "--file", path]);
  expect(r.exitCode).toBe(0);
  return ndjson(r.stdout)[0] as { id: string };
};

/** Every drawing the Diagram has: the head columns and every snapshot row. */
const drawings = async (id: string) => {
  const d = await testDb.query.diagrams.findFirst({
    where: eq(schema.diagrams.id, id),
  });
  return {
    head: {
      headScene: d!.headScene,
      searchText: d!.searchText,
    },
    snapshots: await testDb.query.diagramSnapshots.findMany({
      where: eq(schema.diagramSnapshots.diagramId, id),
    }),
  };
};

const row = (id: string) =>
  testDb.query.diagrams.findFirst({ where: eq(schema.diagrams.id, id) });

const get = async (id: string) => {
  const r = await run(["diagram", "get", id]);
  expect(r.exitCode).toBe(0);
  return ndjson(r.stdout)[0] as Record<string, unknown>;
};

/** What the playground lists: Playground Home, its list and its search. */
const listed = async (id: string) =>
  (
    await testDb.query.diagrams.findMany({
      where: eq(schema.diagrams.archived, false),
    })
  ).some((d) => d.id === id);

describe("cvm diagram update / delete / restore", () => {
  it("update renames the Diagram (trimmed) and never touches a drawing", async () => {
    const { id } = await create();
    const before = await drawings(id);

    const r = await run(["diagram", "update", "--name", "  Tool loop  ", id]);

    expect(r.exitCode).toBe(0);
    const out = ndjson(r.stdout)[0] as Written;
    expect(out).toEqual({
      id,
      name: "Tool loop",
      archived: false,
      url: `http://localhost:5299/diagram-playground/${id}`,
    });
    expect((await row(id))!.name).toBe("Tool loop");
    expect(await drawings(id)).toEqual(before);
  });

  it("update refuses an empty --name, exit 3, writing nothing", async () => {
    const { id } = await create();
    const before = await row(id);

    const r = await run(["diagram", "update", "--name", "   ", id]);

    expect(r.exitCode).toBe(3);
    expect(await row(id)).toEqual(before);
  });

  it("delete archives it out of the playground's lists; restore brings it back whole", async () => {
    const { id } = await create();
    const before = await drawings(id);
    const got = await get(id);
    expect(got.archived).toBe(false);

    const deleted = await run(["diagram", "delete", id]);
    expect(deleted.exitCode).toBe(0);
    expect((ndjson(deleted.stdout)[0] as Written).archived).toBe(true);
    expect(await listed(id)).toBe(false);
    expect(await get(id)).toEqual({ ...got, archived: true });

    const restored = await run(["diagram", "restore", id]);
    expect(restored.exitCode).toBe(0);
    expect((ndjson(restored.stdout)[0] as Written).archived).toBe(false);
    expect(await listed(id)).toBe(true);
    expect(await get(id)).toEqual(got);
    expect(await drawings(id)).toEqual(before);
  });

  it("delete and restore are no-ops on a Diagram already in that state", async () => {
    const { id } = await create();
    await run(["diagram", "delete", id]);

    const again = await run(["diagram", "delete", id]);
    expect(again.exitCode).toBe(0);
    expect((await row(id))!.archived).toBe(true);

    await run(["diagram", "restore", id]);
    const twice = await run(["diagram", "restore", id]);
    expect(twice.exitCode).toBe(0);
    expect((await row(id))!.archived).toBe(false);
  });

  it.each([[["update", "--name", "X"]], [["delete"]], [["restore"]]])(
    "%j is NotFoundError, exit 2, for a missing Diagram",
    async (verb) => {
      const r = await run([
        "diagram",
        ...verb,
        "00000000-0000-0000-0000-000000000000",
      ]);
      expect(r.exitCode).toBe(2);
      expect(JSON.parse(r.stderr.trim())._tag).toBe("NotFoundError");
    }
  );

  it("is not local-only: none of them draws", async () => {
    const { id } = await create();
    delete process.env[LOCAL_MACHINE_ENV_KEY];

    for (const verb of [["update", "--name", "Y"], ["delete"], ["restore"]]) {
      const r = await run(["diagram", ...verb, id]);
      expect(r.exitCode).toBe(0);
    }
  });
});
