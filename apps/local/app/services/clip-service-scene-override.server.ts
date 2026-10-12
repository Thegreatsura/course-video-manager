import { clips } from "@/db/schema";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { canZoomClip } from "@/features/videos/clip-zoom";
import { effectiveClipScene } from "@cvm/core/features/videos/effective-scene";
import type { RecordingSessionScene } from "@cvm/core/features/videos/recorder";
import type { Database } from "@/services/drizzle-service.server";
import {
  type LoggerAdapter,
  dbCall,
  touchVideoUpdatedAt,
} from "./clip-service-handler.helpers";

export const OBS_CLIP_SCENE_OVERRIDE_MESSAGE =
  "An OBS Clip cannot have a Scene Override: its scene is baked into its Footage.";

/**
 * Set (or, with null, clear) a New-recorder Clip's Scene Override.
 *
 * A Clip Zoom is legal only on a camera scene, judged on the effective scene.
 * An override that leaves the Clip off a camera scene drops its zoom in the
 * same write, so the stored Clip never carries a zoom the rule forbids.
 */
export const updateSceneOverride = (
  db: Database,
  logger: LoggerAdapter,
  event: { clipId: string; sceneOverride: RecordingSessionScene | null }
) =>
  Effect.gen(function* () {
    const clip = yield* dbCall(() =>
      db.query.clips.findFirst({ where: eq(clips.id, event.clipId) })
    );
    if (!clip) {
      throw new Error(`Clip not found: ${event.clipId}`);
    }
    if (!clip.recordingSessionId) {
      throw new Error(OBS_CLIP_SCENE_OVERRIDE_MESSAGE);
    }

    const scene = effectiveClipScene({
      scene: clip.scene,
      sceneOverride: event.sceneOverride,
    });
    const zoomType = canZoomClip(scene) ? clip.zoomType : "none";

    yield* dbCall(() =>
      db
        .update(clips)
        .set({ sceneOverride: event.sceneOverride, zoomType })
        .where(eq(clips.id, event.clipId))
    );

    yield* touchVideoUpdatedAt(db, clip.videoId);
    logger.log(clip.videoId, {
      type: "scene-override-updated",
      clipId: event.clipId,
      sceneOverride: event.sceneOverride,
    });
  });
