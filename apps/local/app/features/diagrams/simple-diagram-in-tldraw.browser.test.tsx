import { beforeAll, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react/pure";
import { Tldraw, type Editor, type TLShapeId } from "tldraw";
import "tldraw/tldraw.css";
import {
  applySimpleDiagram,
  parseSimpleDiagram,
  SCENE_SCHEMA,
  type Scene,
} from "@cvm/core/lib/simple-diagram/index";
import { ICON_NAMES } from "@cvm/lucide-icons";
import { CVM_SHAPE_UTILS } from "./cvm-shape-utils";
import { renderScenePng } from "./render-scene-png";

/**
 * The simple shape format builds raw tldraw records in Node, against a PINNED
 * tldraw schema (`SCENE_SCHEMA`), because tldraw itself will not load in Node.
 * These tests load the real tldraw — the one the Diagram Playground runs — in
 * a real browser, so a tldraw upgrade that moves the schema, or a record the
 * real editor reads differently, fails CI instead of producing Diagrams that
 * open wrong in the playground.
 */

const DRAFT = {
  shapes: [
    { type: "box", id: "agent", x: 0, y: 0, w: 200, h: 100 },
    { type: "text", id: "label", x: 60, y: 34, text: "Agent" },
    { type: "ellipse", id: "tools", x: 400, y: 0, w: 200, h: 100 },
    { type: "arrow", id: "call", from: "agent", to: "tools", text: "call" },
    { type: "line", id: "rule", x1: 0, y1: 200, x2: 600, y2: 200 },
    { type: "icon", id: "bot", x: 76, y: -70, name: "bot" },
  ],
};

const sceneOf = (json: unknown): Scene => {
  const parsed = parseSimpleDiagram(json, new Set(ICON_NAMES));
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  const applied = applySimpleDiagram(null, parsed.diagram);
  if (!applied.ok) throw new Error(applied.errors.join("\n"));
  return applied.scene;
};

const id = (simpleId: string) => `shape:${simpleId}` as TLShapeId;

let editor: Editor;

// ONE editor for the file, never unmounted (`/pure` has no auto-cleanup):
// tldraw loads fonts in the background, and an editor disposed mid-load
// throws from inside tldraw. Each test loads its own scene, which replaces
// the last one.
beforeAll(async () => {
  // The playground's own editor setup: tldraw's defaults plus CVM's shapes.
  editor = await new Promise<Editor>((resolve) => {
    render(
      <div style={{ position: "fixed", inset: 0 }}>
        <Tldraw hideUi shapeUtils={CVM_SHAPE_UTILS} onMount={resolve} />
      </div>
    );
  });
});

describe("the simple format in the real tldraw", () => {
  it("SCENE_SCHEMA is the schema the playground's tldraw writes — bump it with tldraw", () => {
    expect(editor.store.schema.serialize()).toEqual(SCENE_SCHEMA);
  });

  it("a new scene loads with every shape and both arrow bindings", async () => {
    const result = await renderScenePng(editor, sceneOf(DRAFT));
    expect(result.ok).toBe(true);

    expect([...editor.getCurrentPageShapeIds()].map(String).sort()).toEqual(
      DRAFT.shapes.map((s) => `shape:${s.id}`).sort()
    );
    const bindings = editor.getBindingsFromShape(id("call"), "arrow");
    expect(
      bindings.map((b) => [(b.props as { terminal: string }).terminal, b.toId])
    ).toEqual(
      expect.arrayContaining([
        ["start", id("agent")],
        ["end", id("tools")],
      ])
    );
    expect(editor.getShape(id("bot"))?.type).toBe("cvm-icon");
  });

  it("stays editable: moving a box drags the arrow bound to it", async () => {
    await renderScenePng(editor, sceneOf(DRAFT));
    const before = editor.getShapePageBounds(id("call"))!;

    editor.updateShape({ id: id("agent"), type: "geo", x: 0, y: 300 });

    const after = editor.getShapePageBounds(id("call"))!;
    expect(after.maxY).toBeGreaterThan(before.maxY + 100);
  });

  it("renders a PNG", async () => {
    const result = await renderScenePng(editor, sceneOf(DRAFT));
    if (!result.ok) throw new Error(result.message);
    // "\x89PNG" in base64.
    expect(result.pngBase64.startsWith("iVBORw0KGgo")).toBe(true);
  });

  it("exports an icon as plain SVG, whole — not a foreignObject cut to its stroke bounds", async () => {
    await renderScenePng(editor, sceneOf(DRAFT));

    const svg = await editor.getSvgString([id("bot")], { padding: 0 });

    expect(svg?.svg).not.toContain("foreignObject");
    expect(svg?.svg).toContain("<path");
  });

  it("names tldraw's own reason for a scene it refuses", async () => {
    const scene = sceneOf(DRAFT);
    const broken = structuredClone(scene);
    (broken.store["shape:agent"]!.props as Record<string, unknown>).color =
      "pink";

    const result = await renderScenePng(editor, broken);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/tldraw could not draw/);
  });
});
