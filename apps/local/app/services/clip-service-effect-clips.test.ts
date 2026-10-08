import { describe, it, expect } from "vitest";

import {
  setupClipServiceTests,
  clipService,
  start,
} from "./clip-service-test-setup";

setupClipServiceTests();

const effectClipDefaults = {
  videoFilename: "/path/to/assets/effects/white-noise.mp4",
  sourceStartTime: 0,
  sourceEndTime: 0.5,
  text: "*white noise*",
  scene: "white noise",
  profile: "main-camera",
  pauseType: "none",
};

describe("ClipService", () => {
  describe("createEffectClipAtPosition", () => {
    it("creates an effect clip before a clip", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const [clip] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      const effectClip = await clipService.createEffectClipAtPosition({
        videoId: video.id,
        position: "before",
        targetItemId: clip!.id,
        targetItemType: "clip",
        ...effectClipDefaults,
      });

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline.map((t) => ({ type: t.type, id: t.data.id }))).toEqual([
        { type: "clip", id: effectClip.id },
        { type: "clip", id: clip!.id },
      ]);
    });

    it("inserts effect clip between two existing clips with correct ordering", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const [clip1, clip2] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [
          { inputVideo: "test.mp4", startTime: 0, endTime: 10 },
          { inputVideo: "test.mp4", startTime: 10, endTime: 20 },
        ],
      });

      const effectClip = await clipService.createEffectClipAtPosition({
        videoId: video.id,
        position: "after",
        targetItemId: clip1!.id,
        targetItemType: "clip",
        ...effectClipDefaults,
      });

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline.map((t) => ({ type: t.type, id: t.data.id }))).toEqual([
        { type: "clip", id: clip1!.id },
        { type: "clip", id: effectClip.id },
        { type: "clip", id: clip2!.id },
      ]);
    });

    it("inserts effect clip before a chapter", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const [clip] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      const section = await clipService.createChapterAtPosition({
        videoId: video.id,
        name: "Section",
        position: "after",
        targetItemId: clip!.id,
        targetItemType: "clip",
      });

      const effectClip = await clipService.createEffectClipAtPosition({
        videoId: video.id,
        position: "before",
        targetItemId: section.id,
        targetItemType: "chapter",
        ...effectClipDefaults,
      });

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline.map((t) => ({ type: t.type, id: t.data.id }))).toEqual([
        { type: "clip", id: clip!.id },
        { type: "clip", id: effectClip.id },
        { type: "chapter", id: section.id },
      ]);
    });
  });
});
