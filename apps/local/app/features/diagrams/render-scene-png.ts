import { loadSnapshot, type Editor, type TLStoreSnapshot } from "tldraw";
import type { DiagramRenderResult } from "./diagram-render-contract";

/**
 * How an agent's render of a Diagram looks: light mode on a white background.
 *
 * Unlike the playground's snapshot thumbnails (dark, transparent — made to sit
 * on the dark app), this image is LOOKED AT by an agent checking its own
 * drawing, and black strokes on a transparent background read as nothing.
 */
export const AGENT_RENDER_OPTIONS = {
  format: "png",
  background: true,
  darkMode: false,
  padding: 32,
} as const;

const blobToBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/**
 * Load `scene` (a Diagram's head) into `editor`, replacing what it held, and
 * render every shape on the page as a PNG. A scene tldraw refuses comes back
 * as `ok: false` with tldraw's own reason, never a throw.
 */
export async function renderScenePng(
  editor: Editor,
  scene: unknown
): Promise<DiagramRenderResult> {
  try {
    loadSnapshot(editor.store, { document: scene as TLStoreSnapshot });
    const ids = Array.from(editor.getCurrentPageShapeIds());
    if (ids.length === 0) {
      return { ok: false, message: "the Diagram has no shapes to draw" };
    }
    // tldraw measures and draws text with the fonts it has: load every font
    // the page uses first, or the PNG shows the fallback face.
    await editor.fonts.loadRequiredFontsForCurrentPage();
    const { blob } = await editor.toImage(ids, AGENT_RENDER_OPTIONS);
    return { ok: true, pngBase64: await blobToBase64(blob) };
  } catch (error) {
    return {
      ok: false,
      message: `tldraw could not draw the scene: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
