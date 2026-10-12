import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import {
  setupClipServiceTests,
  clipService,
  testDb,
} from "./clip-service-test-setup";

setupClipServiceTests();

/**
 * A Video whose only Clip is an archived CVM-recorder Clip, then switched to
 * OBS (allowed: every Clip is archived, so it has no Footage).
 */
const seedSwitchedVideo = async () => {
  const video = await clipService.createVideo("switched");
  await testDb
    .update(schema.videos)
    .set({ recorder: "cvm" })
    .where(eq(schema.videos.id, video.id));
  const [session] = await testDb
    .insert(schema.recordingSessions)
    .values({
      videoId: video.id,
      cameraFilePath: "/rec/camera.mkv",
      screenFilePath: "/rec/screen.mkv",
      micFilePath: "/rec/mic.mkv",
      status: "stopped",
    })
    .returning();
  const insertClip = async (recordingSessionId: string | null) => {
    const [clip] = await testDb
      .insert(schema.clips)
      .values({
        videoId: video.id,
        videoFilename: "/rec/mic.mkv",
        sourceStartTime: 0,
        sourceEndTime: 5,
        order: "a0",
        text: "",
        archived: true,
        recordingSessionId,
      })
      .returning();
    return clip!;
  };
  const cvmRecorderClip = await insertClip(session!.id);
  await testDb
    .update(schema.videos)
    .set({ recorder: "obs" })
    .where(eq(schema.videos.id, video.id));
  const obsClip = await insertClip(null);
  return { cvmRecorderClip, obsClip };
};

const isArchived = async (id: string) =>
  (await testDb.query.clips.findFirst({ where: eq(schema.clips.id, id) }))!
    .archived;

describe("restoring archived Clips across a Recorder switch", () => {
  it("refuses to restore a Clip from the other Recorder, and restores none of the batch", async () => {
    const { cvmRecorderClip, obsClip } = await seedSwitchedVideo();
    await expect(
      clipService.unarchiveClips([obsClip.id, cvmRecorderClip.id])
    ).rejects.toThrow(/Recorder/);
    expect(await isArchived(cvmRecorderClip.id)).toBe(true);
    expect(await isArchived(obsClip.id)).toBe(true);
  });

  it("restores a Clip from the Video's own Recorder", async () => {
    const { obsClip } = await seedSwitchedVideo();
    await clipService.unarchiveClips([obsClip.id]);
    expect(await isArchived(obsClip.id)).toBe(false);
  });
});
