/**
 * Pure string transformation functions for ChooseScreenshot message mutation.
 * These operate on the raw message text to replace or update ChooseScreenshot tags.
 */

import type { ScreenCrop } from "@/packages/clip-source";

/**
 * What a screenshot of a CVM-recorder Clip shows: "none" (No face, the
 * default) is its screen frame alone; "diagram" (Diagram) is that frame cut
 * to the Diagram Frame; "with" (With face) is the composite the export
 * draws; "custom" (Custom) is the screen frame cut to the author's own crop
 * box. Saved on the placeholder as `face="with"`, `face="diagram"` or
 * `face="custom" crop="x,y,w,h"` (fractions of the screen frame); a tag
 * without the attribute is No face. An OBS Clip ignores it: its face is
 * baked in.
 */
export type ScreenshotFace = "none" | "with" | "diagram" | "custom";

/** A Custom crop as its tag's `crop` attribute. */
const writeCrop = (crop: ScreenCrop) =>
  [crop.x, crop.y, crop.w, crop.h].map((n) => +n.toFixed(4)).join(",");

/**
 * The Custom crop a placeholder's `crop` attribute saves, or null when it is
 * absent or not four fractions with some size.
 */
export function parseScreenshotCrop(attr: unknown): ScreenCrop | null {
  if (typeof attr !== "string") return null;
  const parts = attr.split(",").map(Number);
  if (parts.length !== 4) return null;
  if (!parts.every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) return null;
  const [x, y, w, h] = parts as [number, number, number, number];
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

/** The whole screen frame, as a crop. */
export const FULL_FRAME: ScreenCrop = { x: 0, y: 0, w: 1, h: 1 };

/** A tag's optional face, then its optional Custom crop. */
const FACE_ATTRS = String.raw`(?:\s+face="(with|none|diagram|custom)")?(?:\s+crop="([^"]*)")?`;

/**
 * One placeholder, found by its clipIndex and alt text (which identify it when
 * several share a message), with its saved face in group 1 and its Custom
 * crop in group 2.
 */
const tagPattern = (clipIndex: number, alt: string, trailing = "") =>
  new RegExp(
    `<ChooseScreenshot\\s+clipIndex=\\{${clipIndex}\\}\\s+alt="${escapeRegex(alt)}"${FACE_ATTRS}\\s*/>${trailing}`,
    "g"
  );

/**
 * A placeholder's tag. `crop` is written only with Custom, which always has
 * one (the whole frame when none is given).
 */
export const writeChooseScreenshotTag = (
  clipIndex: number,
  alt: string,
  face: ScreenshotFace,
  crop?: ScreenCrop | null
) => {
  const faceAttr = face === "none" ? "" : ` face="${face}"`;
  const cropAttr =
    face === "custom" ? ` crop="${writeCrop(crop ?? FULL_FRAME)}"` : "";
  return `<ChooseScreenshot clipIndex={${clipIndex}} alt="${alt}"${faceAttr}${cropAttr} />`;
};

/** The face a placeholder's `face` attribute saves (absent: No face). */
export function parseScreenshotFace(attr: unknown): ScreenshotFace {
  return attr === "with" || attr === "diagram" || attr === "custom"
    ? attr
    : "none";
}

/**
 * Replace a specific ChooseScreenshot tag with a markdown image link.
 * Matches by clipIndex and alt text to identify the correct tag when
 * multiple exist in the same message.
 */
export function replaceChooseScreenshotWithImage(
  message: string,
  clipIndex: number,
  alt: string,
  imagePath: string
): string {
  return message.replace(tagPattern(clipIndex, alt), `![${alt}](${imagePath})`);
}

/**
 * Update the clipIndex in a specific ChooseScreenshot tag, keeping its face.
 * Identifies the tag by its current clipIndex and alt text.
 */
export function updateChooseScreenshotClipIndex(
  message: string,
  currentClipIndex: number,
  newClipIndex: number,
  alt: string
): string {
  return message.replace(
    tagPattern(currentClipIndex, alt),
    (_match, face: string | undefined, crop: string | undefined) =>
      writeChooseScreenshotTag(
        newClipIndex,
        alt,
        parseScreenshotFace(face),
        parseScreenshotCrop(crop)
      )
  );
}

/**
 * Save a placeholder's face on its tag, and with Custom its crop: `crop` is
 * dropped for every other face.
 */
export function setChooseScreenshotFace(
  message: string,
  clipIndex: number,
  alt: string,
  face: ScreenshotFace,
  crop?: ScreenCrop | null
): string {
  return message.replace(tagPattern(clipIndex, alt), () =>
    writeChooseScreenshotTag(clipIndex, alt, face, crop)
  );
}

/**
 * Check if a message contains any unresolved ChooseScreenshot tags.
 * Uses a fresh regex (no /g flag) to avoid stateful lastIndex issues.
 */
export function hasUnresolvedScreenshots(message: string): boolean {
  return new RegExp(
    `<ChooseScreenshot\\s+clipIndex=\\{\\d+\\}\\s+alt="[^"]*"${FACE_ATTRS}\\s*/>`
  ).test(message);
}

/**
 * Remove a specific ChooseScreenshot tag and up to two trailing newlines.
 * Matches by clipIndex and alt text.
 */
export function removeChooseScreenshot(
  message: string,
  clipIndex: number,
  alt: string
): string {
  return message.replace(tagPattern(clipIndex, alt, "\n{0,2}"), "");
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
