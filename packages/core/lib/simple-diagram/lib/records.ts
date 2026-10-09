// Internal: the tldraw side — the record shapes the scene stores, rich text,
// and the small geometry the two directions share. Reach it only through
// `../index`.

/** One raw tldraw record from a scene's `store`, as stored in `head_scene`. */
export interface SceneRecord {
  id: string;
  typeName: string;
  [key: string]: unknown;
}

/** A scene's `store`: the tldraw `document` records, keyed by id. */
export type SceneStore = Record<string, SceneRecord>;

/** A scene as stored on a Diagram's head: `getStoreSnapshot("document")`. */
export interface Scene {
  store: SceneStore;
  schema: unknown;
}

export interface ShapeRecord extends SceneRecord {
  typeName: "shape";
  type: string;
  x: number;
  y: number;
  rotation: number;
  index: string;
  parentId: string;
  props: Record<string, unknown>;
}

export interface BindingRecord extends SceneRecord {
  typeName: "binding";
  type: string;
  fromId: string;
  toId: string;
  props: Record<string, unknown>;
}

export const SHAPE_PREFIX = "shape:";

export function toShapeId(simpleId: string): string {
  return `${SHAPE_PREFIX}${simpleId}`;
}

export function toSimpleId(shapeId: string): string {
  return shapeId.startsWith(SHAPE_PREFIX)
    ? shapeId.slice(SHAPE_PREFIX.length)
    : shapeId;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

export function isShapeRecord(record: unknown): record is ShapeRecord {
  return (
    isObject(record) &&
    record.typeName === "shape" &&
    typeof record.id === "string" &&
    typeof record.type === "string" &&
    isObject(record.props)
  );
}

export function isBindingRecord(record: unknown): record is BindingRecord {
  return (
    isObject(record) &&
    record.typeName === "binding" &&
    typeof record.fromId === "string" &&
    typeof record.toId === "string" &&
    isObject(record.props)
  );
}

/** Two decimals: enough for a canvas, and stable across a round trip. */
export function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return round((rad * 180) / Math.PI);
}

/** A point in a shape's own space, moved into page space. */
export function toPage(
  shape: { x: number; y: number; rotation: number },
  point: { x: number; y: number }
): { x: number; y: number } {
  const cos = Math.cos(shape.rotation);
  const sin = Math.sin(shape.rotation);
  return {
    x: round(shape.x + point.x * cos - point.y * sin),
    y: round(shape.y + point.x * sin + point.y * cos),
  };
}

/** tldraw's `toRichText`: one paragraph per line. */
export function toRichText(text: string): unknown {
  return {
    type: "doc",
    content: text
      .split("\n")
      .map((line) =>
        line
          ? { type: "paragraph", content: [{ type: "text", text: line }] }
          : { type: "paragraph" }
      ),
  };
}

/** Rich text back to plain text, one line per block. Tolerant of odd input. */
export function fromRichText(richText: unknown): string {
  if (!isObject(richText) || !Array.isArray(richText.content)) return "";
  return richText.content
    .map((block: unknown) => collectText(block))
    .join("\n");
}

function collectText(node: unknown): string {
  if (!isObject(node)) return "";
  if (node.type === "text" && typeof node.text === "string") return node.text;
  if (!Array.isArray(node.content)) return "";
  return node.content.map((child: unknown) => collectText(child)).join("");
}

/**
 * The serialized tldraw schema the records built here are written against:
 * tldraw 5.2.4's defaults plus CVM's `cvm-icon`. A NEW scene carries it; an
 * updated scene keeps its own. tldraw migrates a scene forward from whatever
 * schema it names on load, so pinning this is safe across tldraw upgrades —
 * the test that compares it with the live schema only says when to bump it
 * alongside the records.
 */
export const SCENE_SCHEMA = {
  schemaVersion: 2,
  sequences: {
    "com.tldraw.store": 5,
    "com.tldraw.asset": 1,
    "com.tldraw.camera": 1,
    "com.tldraw.document": 2,
    "com.tldraw.instance": 26,
    "com.tldraw.instance_page_state": 5,
    "com.tldraw.page": 1,
    "com.tldraw.instance_presence": 6,
    "com.tldraw.pointer": 1,
    "com.tldraw.shape": 4,
    "com.tldraw.user": 1,
    "com.tldraw.asset.image": 6,
    "com.tldraw.asset.video": 5,
    "com.tldraw.asset.bookmark": 2,
    "com.tldraw.shape.arrow": 8,
    "com.tldraw.shape.bookmark": 2,
    "com.tldraw.shape.draw": 5,
    "com.tldraw.shape.embed": 4,
    "com.tldraw.shape.frame": 1,
    "com.tldraw.shape.geo": 11,
    "com.tldraw.shape.group": 0,
    "com.tldraw.shape.highlight": 4,
    "com.tldraw.shape.image": 5,
    "com.tldraw.shape.line": 5,
    "com.tldraw.shape.note": 13,
    "com.tldraw.shape.text": 4,
    "com.tldraw.shape.video": 4,
    "com.tldraw.shape.cvm-icon": 0,
    "com.tldraw.binding.arrow": 1,
  },
} as const;

export const DEFAULT_PAGE_ID = "page:page";

/** The non-shape records every new tldraw document starts with. */
export function emptyStore(): SceneStore {
  return {
    "document:document": {
      id: "document:document",
      typeName: "document",
      gridSize: 10,
      name: "",
      meta: {},
    },
    [DEFAULT_PAGE_ID]: {
      id: DEFAULT_PAGE_ID,
      typeName: "page",
      name: "Page 1",
      index: "a1",
      meta: {},
    },
  };
}
