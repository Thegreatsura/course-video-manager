import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Effect, Layer } from "effect";
import nodeFs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { buildProgram } from "@/cli/main";
import { makeTestCliOutput } from "@/cli/output";
import * as schema from "@/db/schema";
import {
  DiagramRenderError,
  FrameCaptureService,
} from "@/services/frame-capture-service";
import { createTestDb, type TestDb } from "@/test-utils/pglite";
import {
  readSimpleDiagram,
  type Scene,
} from "@cvm/core/lib/simple-diagram/index";
import { APP_URL_ENV_KEY, LOCAL_MACHINE_ENV_KEY } from "./env";
import {
  buildWriteLayer,
  ndjson,
  type RunResult,
} from "./cli-write-test-harness";

// ===========================================================================
// cvm diagram create: simple-format JSON -> a NEW Diagram + a PNG to check
//
// The browser is faked with Layer.succeed, as in the clip-mockup suites: the
// command finds the fake through Effect.serviceOption, so no Chromium launches
// and no daemon starts. The fake writes canned bytes where it is told to and
// records the scene and app origin it was handed.
// ===========================================================================

interface RenderCall {
  appUrl: string;
  scene: unknown;
  outputPath: string;
}

let render: { fail: boolean; calls: RenderCall[] } = { fail: false, calls: [] };

const fakeRender = Layer.succeed(FrameCaptureService, {
  renderDiagramToPng: (params: RenderCall) =>
    Effect.suspend(() => {
      render.calls.push(params);
      if (render.fail) {
        return Effect.fail(
          new DiagramRenderError({
            cause: null,
            message:
              "could not render the Diagram: net::ERR_CONNECTION_REFUSED",
          })
        );
      }
      nodeFs.writeFileSync(params.outputPath, "RENDERED-PNG");
      return Effect.succeed(params.outputPath);
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
  dir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "cvm-diagram-"));
  render = { fail: false, calls: [] };
  await testDb.delete(schema.diagrams);
});

const file = (body: unknown): string => {
  const path = nodePath.join(dir, "diagram.json");
  nodeFs.writeFileSync(
    path,
    typeof body === "string" ? body : JSON.stringify(body)
  );
  return path;
};

const failureOf = (r: RunResult) =>
  JSON.parse(r.stderr.trim()) as { _tag: string; message: string };

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

describe("cvm diagram create", () => {
  it("creates a NEW Diagram whose head reads back as the shapes given, and prints {id, url, image}", async () => {
    const r = await run(["diagram", "create", "--file", file(DRAFT)]);

    expect(r.stderr).toBe("");
    expect(r.exitCode).toBe(0);
    const [line, ...rest] = ndjson(r.stdout) as Array<{
      id: string;
      url: string;
      image: string;
    }>;
    expect(rest).toEqual([]);
    expect(Object.keys(line!).sort()).toEqual(["id", "image", "url"]);

    const rows = await testDb.query.diagrams.findMany();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(line!.id).toBe(row.id);
    expect(row.name).toBe("Agent loop");
    expect(row.archived).toBe(false);
    // The head is the scene the simple format builds, so it reads back as
    // exactly what was drawn — the arrow still bound to both boxes.
    expect(readSimpleDiagram((row.headScene as Scene).store)).toEqual({
      shapes: DRAFT.shapes,
    });
    // Search finds the words on the canvas, like a Diagram drawn by hand.
    expect(row.searchText).toContain("Agent");

    expect(line!.url).toBe(
      `http://localhost:5299/diagram-playground/${row.id}`
    );
    expect(line!.image).toBe(
      nodePath.join(os.tmpdir(), "cvm-diagram-renders", `${row.id}.png`)
    );
    expect(nodeFs.readFileSync(line!.image, "utf8")).toBe("RENDERED-PNG");
    nodeFs.rmSync(line!.image);
  });

  it("draws the very scene it stores, through the app at CVM_APP_URL", async () => {
    await run(["diagram", "create", "--file", file(DRAFT)]);

    const [row] = await testDb.query.diagrams.findMany();
    expect(render.calls).toHaveLength(1);
    expect(render.calls[0]!.appUrl).toBe("http://localhost:5299");
    expect(render.calls[0]!.scene).toEqual(row!.headScene);
    expect(
      render.calls[0]!.outputPath.startsWith(
        nodePath.join(os.tmpdir(), "cvm-diagram-renders")
      )
    ).toBe(true);
  });

  it("names a Diagram with no name 'Untitled N', like the playground", async () => {
    const { name: _, ...unnamed } = DRAFT;
    const r = await run(["diagram", "create", "--file", file(unnamed)]);

    expect(r.exitCode).toBe(0);
    const [row] = await testDb.query.diagrams.findMany();
    expect(row!.name).toBe("Untitled 1");
  });

  it("reports EVERY problem at once, exit 3, and writes and draws nothing", async () => {
    const r = await run([
      "diagram",
      "create",
      "--file",
      file({
        shapes: [
          { type: "box", id: "a", x: 0, y: 0, w: 100, h: 50 },
          { type: "triangle", id: "t" },
          { type: "icon", id: "i", x: 0, y: 0, name: "not-an-icon" },
          { type: "arrow", id: "x", from: "a", to: "ghost" },
          { type: "box", id: "a", x: 0, y: 0, w: 10, h: 10, colour: "red" },
        ],
      }),
    ]);

    expect(r.exitCode).toBe(3);
    expect(r.stdout).toBe("");
    const failure = failureOf(r);
    expect(failure._tag).toBe("ParseError");
    expect(failure.message).toContain('unknown type "triangle"');
    expect(failure.message).toContain('unknown icon "not-an-icon"');
    expect(failure.message).toContain('points at "ghost"');
    expect(failure.message).toContain('unknown field "colour"');
    expect(await testDb.query.diagrams.findMany()).toEqual([]);
    expect(render.calls).toEqual([]);
  });

  it("refuses a file that is not JSON, exit 3", async () => {
    const r = await run(["diagram", "create", "--file", file("{ nope")]);

    expect(r.exitCode).toBe(3);
    expect(failureOf(r).message).toContain("is not valid JSON");
  });

  it("refuses an `other` shape: create only ever makes a new Diagram", async () => {
    const r = await run([
      "diagram",
      "create",
      "--file",
      file({ shapes: [{ type: "other", id: "kept" }] }),
    ]);

    expect(r.exitCode).toBe(3);
    expect(failureOf(r).message).toContain('other "kept"');
    expect(await testDb.query.diagrams.findMany()).toEqual([]);
  });

  it("writes nothing when the PNG cannot be drawn (exit 4, DiagramRenderError), so a retry never duplicates", async () => {
    render.fail = true;

    const r = await run(["diagram", "create", "--file", file(DRAFT)]);

    expect(r.exitCode).toBe(4);
    expect(r.stdout).toBe("");
    expect(failureOf(r)._tag).toBe("DiagramRenderError");
    expect(await testDb.query.diagrams.findMany()).toEqual([]);
  });

  it("is local-only: refused with exit 7 before the file is even read", async () => {
    delete process.env[LOCAL_MACHINE_ENV_KEY];

    const r = await run([
      "diagram",
      "create",
      "--file",
      nodePath.join(dir, "missing.json"),
    ]);

    expect(r.exitCode).toBe(7);
    expect(failureOf(r)._tag).toBe("LocalOnlyCommandError");
    expect(render.calls).toEqual([]);
  });
});
