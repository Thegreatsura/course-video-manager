// Entry point (public) for the extract-scene-text package.
// A deep module: this small surface hides the per-shape parsing, ProseMirror
// traversal, and whitespace normalization in `./lib/impl`.
//
// Extracts flattened, searchable text from a diagram scene's tldraw store.

import { extractShapeText, flattenRichText } from "./lib/impl.js";

/** Flatten a ProseMirror rich-text doc to plain text. Tolerant of malformed input. */
export { flattenRichText };

/** Every shape record in a diagram scene's tldraw store, in the store's order. */
function sceneShapes(scene: unknown): Record<string, unknown>[] {
  if (scene === null || scene === undefined || typeof scene !== "object") {
    return [];
  }

  const s = scene as Record<string, unknown>;
  const store = s.store;
  if (store === null || store === undefined || typeof store !== "object") {
    return [];
  }

  const shapes: Record<string, unknown>[] = [];
  for (const record of Object.values(store as Record<string, unknown>)) {
    if (record === null || typeof record !== "object") continue;
    const rec = record as Record<string, unknown>;
    if (rec.typeName === "shape") shapes.push(rec);
  }
  return shapes;
}

/** Extract all shape text from a diagram scene's store, collapsed to a single string. */
export function extractSceneText(scene: unknown): string {
  return sceneShapes(scene)
    .map(extractShapeText)
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The same words, one line per shape that has any, ordered by shape id. The
 * order is the id's, not the store's, so the live canvas and a stored
 * snapshot (whose `jsonb` keeps keys in its own order) line up shape for
 * shape, and a diff of the two shows only what changed.
 */
export function extractSceneLines(scene: unknown): string[] {
  return sceneShapes(scene)
    .map((shape) => ({
      id: typeof shape.id === "string" ? shape.id : "",
      text: extractShapeText(shape),
    }))
    .filter((shape) => shape.text.length > 0)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((shape) => shape.text);
}
