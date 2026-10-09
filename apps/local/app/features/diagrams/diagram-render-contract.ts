/**
 * What the Clip Mockup daemon's Chromium and the app's render page agree on
 * when `cvm diagram create` turns a scene into a PNG.
 *
 * The page (`routes/diagram-render.tsx`) mounts a real tldraw editor with
 * CVM_SHAPE_UTILS and puts one function on `window`. The daemon opens the
 * page on the running app, waits for the function, hands it the scene and
 * writes the base64 PNG it gets back. Rendering needs the app because tldraw
 * only draws with a DOM, its fonts and its React shape components — there is
 * no Node renderer.
 *
 * Kept free of imports so both sides (Node and the browser) can take it.
 */

/** The app path of the render page. */
export const DIAGRAM_RENDER_PATH = "/diagram-render";

/** The name of the function the render page puts on `window`. */
export const DIAGRAM_RENDER_GLOBAL = "__cvmRenderDiagram";

/** What the page's function answers. A failure names what went wrong. */
export type DiagramRenderResult =
  | { readonly ok: true; readonly pngBase64: string }
  | { readonly ok: false; readonly message: string };

/** The page's function: a scene (a Diagram's head) in, a PNG out. */
export type DiagramRenderFunction = (
  scene: unknown
) => Promise<DiagramRenderResult>;
