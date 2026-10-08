import { describe, it, expect } from "vitest";

import {
  setupClipServiceTests,
  clipService,
  getItems,
  afterClip,
  afterSection,
  start,
} from "./clip-service-test-setup";

setupClipServiceTests();

describe("ClipService", () => {
  describe("createVideoFromSelection - move mode", () => {
    it("move mode with mixed selection archives all selected originals", async () => {
      const video = await clipService.createVideo("source-video.mp4");

      const sectionA = await clipService.createChapterAtInsertionPoint({
        videoId: video.id,
        name: "Section A",
        insertionPoint: start,
        items: [],
      });

      const [clipA, clipB] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: afterSection(sectionA.id),
        items: await getItems(clipService, video.id),
        clips: [
          { inputVideo: "footage.mp4", startTime: 0, endTime: 10 },
          { inputVideo: "footage.mp4", startTime: 10, endTime: 20 },
        ],
      });

      const sectionB = await clipService.createChapterAtInsertionPoint({
        videoId: video.id,
        name: "Section B",
        insertionPoint: afterClip(clipB!.id),
        items: await getItems(clipService, video.id),
      });

      // Move sectionA and clipA (leave clipB and sectionB)
      const newVideo = await clipService.createVideoFromSelection({
        sourceVideoId: video.id,
        clipIds: [clipA!.id],
        chapterIds: [sectionA.id],
        title: "Mixed Move",
        mode: "move",
      });

      // New video should have both moved items
      const newTimeline = await clipService.getTimeline(newVideo.id);
      expect(newTimeline).toHaveLength(2);
      expect(newTimeline.map((t) => t.type)).toEqual(["chapter", "clip"]);

      // Source video should only have clipB and sectionB
      const sourceTimeline = await clipService.getTimeline(video.id);
      expect(sourceTimeline).toHaveLength(2);
      expect(sourceTimeline.map((t) => t.data.id)).toEqual([
        clipB!.id,
        sectionB.id,
      ]);
    });

    it("move mode preserves metadata on moved clips", async () => {
      const video = await clipService.createVideo("source-video.mp4");

      const [clip] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "footage.mp4", startTime: 5, endTime: 15 }],
      });

      // Update the clip with metadata
      await clipService.updateClips([
        {
          id: clip!.id,
          scene: "moved-scene",
          profile: "moved-profile",
          pauseType: "moved-beat",
        },
      ]);

      const newVideo = await clipService.createVideoFromSelection({
        sourceVideoId: video.id,
        clipIds: [clip!.id],
        chapterIds: [],
        title: "Metadata Move Test",
        mode: "move",
      });

      const newTimeline = await clipService.getTimeline(newVideo.id);
      expect(newTimeline).toHaveLength(1);

      const movedClip = newTimeline[0]!.data;
      expect(movedClip).toMatchObject({
        videoFilename: "footage.mp4",
        sourceStartTime: 5,
        sourceEndTime: 15,
        scene: "moved-scene",
        profile: "moved-profile",
        pauseType: "moved-beat",
      });

      // Source should be empty (clip was archived)
      const sourceTimeline = await clipService.getTimeline(video.id);
      expect(sourceTimeline).toHaveLength(0);
    });

    it("move mode preserves correct ordering in new video", async () => {
      const video = await clipService.createVideo("source-video.mp4");

      // Create timeline: [ClipA, SectionX, ClipB, ClipC]
      const [clipA] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "footage.mp4", startTime: 0, endTime: 10 }],
      });

      const sectionX = await clipService.createChapterAtInsertionPoint({
        videoId: video.id,
        name: "Section X",
        insertionPoint: afterClip(clipA!.id),
        items: await getItems(clipService, video.id),
      });

      const [clipB, clipC] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: afterSection(sectionX.id),
        items: await getItems(clipService, video.id),
        clips: [
          { inputVideo: "footage.mp4", startTime: 10, endTime: 20 },
          { inputVideo: "footage.mp4", startTime: 20, endTime: 30 },
        ],
      });

      // Move ClipC, ClipA, SectionX (out of order in selection)
      // Should preserve original timeline order in new video
      const newVideo = await clipService.createVideoFromSelection({
        sourceVideoId: video.id,
        clipIds: [clipC!.id, clipA!.id],
        chapterIds: [sectionX.id],
        title: "Ordered Move",
        mode: "move",
      });

      const newTimeline = await clipService.getTimeline(newVideo.id);
      expect(newTimeline).toHaveLength(3);
      // Should be in original timeline order: [ClipA, SectionX, ClipC]
      expect(newTimeline.map((t) => t.type)).toEqual([
        "clip",
        "chapter",
        "clip",
      ]);

      // Source should only have clipB
      const sourceTimeline = await clipService.getTimeline(video.id);
      expect(sourceTimeline).toHaveLength(1);
      expect(sourceTimeline[0]!.data.id).toBe(clipB!.id);
    });
  });
});
