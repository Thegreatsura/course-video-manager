import type { OBSWebSocket } from "obs-websocket-js";

/**
 * The OBS profile the editor keeps OBS on. Only a Landscape Video records
 * with OBS: a Short records with the CVM recorder only (ADR 0037), so the
 * editor never switches OBS to a portrait profile.
 */
export const OBS_PROFILE_LANDSCAPE = "Landscape Recording";

export type EnsureProfileResult =
  | { type: "already-active" }
  | { type: "switched" }
  | { type: "error"; message: string };

export async function ensureOBSProfile(
  websocket: OBSWebSocket,
  targetProfile: string
): Promise<EnsureProfileResult> {
  const profileList = await websocket.call("GetProfileList");

  if (profileList.currentProfileName === targetProfile) {
    return { type: "already-active" };
  }

  if (!profileList.profiles.includes(targetProfile)) {
    return {
      type: "error",
      message: `OBS profile "${targetProfile}" not found. Available profiles: ${profileList.profiles.join(", ")}. Create the profile in OBS manually.`,
    };
  }

  await websocket.call("StopVirtualCam");
  await websocket.call("SetCurrentProfile", { profileName: targetProfile });
  await websocket.call("StartVirtualCam");

  return { type: "switched" };
}
