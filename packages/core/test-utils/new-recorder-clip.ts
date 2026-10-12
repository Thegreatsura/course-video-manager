import { eq } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { clipRecordingSessionRelation } from "../services/clip-recording-session-relation.js";
import type { TestDb } from "./pglite.js";

/**
 * A new-recorder Clip on `videoId`: a Recording Session with a two-event
 * scene timeline, and a Clip cut from it carrying a Scene Override. For the
 * copy tests (Video copy, Course duplicate, new Draft), which each check the
 * copy draws the same picture.
 */
export async function seedNewRecorderClip(testDb: TestDb, videoId: string) {
  const [session] = await testDb
    .insert(schema.recordingSessions)
    .values({
      videoId,
      cameraFilePath: "/rec/s1/camera.mkv",
      screenFilePath: "/rec/s1/screen.mkv",
      micFilePath: "/rec/s1/mic.mkv",
      status: "stopped",
    })
    .returning();
  await testDb.insert(schema.recordingSessionSceneEvents).values([
    { recordingSessionId: session!.id, fileTime: 0, scene: "Camera" },
    { recordingSessionId: session!.id, fileTime: 3, scene: "Code" },
  ]);
  const [clip] = await testDb
    .insert(schema.clips)
    .values({
      videoId,
      videoFilename: "/rec/s1/mic.mkv",
      sourceStartTime: 1,
      sourceEndTime: 5,
      order: "a0",
      text: "new recorder",
      recordingSessionId: session!.id,
      scene: "Camera",
      sceneOverride: "No Face",
    })
    .returning();
  return { session: session!, clip: clip! };
}

/**
 * What a Video's live Clips are drawn from: each Clip's range, Recording
 * Session and Scene Override, and the session's scene timeline. A copy draws
 * the same picture exactly when these match.
 */
export async function effectiveScenesOf(testDb: TestDb, videoId: string) {
  const clips = await testDb.query.clips.findMany({
    where: (c, { and }) => and(eq(c.videoId, videoId), eq(c.archived, false)),
    columns: {
      sourceStartTime: true,
      sourceEndTime: true,
      recordingSessionId: true,
      sceneOverride: true,
    },
    with: { recordingSession: clipRecordingSessionRelation },
  });
  return clips.filter((c) => c.recordingSessionId !== null);
}

/** How many Recording Sessions and scene events exist: shared, never copied. */
export async function recordingSessionRowCounts(testDb: TestDb) {
  return {
    sessions: (await testDb.query.recordingSessions.findMany()).length,
    sceneEvents: (await testDb.query.recordingSessionSceneEvents.findMany())
      .length,
  };
}
