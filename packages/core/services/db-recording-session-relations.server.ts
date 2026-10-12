import { asc, inArray } from "drizzle-orm";
import { micEqSettings, recordingSessionSceneEvents } from "../db/schema.js";
import type {
  MicEq,
  RecordingSessionScene,
} from "../features/videos/recorder.js";
import { clipRecordingSessionRelation } from "./clip-recording-session-relation.js";
import type { Database } from "./drizzle-service.server.js";

/**
 * `clipRecordingSessionRelation` without its scene events and mic EQ, for a
 * query nested so deep that one more level's alias would pass Postgres's
 * 63-byte identifier limit and collide (`getCourseWithSlimClipsById`). Its
 * caller adds them with {@link loadRecordingSessionRelations}.
 */
export const recordingSessionExportColumns = {
  columns: { ...clipRecordingSessionRelation.columns, micEqSettingId: true },
} as const;

type SceneEventRow = { fileTime: number; scene: RecordingSessionScene };

/**
 * Load the scene events (in `fileTime` order, as
 * `clipRecordingSessionRelation` reads them) and the saved mic EQ of every
 * Recording Session in `sessions`, one query each, and return a function that
 * gives a session row both — the shape `clipRecordingSessionRelation` loads.
 */
export const loadRecordingSessionRelations = async (
  db: Database,
  sessions: readonly { id: string; micEqSettingId: string }[]
) => {
  const ids = [...new Set(sessions.map((s) => s.id))];
  const eqIds = [...new Set(sessions.map((s) => s.micEqSettingId))];
  const rows =
    ids.length === 0
      ? []
      : await db.query.recordingSessionSceneEvents.findMany({
          where: inArray(recordingSessionSceneEvents.recordingSessionId, ids),
          columns: { recordingSessionId: true, fileTime: true, scene: true },
          orderBy: asc(recordingSessionSceneEvents.fileTime),
        });
  const eqRows =
    eqIds.length === 0
      ? []
      : await db.query.micEqSettings.findMany({
          where: inArray(micEqSettings.id, eqIds),
        });
  const byId = new Map<string, SceneEventRow[]>();
  for (const { recordingSessionId, ...event } of rows) {
    byId.set(recordingSessionId, [
      ...(byId.get(recordingSessionId) ?? []),
      event,
    ]);
  }
  const eqById = new Map<string, MicEq>(
    eqRows.map(({ id, ...micEq }) => [id, micEq])
  );
  return <T extends { id: string; micEqSettingId: string }>(
    session: T | null
  ) =>
    session && {
      ...session,
      sceneEvents: byId.get(session.id) ?? [],
      micEq: eqById.get(session.micEqSettingId) ?? null,
    };
};
