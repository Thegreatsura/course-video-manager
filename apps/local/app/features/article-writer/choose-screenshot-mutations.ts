/**
 * Pure string transformation functions for ChooseScreenshot message mutation.
 * These operate on the raw message text to replace or update ChooseScreenshot tags.
 */

/**
 * Whether a screenshot shows Matt's face: "none" (No face, the default) is a
 * CVM-recorder Clip's screen frame alone; "with" (With face) is the composite
 * the export draws. Saved on the placeholder as `face="with"`; a tag without
 * the attribute is No face. An OBS Clip ignores it: its face is baked in.
 */
export type ScreenshotFace = "none" | "with";

/**
 * One placeholder, found by its clipIndex and alt text (which identify it when
 * several share a message), with its saved face in group 1.
 */
const tagPattern = (clipIndex: number, alt: string, trailing = "") =>
  new RegExp(
    `<ChooseScreenshot\\s+clipIndex=\\{${clipIndex}\\}\\s+alt="${escapeRegex(alt)}"(?:\\s+face="(with|none)")?\\s*/>${trailing}`,
    "g"
  );

const writeTag = (clipIndex: number, alt: string, face: ScreenshotFace) =>
  `<ChooseScreenshot clipIndex={${clipIndex}} alt="${alt}"${face === "with" ? ' face="with"' : ""} />`;

/** The face a placeholder's `face` attribute saves (absent: No face). */
export function parseScreenshotFace(attr: unknown): ScreenshotFace {
  return attr === "with" ? "with" : "none";
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
    (_match, face: string | undefined) =>
      writeTag(newClipIndex, alt, parseScreenshotFace(face))
  );
}

/** Save a placeholder's face (No face or With face) on its tag. */
export function setChooseScreenshotFace(
  message: string,
  clipIndex: number,
  alt: string,
  face: ScreenshotFace
): string {
  return message.replace(tagPattern(clipIndex, alt), () =>
    writeTag(clipIndex, alt, face)
  );
}

/**
 * Check if a message contains any unresolved ChooseScreenshot tags.
 * Uses a fresh regex (no /g flag) to avoid stateful lastIndex issues.
 */
export function hasUnresolvedScreenshots(message: string): boolean {
  return /<ChooseScreenshot\s+clipIndex=\{(\d+)\}\s+alt="([^"]*)"(?:\s+face="(with|none)")?\s*\/>/.test(
    message
  );
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
