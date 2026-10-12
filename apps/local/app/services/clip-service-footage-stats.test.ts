import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { clips } from "@/db/schema";

import {
  setupClipServiceTests,
  clipService,
  testDb,
  start,
} from "./clip-service-test-setup";

setupClipServiceTests();

const LONDON = "Europe/London";

/**
 * Films `seconds` of Footage from `file` onto a fresh standalone Video, with
 * the Clip made at `createdAt`.
 */
const film = async (
  file: string,
  createdAt: string,
  seconds: number,
  extra: { videoId?: string; startTime?: number; transcribedAt?: string } = {}
) => {
  const videoId = extra.videoId ?? (await clipService.createVideo("Video")).id;
  const startTime = extra.startTime ?? 0;
  const [clip] = await clipService.appendClips({
    videoId,
    insertionPoint: start,
    items: [],
    clips: [{ inputVideo: file, startTime, endTime: startTime + seconds }],
  });
  await testDb
    .update(clips)
    .set({
      createdAt: new Date(createdAt),
      transcribedAt: extra.transcribedAt ? new Date(extra.transcribedAt) : null,
    })
    .where(eq(clips.id, clip!.id));
  return { clip: clip!, videoId };
};

const stats = (now: string, timeZone = LONDON) =>
  clipService.getFootageStats({ now: new Date(now), timeZone });

describe("ClipService.getFootageStats", () => {
  it("is zero with no Footage", async () => {
    expect(await stats("2026-10-12T09:00:00Z")).toEqual({
      todaySeconds: 0,
      last7DaysSeconds: 0,
      last30DaysSeconds: 0,
    });
  });

  it("starts today at local midnight and each window on a calendar day", async () => {
    // 10:00 BST on Mon 12 Oct. Local midnight is 23:00 UTC the day before.
    const now = "2026-10-12T09:00:00Z";
    await film("today-first-second.mp4", "2026-10-11T23:00:00Z", 60);
    await film("yesterday-last-second.mp4", "2026-10-11T22:59:59Z", 120);
    // 7D starts at local midnight on Tue 6 Oct.
    await film("7d-first-second.mp4", "2026-10-05T23:00:00Z", 240);
    await film("8d-last-second.mp4", "2026-10-05T22:59:59Z", 480);
    // 30D starts at local midnight on Sun 13 Sep.
    await film("30d-first-second.mp4", "2026-09-12T23:00:00Z", 960);
    await film("31d-last-second.mp4", "2026-09-12T22:59:59Z", 1920);

    expect(await stats(now)).toEqual({
      todaySeconds: 60,
      last7DaysSeconds: 60 + 120 + 240,
      last30DaysSeconds: 60 + 120 + 240 + 480 + 960,
    });
  });

  it("puts the day start in the given time zone", async () => {
    // 23:30 UTC on 11 Oct is 00:30 on 12 Oct in London (BST).
    await film("after-london-midnight.mp4", "2026-10-11T23:30:00Z", 90);

    expect((await stats("2026-10-12T09:00:00Z", LONDON)).todaySeconds).toBe(90);
    expect((await stats("2026-10-12T09:00:00Z", "UTC")).todaySeconds).toBe(0);
  });

  it("counts calendar days across a clock change, not 24-hour blocks", async () => {
    // Thu 29 Oct (GMT) at noon; the clocks went back on Sun 25 Oct. 7D starts
    // at midnight on Fri 23 Oct, which was BST: 23:00 UTC on the 22nd.
    const now = "2026-10-29T12:00:00Z";
    await film("bst-midnight.mp4", "2026-10-22T23:30:00Z", 30);

    expect((await stats(now)).last7DaysSeconds).toBe(30);
  });

  it("leaves out archived Clips and Effect Clips", async () => {
    const now = "2026-10-12T09:00:00Z";
    const { videoId, clip: live } = await film(
      "take.mp4",
      "2026-10-12T08:00:00Z",
      100
    );
    const { clip: archived } = await film(
      "take.mp4",
      "2026-10-12T08:00:00Z",
      50,
      { videoId, startTime: 100 }
    );
    await clipService.archiveClips([archived.id]);
    const effectClip = await clipService.createEffectClipAtPosition({
      videoId,
      position: "after",
      targetItemId: live.id,
      targetItemType: "clip",
      videoFilename: "/repo/assets/effects/white-noise.mp4",
      sourceStartTime: 0,
      sourceEndTime: 0.5,
      text: "*white noise*",
      scene: "white noise",
      profile: "main-camera",
      pauseType: "none",
    });
    await testDb
      .update(clips)
      .set({ createdAt: new Date("2026-10-12T08:00:00Z") })
      .where(eq(clips.id, effectClip.id));

    expect((await stats(now)).todaySeconds).toBe(100);
  });

  it("dates a copied Clip by its original's transcription and counts it once", async () => {
    const now = "2026-10-12T09:00:00Z";
    // A copy (a Submit's new Draft, a duplicated Course) is a new row made
    // today, carrying its original's transcription time.
    // Filmed 40 days ago, copied today: not filmed in the last 30 days, even
    // after the original row is gone.
    await film("old-take.mp4", "2026-10-12T08:00:00Z", 300, {
      transcribedAt: "2026-09-02T10:05:00Z",
    });
    // Filmed today and copied today: counted once.
    await film("new-take.mp4", "2026-10-12T07:00:00Z", 45, {
      transcribedAt: "2026-10-12T07:01:00Z",
    });
    await film("new-take.mp4", "2026-10-12T08:00:00Z", 45, {
      transcribedAt: "2026-10-12T07:01:00Z",
    });

    expect(await stats(now)).toEqual({
      todaySeconds: 45,
      last7DaysSeconds: 45,
      last30DaysSeconds: 45,
    });
  });
});
