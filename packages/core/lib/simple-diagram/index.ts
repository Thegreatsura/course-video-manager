// Entry point (public) for the simple-diagram package.
// A deep module: this small surface hides the tldraw record shapes, rich
// text, bindings and the merge rules in `./lib`.
//
// The SIMPLE SHAPE FORMAT is how an agent reads and draws a Diagram: a short
// list of boxes, ellipses, text, arrows, lines and icons in Matt's house
// style, instead of raw tldraw records. It covers what his Diagrams actually
// use; anything else reads back as `other` and is left alone.
//
//   { "name"?: string, "shapes": [
//       { "type": "box" | "ellipse", "id", "x", "y", "w", "h", "color"?, "fill"?, "dash"? },
//       { "type": "text", "id", "x", "y", "text", "size"?, "color"?, "rotation"? (degrees) },
//       { "type": "arrow", "id", "from"? | "x1"?,"y1"?, "to"? | "x2"?,"y2"?,
//         "text"?, "bend"?, "heads"? ("end" | "both" | "none"), "color"?, "dash"? },
//       { "type": "line", "id", "x1", "y1", "x2", "y2", "color"?, "dash"? },
//       { "type": "icon", "id", "x", "y", "name" (Lucide), "color"? },
//       { "type": "other", "id" } ] }
//
// Pure: no database, no tldraw runtime. A scene goes in and out as the JSON a
// Diagram's head stores.

export {
  COLORS,
  DASHES,
  DEFAULTS,
  FILLS,
  HEADS,
  SHAPE_SCHEMAS,
  SHAPE_TYPES,
  SIZES,
  type SimpleArrow,
  type SimpleBox,
  type SimpleColor,
  type SimpleDash,
  type SimpleDiagram,
  type SimpleEllipse,
  type SimpleFill,
  type SimpleHeads,
  type SimpleIcon,
  type SimpleLine,
  type SimpleOther,
  type SimpleShape,
  type SimpleShapeType,
  type SimpleSize,
  type SimpleText,
} from "./lib/format.js";

export {
  SCENE_SCHEMA,
  type Scene,
  type SceneRecord,
  type SceneStore,
} from "./lib/records.js";

/** Untrusted JSON -> a SimpleDiagram, or every error at once. */
export { parseSimpleDiagram, type ParseResult } from "./lib/validate.js";

/** A scene's store -> the simple format; what it cannot say comes back as `other`. */
export { readSimpleDiagram } from "./lib/read.js";

/** A validated SimpleDiagram -> a new scene, or merged onto an existing one. */
export { applySimpleDiagram, type ApplyResult } from "./lib/write.js";
