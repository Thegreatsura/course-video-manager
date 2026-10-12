import { SCENES, type Scene } from "@/packages/scene-layout";

const NO_OVERRIDE = "none";

/**
 * The URL of a saved Clip's first- or last-frame still. A CVM-recorder Clip's
 * URL names the Scene Override to draw it in (or `none`), so the picture is
 * fixed by the URL, not by whether the override's save has landed yet: the
 * browser fetches the new still the moment the override changes, and a cached
 * one is never shown for the wrong scene. An OBS Clip's URL is unchanged.
 */
export const clipStillUrl = (
  clip: {
    databaseId: string;
    recordingSession?: unknown;
    sceneOverride?: Scene | null;
  },
  which: "first" | "last"
): string => {
  const url = `/clips/${clip.databaseId}/${which}-frame`;
  if (!clip.recordingSession) return url;
  return `${url}?override=${encodeURIComponent(clip.sceneOverride ?? NO_OVERRIDE)}`;
};

/**
 * The Scene Override a still route draws in: the one its URL names, else the
 * Clip's stored one.
 */
export const stillSceneOverride = (
  requestUrl: string,
  stored: Scene | null
): Scene | null => {
  const named = new URL(requestUrl).searchParams.get("override");
  if (named === NO_OVERRIDE) return null;
  return SCENES.find((scene) => scene === named) ?? stored;
};
