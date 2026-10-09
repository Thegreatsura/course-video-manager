import { expect, describe, it } from "vitest";
import { MAX_COORDINATE, MAX_SHAPES, parseSimpleDiagram } from "../index.js";
import { iconNames } from "./fixtures.js";

function errorsFor(input: unknown): string[] {
  const parsed = parseSimpleDiagram(input, iconNames);
  expect(parsed.ok).toBe(false);
  return parsed.ok ? [] : parsed.errors;
}

describe("validation errors", () => {
  it("unknown type", () => {
    expect(errorsFor({ shapes: [{ type: "triangle", id: "t" }] })).toEqual([
      'shapes[0] ("t"): unknown type "triangle" — expected one of box, ellipse, text, arrow, line, icon, other',
    ]);
  });

  it("unknown icon", () => {
    expect(
      errorsFor({
        shapes: [{ type: "icon", id: "i", x: 0, y: 0, name: "not-an-icon" }],
      })
    ).toEqual([
      'icon "i": unknown icon "not-an-icon" — use a Lucide icon name, e.g. "database"',
    ]);
  });

  it("arrow pointing at a missing id", () => {
    expect(
      errorsFor({
        shapes: [{ type: "arrow", id: "a", from: "nowhere", x2: 0, y2: 0 }],
      })
    ).toEqual([
      'arrow "a": "from" points at "nowhere", which is not a shape in this Diagram',
    ]);
  });

  it("duplicate id", () => {
    expect(
      errorsFor({
        shapes: [
          { type: "box", id: "x", x: 0, y: 0, w: 1, h: 1 },
          { type: "text", id: "x", x: 0, y: 0, text: "x" },
        ],
      })
    ).toEqual(['duplicate id "x" — every shape needs its own id']);
  });

  it("arrow end with neither a shape nor a point, or with both", () => {
    expect(
      errorsFor({
        shapes: [
          { type: "box", id: "b", x: 0, y: 0, w: 1, h: 1 },
          { type: "arrow", id: "a", from: "b", x1: 0, y1: 0, x2: 1 },
        ],
      })
    ).toEqual([
      'arrow "a": its start has both "from" and x1, y1 — give one or the other',
      'arrow "a": its end needs "to" (a shape id) or both x2, y2',
    ]);
  });

  it("arrow attached to an arrow or a line", () => {
    expect(
      errorsFor({
        shapes: [
          { type: "line", id: "l", x1: 0, y1: 0, x2: 1, y2: 1 },
          { type: "arrow", id: "a", from: "l", x2: 1, y2: 1 },
        ],
      })
    ).toEqual([
      'arrow "a": "from" points at line "l" — arrows attach only to box, ellipse, text, icon or other shapes',
    ]);
  });

  it("missing fields, wrong values and unknown fields name the shape and the field", () => {
    expect(
      errorsFor({
        shapes: [
          {
            type: "box",
            id: "b",
            x: 0,
            y: 0,
            w: -5,
            color: "pink",
            label: "Hi",
          },
          { type: "text", id: "has space", x: 0, y: 0, text: "" },
        ],
      })
    ).toEqual([
      'shapes[0] ("b").w: Too small: expected number to be >0',
      'shapes[0] ("b").h: Invalid input: expected number, received undefined',
      'shapes[0] ("b").color: Invalid option: expected one of "black"|"grey"|"light-violet"|"violet"|"blue"|"light-blue"|"yellow"|"orange"|"green"|"light-green"|"light-red"|"red"|"white"',
      'shapes[0] ("b"): unknown field "label"',
      "shapes[1] (\"has space\").id: must be letters, digits, '_' or '-' (e.g. \"box-1\")",
      'shapes[1] ("has space").text: must not be empty',
    ]);
  });

  it("reports every error at once", () => {
    expect(
      errorsFor({
        shapes: [
          { type: "hexagon", id: "h" },
          { type: "icon", id: "i", x: 0, y: 0, name: "nope" },
          { type: "arrow", id: "a", from: "ghost", to: "i" },
        ],
      })
    ).toHaveLength(3);
  });

  it("an arrow attached to the same shape at both ends", () => {
    expect(
      errorsFor({
        shapes: [
          { type: "box", id: "b", x: 0, y: 0, w: 1, h: 1 },
          { type: "arrow", id: "loop", from: "b", to: "b" },
        ],
      })
    ).toEqual([
      'arrow "loop": "from" and "to" are both "b" — an arrow joins two different shapes',
    ]);
  });

  it("more shapes than a Diagram can hold", () => {
    const shapes = Array.from({ length: MAX_SHAPES + 1 }, (_, n) => ({
      type: "box",
      id: `b${n}`,
      x: n,
      y: 0,
      w: 10,
      h: 10,
    }));
    expect(errorsFor({ shapes })).toEqual([
      `diagram.shapes: ${MAX_SHAPES + 1} shapes — a Diagram holds at most ${MAX_SHAPES} (Matt's are about 10)`,
    ]);
    expect(parseSimpleDiagram({ shapes: shapes.slice(1) }, iconNames).ok).toBe(
      true
    );
  });

  it("a coordinate or size far off the canvas", () => {
    expect(
      errorsFor({
        shapes: [
          { type: "box", id: "b", x: 1e9, y: 0, w: 10, h: MAX_COORDINATE + 1 },
          { type: "line", id: "l", x1: -1e9, y1: 0, x2: 1, y2: 1 },
        ],
      })
    ).toEqual([
      `shapes[0] ("b").x: must be between -${MAX_COORDINATE} and ${MAX_COORDINATE}`,
      `shapes[0] ("b").h: must be between -${MAX_COORDINATE} and ${MAX_COORDINATE}`,
      `shapes[1] ("l").x1: must be between -${MAX_COORDINATE} and ${MAX_COORDINATE}`,
    ]);
  });

  it("a body that is not a Diagram", () => {
    expect(errorsFor({ nodes: [] })).toEqual([
      "diagram.shapes: Invalid input: expected array, received undefined",
      'diagram: unknown field "nodes"',
    ]);
  });
});
