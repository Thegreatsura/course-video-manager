import { inArray } from "drizzle-orm";
import { recordingSessionSceneEvents } from "../db/schema.js";
import type { RecordingSessionScene } from "../features/videos/recorder.js";
import type { Database } from "./drizzle-service.server.js";

/**
 * The Recording Session fields a new-recorder Clip's Export Hash and export
 * composite are derived from, as a relational-query fragment:
 * `with: { clips: { with: { recordingSession: recordingSessionExportRelation } } }`.
 *
 * Every query whose Clips end up in `toExportClips` must include it beside
 * `overlayExportRelation` (the type of `toExportClips` insists): without it a
 * new-recorder Clip would be addressed and exported as a single file.
 */
export const recordingSessionExportRelation = {
  columns: {
    id: true,
    cameraFilePath: true,
    screenFilePath: true,
    micFilePath: true,
    micOffsetMs: true,
  },
  with: {
    sceneEvents: { columns: { fileTime: true, scene: true } },
  },
} as const;

/**
 * `recordingSessionExportRelation` without its scene events, for a query
 * nested so deep that one more level's alias would pass Postgres's 63-byte
 * identifier limit and collide (`getCourseWithSlimClipsById`). Its caller
 * adds them with {@link withSceneEvents}.
 */
export const recordingSessionExportColumns = {
  columns: recordingSessionExportRelation.columns,
} as const;

type SceneEventRow = { fileTime: number; scene: RecordingSessionScene };

/**
 * Load the scene events of every Recording Session in `sessionIds` in one
 * query, and return a function that gives a session row its events.
 */
export const loadSceneEvents = async (
  db: Database,
  sessionIds: readonly string[]
) => {
  const ids = [...new Set(sessionIds)];
  const rows =
    ids.length === 0
      ? []
      : await db.query.recordingSessionSceneEvents.findMany({
          where: inArray(recordingSessionSceneEvents.recordingSessionId, ids),
          columns: { recordingSessionId: true, fileTime: true, scene: true },
        });
  const byId = new Map<string, SceneEventRow[]>();
  for (const { recordingSessionId, ...event } of rows) {
    byId.set(recordingSessionId, [
      ...(byId.get(recordingSessionId) ?? []),
      event,
    ]);
  }
  return <T extends { id: string }>(session: T | null) =>
    session && { ...session, sceneEvents: byId.get(session.id) ?? [] };
};
