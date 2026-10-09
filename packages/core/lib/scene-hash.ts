import crypto from "node:crypto";

function sortKeysDeep(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

export function canonicalize(scene: unknown): string {
  return JSON.stringify(sortKeysDeep(scene));
}

export function hashScene(scene: unknown): string {
  return crypto.createHash("sha256").update(canonicalize(scene)).digest("hex");
}

/**
 * The content hash of a Diagram's stored head, or `null` for a Diagram that
 * has never been drawn on. Two heads with the same hash hold the same drawing.
 */
export function hashHead(headScene: unknown): string | null {
  return headScene == null ? null : hashScene(headScene);
}
