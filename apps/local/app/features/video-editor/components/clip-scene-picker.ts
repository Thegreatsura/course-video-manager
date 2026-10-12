import { LayoutTemplateIcon } from "lucide-react";
import type { ActionPicker } from "@/features/action-menu/action-menu-model";
import { SCENES, type Scene } from "@/packages/scene-layout";
import type { Clip, FrontendId } from "../clip-state-reducer";

const FOLLOW_LIVE_SCENES = "follow-live-scenes";

/**
 * "Change Scene" on a saved CVM-recorder Clip: a Scene Override (Camera, Code
 * or No Face) draws the whole Clip in that scene; "Follow live scenes" clears
 * it, back to the scenes switched while filming. Absent on an OBS Clip, whose
 * scene is baked into its Footage.
 */
export const clipScenePicker = (
  clip: Clip,
  onSetSceneOverride: (clipId: FrontendId, sceneOverride: Scene | null) => void
): ActionPicker | false =>
  clip.type === "on-database" &&
  !!clip.recordingSession && {
    label: "Change Scene",
    icon: LayoutTemplateIcon,
    value: clip.sceneOverride ?? FOLLOW_LIVE_SCENES,
    onValueChange: (value) =>
      onSetSceneOverride(
        clip.frontendId,
        value === FOLLOW_LIVE_SCENES
          ? null
          : (SCENES.find((scene) => scene === value) ?? null)
      ),
    options: [
      { value: FOLLOW_LIVE_SCENES, label: "Follow live scenes" },
      ...SCENES.map((scene) => ({ value: scene, label: scene })),
    ],
  };
