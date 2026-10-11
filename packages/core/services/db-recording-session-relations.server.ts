import { asc, inArray } from "drizzle-orm";
import { recordingSessionSceneEvents } from "../db/schema.js";
import type { RecordingSessionScene } from "../features/videos/recorder.js";
import { clipRecordingSessionRelation } from "./clip-recording-session-relation.js";
import type { Database } from "./drizzle-service.server.js";

/**
 * `clipRecordingSessionRelation` without its scene events, for a query
 * nested so deep that one more level's alias would pass Postgres's 63-byte
 * identifier limit and collide (`getCourseWithSlimClipsById`). Its caller
 * adds them with {@link loadSceneEvents}.
 */
export const recordingSessionExportColumns = {
  columns: clipRecordingSessionRelation.columns,
} as const;

type SceneEventRow = { fileTime: number; scene: RecordingSessionScene };

/**
 * Load the scene events of every Recording Session in `sessionIds` in one
 * query (in `fileTime` order, as `clipRecordingSessionRelation` reads them),
 * and return a function that gives a session row its events.
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
          orderBy: asc(recordingSessionSceneEvents.fileTime),
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
