import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { clipSource, sceneAt } from "@/packages/clip-source";
import { effectiveClipScene } from "@cvm/core/features/videos/effective-scene";
import {
  setupClipServiceTests,
  clipService,
  testDb,
} from "./clip-service-test-setup";

setupClipServiceTests();

/**
 * A New-recorder Clip from 10 s to 20 s of a Recording Session whose scene
 * went Camera at 0 and Code at 15 — a change in the middle of the Clip.
 */
const seedNewRecorderClip = async (opts: { zoomType?: string } = {}) => {
  const video = await clipService.createVideo("override");
  const [session] = await testDb
    .insert(schema.recordingSessions)
    .values({
      videoId: video.id,
      cameraFilePath: "/rec/camera.mkv",
      screenFilePath: "/rec/screen.mkv",
      micFilePath: "/rec/mic.mkv",
    })
    .returning();
  await testDb.insert(schema.recordingSessionSceneEvents).values([
    { id: "e1", recordingSessionId: session!.id, fileTime: 0, scene: "Camera" },
    { id: "e2", recordingSessionId: session!.id, fileTime: 15, scene: "Code" },
  ]);
  const [clip] = await testDb
    .insert(schema.clips)
    .values({
      videoId: video.id,
      videoFilename: session!.micFilePath,
      sourceStartTime: 10,
      sourceEndTime: 20,
      order: "a0",
      text: "",
      scene: "Camera",
      recordingSessionId: session!.id,
      zoomType: opts.zoomType ?? "none",
    })
    .returning();
  return clip!;
};

const readClip = async (id: string) => {
  const clip = await testDb.query.clips.findFirst({
    where: eq(schema.clips.id, id),
    with: {
      recordingSession: {
        with: { sceneEvents: { orderBy: (e, { asc }) => asc(e.fileTime) } },
      },
    },
  });
  return clip!;
};

const scenesDrawn = async (id: string) => {
  const source = clipSource((await readClip(id)) as never);
  return source.kind === "recording-session"
    ? source.segments.map((s) => s.scene)
    : [];
};

describe("Scene Override", () => {
  it("sets an override that draws the whole Clip in one scene, and clearing it follows the live scenes again", async () => {
    const clip = await seedNewRecorderClip();
    expect(await scenesDrawn(clip.id)).toEqual(["Camera", "Code"]);

    await clipService.updateSceneOverride(clip.id, "No Face");
    const overridden = await readClip(clip.id);
    expect(overridden.sceneOverride).toBe("No Face");
    expect(effectiveClipScene(overridden)).toBe("No Face");
    expect(await scenesDrawn(clip.id)).toEqual(["No Face"]);

    await clipService.updateSceneOverride(clip.id, null);
    const cleared = await readClip(clip.id);
    expect(cleared.sceneOverride).toBeNull();
    expect(effectiveClipScene(cleared)).toBe("Camera");
    expect(await scenesDrawn(clip.id)).toEqual(["Camera", "Code"]);
    const source = clipSource(cleared as never);
    expect(
      source.kind === "recording-session" && sceneAt(source.segments, 16)
    ).toBe("Code");
  });

  it("refuses an override on an OBS Clip, whose scene is baked into its Footage", async () => {
    const video = await clipService.createVideo("obs");
    const [clip] = await clipService.appendClips({
      videoId: video.id,
      insertionPoint: { type: "start" },
      items: [],
      clips: [{ inputVideo: "/obs/take.mkv", startTime: 0, endTime: 5 }],
    });

    await expect(
      clipService.updateSceneOverride(clip!.id, "Camera")
    ).rejects.toThrow(/OBS Clip/);
    expect((await readClip(clip!.id)).sceneOverride).toBeNull();
  });
});

describe("Clip Zoom on the effective scene", () => {
  it("allows a zoom on a Code Clip overridden to Camera", async () => {
    const clip = await seedNewRecorderClip();
    await testDb
      .update(schema.clips)
      .set({ scene: "Code" })
      .where(eq(schema.clips.id, clip.id));
    await expect(clipService.updateZoom(clip.id, "subtle")).rejects.toThrow();

    await clipService.updateSceneOverride(clip.id, "Camera");
    await clipService.updateZoom(clip.id, "subtle");

    expect((await readClip(clip.id)).zoomType).toBe("subtle");
  });

  it("drops an existing zoom when an override from Camera to Code makes it illegal", async () => {
    const clip = await seedNewRecorderClip({ zoomType: "subtle" });

    await clipService.updateSceneOverride(clip.id, "Code");

    expect((await readClip(clip.id)).zoomType).toBe("none");
    await expect(clipService.updateZoom(clip.id, "subtle")).rejects.toThrow(
      /camera scenes/
    );
  });
});
