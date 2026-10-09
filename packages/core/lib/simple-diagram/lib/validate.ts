// Internal: turns untrusted JSON into a SimpleDiagram, or into a list of
// errors an agent can act on without reading this code. Reach it only through
// `../index`.

import type { z } from "zod";
import {
  DiagramEnvelope,
  SHAPE_SCHEMAS,
  SHAPE_TYPES,
  type SimpleDiagram,
  type SimpleShape,
  type SimpleShapeType,
} from "./format.js";

export type ParseResult =
  { ok: true; diagram: SimpleDiagram } | { ok: false; errors: string[] };

/** Shape types an arrow end may attach to. Arrows and lines have no outline. */
const BINDABLE: ReadonlySet<SimpleShapeType> = new Set([
  "box",
  "ellipse",
  "text",
  "icon",
  "other",
]);

function isShapeType(value: unknown): value is SimpleShapeType {
  return (SHAPE_TYPES as readonly unknown[]).includes(value);
}

function formatIssues(where: string, issues: readonly z.core.$ZodIssue[]) {
  return issues.map((issue) => {
    const path = issue.path.join(".");
    if (issue.code === "unrecognized_keys") {
      return `${where}: unknown field${issue.keys.length > 1 ? "s" : ""} ${issue.keys
        .map((k) => `"${k}"`)
        .join(", ")}`;
    }
    return `${where}${path ? `.${path}` : ""}: ${issue.message}`;
  });
}

function describe(index: number, raw: unknown): string {
  const id =
    raw !== null && typeof raw === "object" && "id" in raw
      ? (raw as { id: unknown }).id
      : undefined;
  return typeof id === "string"
    ? `shapes[${index}] ("${id}")`
    : `shapes[${index}]`;
}

/**
 * Parse and validate a simple Diagram. Every problem is reported at once, each
 * naming the shape it is about, so one round trip fixes them all.
 *
 * `iconNames` is the set of Lucide names an icon may use. It is passed in, not
 * imported: `@cvm/lucide-icons` ships TypeScript source, and this package is
 * deployed as plain JavaScript (see tsconfig.build.json).
 */
export function parseSimpleDiagram(
  input: unknown,
  iconNames: ReadonlySet<string>
): ParseResult {
  const envelope = DiagramEnvelope.safeParse(input);
  if (!envelope.success) {
    return {
      ok: false,
      errors: formatIssues("diagram", envelope.error.issues),
    };
  }

  const errors: string[] = [];
  const shapes: SimpleShape[] = [];

  envelope.data.shapes.forEach((raw, index) => {
    const where = describe(index, raw);
    const type =
      raw !== null && typeof raw === "object" && "type" in raw
        ? (raw as { type: unknown }).type
        : undefined;
    if (!isShapeType(type)) {
      errors.push(
        `${where}: unknown type ${JSON.stringify(type)} — expected one of ${SHAPE_TYPES.join(", ")}`
      );
      return;
    }
    const parsed = SHAPE_SCHEMAS[type].safeParse(raw);
    if (!parsed.success) {
      errors.push(...formatIssues(where, parsed.error.issues));
      return;
    }
    shapes.push(parsed.data);
  });

  const byId = new Map<string, SimpleShape>();
  for (const shape of shapes) {
    if (byId.has(shape.id)) {
      errors.push(`duplicate id "${shape.id}" — every shape needs its own id`);
    } else {
      byId.set(shape.id, shape);
    }
  }

  for (const shape of shapes) {
    if (shape.type === "icon" && !iconNames.has(shape.name)) {
      errors.push(
        `icon "${shape.id}": unknown icon "${shape.name}" — use a Lucide icon name, e.g. "database"`
      );
    }
    if (shape.type !== "arrow") continue;
    const ends = [
      {
        end: "start",
        target: shape.from,
        field: "from",
        x: shape.x1,
        y: shape.y1,
        xs: "x1, y1",
      },
      {
        end: "end",
        target: shape.to,
        field: "to",
        x: shape.x2,
        y: shape.y2,
        xs: "x2, y2",
      },
    ] as const;
    for (const e of ends) {
      const hasPoint = e.x !== undefined || e.y !== undefined;
      if (e.target !== undefined && hasPoint) {
        errors.push(
          `arrow "${shape.id}": its ${e.end} has both "${e.field}" and ${e.xs} — give one or the other`
        );
      } else if (
        e.target === undefined &&
        (e.x === undefined || e.y === undefined)
      ) {
        errors.push(
          `arrow "${shape.id}": its ${e.end} needs "${e.field}" (a shape id) or both ${e.xs}`
        );
      } else if (e.target !== undefined) {
        const target = byId.get(e.target);
        if (!target) {
          errors.push(
            `arrow "${shape.id}": "${e.field}" points at "${e.target}", which is not a shape in this Diagram`
          );
        } else if (!BINDABLE.has(target.type)) {
          errors.push(
            `arrow "${shape.id}": "${e.field}" points at ${target.type} "${e.target}" — arrows attach only to box, ellipse, text, icon or other shapes`
          );
        }
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    diagram:
      envelope.data.name === undefined
        ? { shapes }
        : { name: envelope.data.name, shapes },
  };
}
