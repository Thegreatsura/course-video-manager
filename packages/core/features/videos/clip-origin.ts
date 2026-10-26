/**
 * A Clip Origin: how a Clip came to exist (`clip.origin`).
 *
 * - `video-editor` — filmed or cut in the app: the CVM recorder, an OBS
 *   import, the editor UI. The default, and what every Clip from before
 *   Clip Origin existed holds.
 * - `cli` — created by the `cvm` CLI (`cvm clip add`): a Clip built from
 *   Footage that was already filmed, so it is not new filming.
 *
 * Only `video-editor` Clips count in the footage stats. A copy of a Clip (a
 * Submit's new Draft, a duplicated Course or Video, a Video made from a
 * selection) carries its original's Clip Origin, as it carries `createdAt`.
 *
 * Not to be confused with the `clip-source` package, which answers where a
 * Clip's picture and sound come from.
 */
export const CLIP_ORIGINS = ["video-editor", "cli"] as const;

export type ClipOrigin = (typeof CLIP_ORIGINS)[number];
