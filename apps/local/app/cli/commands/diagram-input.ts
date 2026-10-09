import {
  applySimpleDiagram,
  parseSimpleDiagram,
  SCENE_SCHEMA,
  type Scene,
} from "@cvm/core/lib/simple-diagram/index";
import { hashScene } from "@/lib/scene-hash";

/**
 * What `cvm diagram create --file` reads: ONE drawing,
 *   { "name"?: string, "shapes": [...] }
 * or a BATCH of them, oldest first,
 *   { "name"?: string, "snapshots": [{ "shapes": [...] }, ...] }
 * Either way the result is the Diagram's name and one scene per snapshot, in
 * order — or every problem at once, each naming the snapshot it is in.
 */
export type CreateInput =
  | { ok: true; name: string | undefined; scenes: unknown[] }
  | { ok: false; errors: string[] };

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const SHAPE_OF_THE_FILE =
  'expected { "name"?, "shapes": [...] } or { "name"?, "snapshots": [{ "shapes": [...] }, ...] }';

/**
 * One drawing -> its scene, or its errors with `where` in front. With an
 * `onto` scene the drawing is applied onto a copy of it (see
 * `applySimpleDiagram`); `onto` itself is never changed.
 */
const toScene = (
  raw: unknown,
  icons: ReadonlySet<string>,
  where: string,
  onto: Scene | null = null
): { ok: true; scene: unknown } | { ok: false; errors: string[] } => {
  const parsed = parseSimpleDiagram(raw, icons);
  if (!parsed.ok) {
    return { ok: false, errors: parsed.errors.map((e) => `${where}${e}`) };
  }
  const applied = applySimpleDiagram(onto, parsed.diagram);
  if (!applied.ok) {
    return { ok: false, errors: applied.errors.map((e) => `${where}${e}`) };
  }
  return { ok: true, scene: applied.scene };
};

/**
 * Where the first NUL character (\u0000) in `value` is, or null. Postgres
 * stores neither text nor jsonb with one in, so the file is refused before any
 * write rather than failing half-way through one.
 */
const findNul = (value: unknown, path: string): string | null => {
  if (typeof value === "string") return value.includes("\u0000") ? path : null;
  if (value === null || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    if (key.includes("\u0000")) return path;
    const found = findNul(
      child,
      Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`
    );
    if (found !== null) return found;
  }
  return null;
};

const nulError = (json: unknown, root: string): string[] => {
  const at = findNul(json, root);
  return at === null
    ? []
    : [
        `${at}: contains a NUL character (\\u0000), which a Diagram cannot store — remove it`,
      ];
};

export const parseCreateInput = (
  json: unknown,
  icons: ReadonlySet<string>
): CreateInput => {
  const nul = nulError(json, "diagram");
  if (nul.length > 0) return { ok: false, errors: nul };
  if (!isObject(json) || !("snapshots" in json)) {
    const one = toScene(json, icons, "");
    if (!one.ok) return one;
    return {
      ok: true,
      name: (json as { name?: string }).name,
      scenes: [one.scene],
    };
  }

  const errors: string[] = [];
  for (const key of Object.keys(json)) {
    if (key === "shapes") {
      errors.push(
        'diagram: give "shapes" (one snapshot) or "snapshots" (a batch), not both'
      );
    } else if (key !== "name" && key !== "snapshots") {
      errors.push(`diagram: unknown field "${key}" — ${SHAPE_OF_THE_FILE}`);
    }
  }
  if (json.name !== undefined && typeof json.name !== "string") {
    errors.push("diagram.name: must be a string");
  }
  const batch = json.snapshots;
  if (!Array.isArray(batch) || batch.length === 0) {
    errors.push(
      'diagram.snapshots: must be a list of at least one { "shapes": [...] }'
    );
    return { ok: false, errors };
  }

  const scenes: unknown[] = [];
  const seen = new Map<string, number>();
  batch.forEach((raw, index) => {
    const where = `snapshots[${index}]`;
    if (isObject(raw) && "name" in raw) {
      errors.push(
        `${where}: a snapshot has no "name" — name the Diagram at the top of the file`
      );
      return;
    }
    const one = toScene(raw, icons, `${where}: `);
    if (!one.ok) {
      errors.push(...one.errors);
      return;
    }
    const hash = hashScene(one.scene);
    const earlier = seen.get(hash);
    if (earlier !== undefined) {
      errors.push(
        `${where}: draws exactly what snapshots[${earlier}] draws — every snapshot must differ`
      );
      return;
    }
    seen.set(hash, index);
    scenes.push(one.scene);
  });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, name: json.name as string | undefined, scenes };
};

/** A Diagram's stored head as a scene to apply onto; no head (or none yet) is null. */
const asScene = (head: unknown): Scene | null => {
  if (!isObject(head) || !isObject(head.store)) return null;
  return {
    store: head.store as Scene["store"],
    schema: head.schema ?? SCENE_SCHEMA,
  };
};

/**
 * What `cvm diagram snapshot add --file` reads: ONE drawing, `{ "shapes": [...] }`.
 * A snapshot has no name of its own (the Diagram has one), and one drawing is
 * added at a time.
 *
 * The drawing is applied ONTO the Diagram's current `head` scene, matched by
 * id: a listed shape keeps every property the format cannot say (icon size,
 * font, wrapping width, stroke size, opacity, a dragged arrow anchor…), a
 * shape left out is removed, a new id is built in Matt's defaults, and an
 * `other` shape — one the format cannot say — is kept as it is. So `get` ->
 * change one thing -> `snapshot add` changes only that thing.
 */
export const parseSnapshotInput = (
  json: unknown,
  icons: ReadonlySet<string>,
  head: unknown
): { ok: true; scene: unknown } | { ok: false; errors: string[] } => {
  if (isObject(json) && ("name" in json || "snapshots" in json)) {
    return {
      ok: false,
      errors: [
        'snapshot: expected { "shapes": [...] } — a snapshot has no "name", and \'snapshot add\' adds ONE drawing (no "snapshots")',
      ],
    };
  }
  const nul = nulError(json, "snapshot");
  if (nul.length > 0) return { ok: false, errors: nul };
  return toScene(json, icons, "", asScene(head));
};
