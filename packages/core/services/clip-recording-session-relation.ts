import { asc } from "drizzle-orm";
import { recordingSessionSceneEvents } from "../db/schema.js";

/**
 * The `recordingSession` relation a Clip is loaded with wherever its picture
 * is shown: a CVM-recorder Clip's Recording Session files, mic offset, mic
 * EQ and scene timeline — what the Clip Source module (`@/packages/clip-source`,
 * `ClipRecordingSession`) composites it from. Null on an OBS Clip.
 *
 * Every query whose Clips are exported or hashed (`toExportClips`) must load
 * it beside `overlayExportRelation` — the type of `toExportClips` insists:
 * without it a CVM-recorder Clip would be addressed and exported as a single
 * file.
 */
export const clipRecordingSessionRelation = {
  columns: {
    id: true,
    cameraFilePath: true,
    screenFilePath: true,
    micFilePath: true,
    micOffsetMs: true,
  },
  with: {
    // The saved mic EQ (null until first saved: DEFAULT_MIC_EQ). It is part
    // of every CVM-recorder Clip's Export Hash, so it rides along here.
    micEq: { columns: { lowDb: true, midDb: true, highDb: true } },
    sceneEvents: {
      columns: { fileTime: true, scene: true },
      orderBy: asc(recordingSessionSceneEvents.fileTime),
    },
  },
} as const;
