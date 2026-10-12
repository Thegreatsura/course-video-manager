/**
 * A Clip's effective scene: its Scene Override if it has one, else the scene
 * in force when it was recorded (`clips.scene` — for a New-recorder Clip, the
 * scene live at the Clip's start; for an OBS Clip, the scene OBS reported).
 *
 * Every rule judged on "the Clip's scene" — Clip Zoom eligibility, what `cvm`
 * reports — reads this, so an override counts everywhere at once. The picture
 * itself is drawn from the scene segments (`@/packages/clip-source`), which
 * can change mid-Clip; this is the one-word answer.
 */
export const effectiveClipScene = (clip: {
  readonly scene: string | null | undefined;
  readonly sceneOverride?: string | null;
}): string | null => clip.sceneOverride ?? clip.scene ?? null;
