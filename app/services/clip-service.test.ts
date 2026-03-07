import * as schema from "@/db/schema";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import {
  createDirectClipService,
  type VideoProcessingAdapter,
} from "./clip-service-handler";
import type { ClipService } from "./clip-service";
import type {
  FrontendId,
  DatabaseId,
  FrontendTimelineItem,
  FrontendInsertionPoint,
} from "./clip-service";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";

let testDb: TestDb;
let clipService: ClipService;
let mockVideoProcessing: VideoProcessingAdapter;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
});

beforeEach(async () => {
  await truncateAllTables(testDb);

  mockVideoProcessing = {
    getLatestOBSVideoClips: vi.fn().mockResolvedValue({ clips: [] }),
  };

  clipService = createDirectClipService(testDb as any, mockVideoProcessing);
});

/**
 * Builds FrontendTimelineItem[] from the current database timeline.
 * Uses database IDs as frontend IDs for simplicity in tests
 * (all items are persisted, no optimistic state).
 */
const getItems = async (
  clipService: ClipService,
  videoId: string
): Promise<FrontendTimelineItem[]> => {
  const timeline = await clipService.getTimeline(videoId);
  return timeline.map((item): FrontendTimelineItem => {
    if (item.type === "clip") {
      return {
        type: "on-database",
        frontendId: item.data.id as FrontendId,
        databaseId: item.data.id as DatabaseId,
      };
    } else {
      return {
        type: "clip-section-on-database",
        frontendId: item.data.id as FrontendId,
        databaseId: item.data.id as DatabaseId,
      };
    }
  });
};

/** Shorthand to build a FrontendInsertionPoint from a database clip ID */
const afterClip = (id: string): FrontendInsertionPoint => ({
  type: "after-clip",
  frontendClipId: id as FrontendId,
});

/** Shorthand to build a FrontendInsertionPoint from a database section ID */
const afterSection = (id: string): FrontendInsertionPoint => ({
  type: "after-clip-section",
  frontendClipSectionId: id as FrontendId,
});

const start: FrontendInsertionPoint = { type: "start" };
const end: FrontendInsertionPoint = { type: "end" };

describe("ClipService", () => {
  describe("createVideo", () => {
    it("creates a standalone video", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      expect(video).toMatchObject({
        id: expect.any(String),
        path: "test-video.mp4",
        lessonId: null,
      });
    });
  });

  describe("getTimeline", () => {
    it("returns an empty timeline for a video with no clips", async () => {
      const video = await clipService.createVideo("test-video.mp4");
      const timeline = await clipService.getTimeline(video.id);

      expect(timeline).toEqual([]);
    });

    it("returns clips sorted by order", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const clips = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [
          { inputVideo: "test.mp4", startTime: 0, endTime: 10 },
          { inputVideo: "test.mp4", startTime: 10, endTime: 20 },
        ],
      });

      const timeline = await clipService.getTimeline(video.id);

      expect(timeline).toHaveLength(2);
      expect(timeline[0]).toMatchObject({ type: "clip" });
      expect(timeline[1]).toMatchObject({ type: "clip" });
      expect(timeline[0]!.data.id).toBe(clips[0]!.id);
      expect(timeline[1]!.data.id).toBe(clips[1]!.id);
    });

    it("returns clips and sections interleaved and sorted", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const [clipA] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      const section = await clipService.createClipSectionAtInsertionPoint({
        videoId: video.id,
        name: "Section 1",
        insertionPoint: afterClip(clipA!.id),
        items: await getItems(clipService, video.id),
      });

      const [clipB] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: afterSection(section.id),
        items: await getItems(clipService, video.id),
        clips: [{ inputVideo: "test.mp4", startTime: 10, endTime: 20 }],
      });

      const timeline = await clipService.getTimeline(video.id);

      expect(timeline).toHaveLength(3);
      expect(timeline.map((t) => ({ type: t.type, id: t.data.id }))).toEqual([
        { type: "clip", id: clipA!.id },
        { type: "clip-section", id: section.id },
        { type: "clip", id: clipB!.id },
      ]);
    });
  });

  describe("appendClips", () => {
    it("inserts clips at start", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const clips = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      expect(clips).toHaveLength(1);
      expect(clips[0]).toMatchObject({
        id: expect.any(String),
        videoId: video.id,
        videoFilename: "test.mp4",
        sourceStartTime: 0,
        sourceEndTime: 10,
      });
    });

    it("inserts clips after an existing clip", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const [clipA] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      await clipService.appendClips({
        videoId: video.id,
        insertionPoint: afterClip(clipA!.id),
        items: await getItems(clipService, video.id),
        clips: [{ inputVideo: "test.mp4", startTime: 10, endTime: 20 }],
      });

      const timeline = await clipService.getTimeline(video.id);

      expect(timeline).toHaveLength(2);
      expect(timeline[0]!.data.id).toBe(clipA!.id);
    });

    it("inserts clips after a clip section", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const section = await clipService.createClipSectionAtInsertionPoint({
        videoId: video.id,
        name: "Section 1",
        insertionPoint: start,
        items: [],
      });

      const clips = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: afterSection(section.id),
        items: await getItems(clipService, video.id),
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      const timeline = await clipService.getTimeline(video.id);

      expect(timeline).toHaveLength(2);
      expect(timeline[0]).toMatchObject({ type: "clip-section" });
      expect(timeline[1]).toMatchObject({ type: "clip" });
      expect(timeline[1]!.data.id).toBe(clips[0]!.id);
    });

    it("inserts clips at end when last item is a clip", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const [clipA] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      await clipService.appendClips({
        videoId: video.id,
        insertionPoint: end,
        items: await getItems(clipService, video.id),
        clips: [{ inputVideo: "test.mp4", startTime: 10, endTime: 20 }],
      });

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline).toHaveLength(2);
      expect(timeline[0]!.data.id).toBe(clipA!.id);
    });

    it("inserts clips at end when last item is a section", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const [clipA] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      const section = await clipService.createClipSectionAtInsertionPoint({
        videoId: video.id,
        name: "Section 1",
        insertionPoint: afterClip(clipA!.id),
        items: await getItems(clipService, video.id),
      });

      await clipService.appendClips({
        videoId: video.id,
        insertionPoint: end,
        items: await getItems(clipService, video.id),
        clips: [{ inputVideo: "test.mp4", startTime: 10, endTime: 20 }],
      });

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline).toHaveLength(3);
      expect(timeline.map((t) => t.data.id)).toEqual([
        clipA!.id,
        section.id,
        expect.any(String),
      ]);
    });

    it("inserts at start when end is used with empty timeline", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const clips = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: end,
        items: [],
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline).toHaveLength(1);
      expect(timeline[0]!.data.id).toBe(clips[0]!.id);
    });
  });

  describe("archiveClips", () => {
    it("archives a single clip", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const [clip] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      await clipService.archiveClips([clip!.id]);

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline).toHaveLength(0);
    });

    it("archives multiple clips", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const clips = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [
          { inputVideo: "test.mp4", startTime: 0, endTime: 10 },
          { inputVideo: "test.mp4", startTime: 10, endTime: 20 },
        ],
      });

      await clipService.archiveClips(clips.map((c) => c.id));

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline).toHaveLength(0);
    });
  });

  describe("updateClips", () => {
    it("updates scene, profile, and beatType for a clip", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const [clip] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      await clipService.updateClips([
        {
          id: clip!.id,
          scene: "intro",
          profile: "default",
          beatType: "start",
        },
      ]);

      const timeline = await clipService.getTimeline(video.id);
      const timelineItem = timeline[0]!;

      expect(timelineItem.type).toBe("clip");
      if (timelineItem.type === "clip") {
        expect(timelineItem.data.scene).toBe("intro");
        expect(timelineItem.data.profile).toBe("default");
        expect(timelineItem.data.beatType).toBe("start");
      }
    });
  });

  describe("updateBeat", () => {
    it("updates beat type for a single clip", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const [clip] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      await clipService.updateBeat(clip!.id, "transition");

      const timeline = await clipService.getTimeline(video.id);
      const timelineItem = timeline[0]!;

      expect(timelineItem.type).toBe("clip");
      if (timelineItem.type === "clip") {
        expect(timelineItem.data.beatType).toBe("transition");
      }
    });
  });

  describe("reorderClip", () => {
    it("moves a clip up past another clip", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const clips = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [
          { inputVideo: "test.mp4", startTime: 0, endTime: 10 },
          { inputVideo: "test.mp4", startTime: 10, endTime: 20 },
        ],
      });

      const [clipA, clipB] = clips;

      // Move clipB up
      await clipService.reorderClip(clipB!.id, "up");

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline.map((t) => t.data.id)).toEqual([clipB!.id, clipA!.id]);
    });

    it("moves a clip down past another clip", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const clips = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [
          { inputVideo: "test.mp4", startTime: 0, endTime: 10 },
          { inputVideo: "test.mp4", startTime: 10, endTime: 20 },
        ],
      });

      const [clipA, clipB] = clips;

      // Move clipA down
      await clipService.reorderClip(clipA!.id, "down");

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline.map((t) => t.data.id)).toEqual([clipB!.id, clipA!.id]);
    });
  });

  describe("createClipSectionAtInsertionPoint", () => {
    it("creates a section at the start", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const section = await clipService.createClipSectionAtInsertionPoint({
        videoId: video.id,
        name: "Intro Section",
        insertionPoint: start,
        items: [],
      });

      expect(section).toMatchObject({
        id: expect.any(String),
        videoId: video.id,
        name: "Intro Section",
      });

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline).toHaveLength(1);
      expect(timeline[0]).toMatchObject({ type: "clip-section" });
    });

    it("creates a section after a clip", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const [clip] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      const section = await clipService.createClipSectionAtInsertionPoint({
        videoId: video.id,
        name: "After Clip Section",
        insertionPoint: afterClip(clip!.id),
        items: await getItems(clipService, video.id),
      });

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline.map((t) => ({ type: t.type, id: t.data.id }))).toEqual([
        { type: "clip", id: clip!.id },
        { type: "clip-section", id: section.id },
      ]);
    });
  });

  describe("createClipSectionAtPosition", () => {
    it("creates a section before a clip", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const [clip] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      const section = await clipService.createClipSectionAtPosition({
        videoId: video.id,
        name: "Before Clip",
        position: "before",
        targetItemId: clip!.id,
        targetItemType: "clip",
      });

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline.map((t) => ({ type: t.type, id: t.data.id }))).toEqual([
        { type: "clip-section", id: section.id },
        { type: "clip", id: clip!.id },
      ]);
    });

    it("creates a section after a clip", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const [clip] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      const section = await clipService.createClipSectionAtPosition({
        videoId: video.id,
        name: "After Clip",
        position: "after",
        targetItemId: clip!.id,
        targetItemType: "clip",
      });

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline.map((t) => ({ type: t.type, id: t.data.id }))).toEqual([
        { type: "clip", id: clip!.id },
        { type: "clip-section", id: section.id },
      ]);
    });
  });

  describe("updateClipSection", () => {
    it("updates the name of a clip section", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const section = await clipService.createClipSectionAtInsertionPoint({
        videoId: video.id,
        name: "Original Name",
        insertionPoint: start,
        items: [],
      });

      await clipService.updateClipSection(section.id, "Updated Name");

      const timeline = await clipService.getTimeline(video.id);
      const updatedSection = timeline[0]!.data;
      expect((updatedSection as typeof section).name).toBe("Updated Name");
    });
  });

  describe("archiveClipSections", () => {
    it("archives a clip section", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const section = await clipService.createClipSectionAtInsertionPoint({
        videoId: video.id,
        name: "To Archive",
        insertionPoint: start,
        items: [],
      });

      await clipService.archiveClipSections([section.id]);

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline).toHaveLength(0);
    });
  });

  describe("reorderClipSection", () => {
    it("moves a section up past a clip", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      const [clip] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      const section = await clipService.createClipSectionAtInsertionPoint({
        videoId: video.id,
        name: "Section",
        insertionPoint: afterClip(clip!.id),
        items: await getItems(clipService, video.id),
      });

      // Move section up (before the clip)
      await clipService.reorderClipSection(section.id, "up");

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline.map((t) => ({ type: t.type, id: t.data.id }))).toEqual([
        { type: "clip-section", id: section.id },
        { type: "clip", id: clip!.id },
      ]);
    });

    it("preserves ordering when moving a section up past another section", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      // Build timeline: [SectionA, Clip1, SectionB, Clip2, SectionC]
      const sectionA = await clipService.createClipSectionAtInsertionPoint({
        videoId: video.id,
        name: "Section A",
        insertionPoint: start,
        items: [],
      });

      const [clip1] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: afterSection(sectionA.id),
        items: await getItems(clipService, video.id),
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      const sectionB = await clipService.createClipSectionAtInsertionPoint({
        videoId: video.id,
        name: "Section B",
        insertionPoint: afterClip(clip1!.id),
        items: await getItems(clipService, video.id),
      });

      const [clip2] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: afterSection(sectionB.id),
        items: await getItems(clipService, video.id),
        clips: [{ inputVideo: "test.mp4", startTime: 10, endTime: 20 }],
      });

      const sectionC = await clipService.createClipSectionAtInsertionPoint({
        videoId: video.id,
        name: "Section C",
        insertionPoint: afterClip(clip2!.id),
        items: await getItems(clipService, video.id),
      });

      // Move SectionB up (past Clip1, which puts it next to SectionA)
      // Expected: [SectionA, SectionB, Clip1, Clip2, SectionC]
      await clipService.reorderClipSection(sectionB.id, "up");

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline.map((t) => ({ type: t.type, id: t.data.id }))).toEqual([
        { type: "clip-section", id: sectionA.id },
        { type: "clip-section", id: sectionB.id },
        { type: "clip", id: clip1!.id },
        { type: "clip", id: clip2!.id },
        { type: "clip-section", id: sectionC.id },
      ]);

      // Now move SectionB up again (past SectionA)
      // Expected: [SectionB, SectionA, Clip1, Clip2, SectionC]
      await clipService.reorderClipSection(sectionB.id, "up");

      const timeline2 = await clipService.getTimeline(video.id);
      expect(timeline2.map((t) => ({ type: t.type, id: t.data.id }))).toEqual([
        { type: "clip-section", id: sectionB.id },
        { type: "clip-section", id: sectionA.id },
        { type: "clip", id: clip1!.id },
        { type: "clip", id: clip2!.id },
        { type: "clip-section", id: sectionC.id },
      ]);
    });

    it("moves a section up past an adjacent section (no clips between)", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      // Build timeline: [Clip1, SectionA, SectionB, Clip2]
      const [clip1] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      const sectionA = await clipService.createClipSectionAtInsertionPoint({
        videoId: video.id,
        name: "Section A",
        insertionPoint: afterClip(clip1!.id),
        items: await getItems(clipService, video.id),
      });

      const sectionB = await clipService.createClipSectionAtInsertionPoint({
        videoId: video.id,
        name: "Section B",
        insertionPoint: afterSection(sectionA.id),
        items: await getItems(clipService, video.id),
      });

      const [clip2] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: afterSection(sectionB.id),
        items: await getItems(clipService, video.id),
        clips: [{ inputVideo: "test.mp4", startTime: 10, endTime: 20 }],
      });

      // Move SectionB up (past SectionA)
      // Expected: [Clip1, SectionB, SectionA, Clip2]
      await clipService.reorderClipSection(sectionB.id, "up");

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline.map((t) => ({ type: t.type, id: t.data.id }))).toEqual([
        { type: "clip", id: clip1!.id },
        { type: "clip-section", id: sectionB.id },
        { type: "clip-section", id: sectionA.id },
        { type: "clip", id: clip2!.id },
      ]);
    });

    it("preserves ordering when sections created via createClipSectionAtPosition are moved", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      // Create clips first: [Clip1, Clip2, Clip3, Clip4]
      const allClips = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [
          { inputVideo: "test.mp4", startTime: 0, endTime: 10 },
          { inputVideo: "test.mp4", startTime: 10, endTime: 20 },
          { inputVideo: "test.mp4", startTime: 20, endTime: 30 },
          { inputVideo: "test.mp4", startTime: 30, endTime: 40 },
        ],
      });

      const [clip1, clip2, clip3, clip4] = allClips;

      // Add sections using createClipSectionAtPosition (context menu style)
      // Add SectionA before Clip2: [Clip1, SectionA, Clip2, Clip3, Clip4]
      const sectionA = await clipService.createClipSectionAtPosition({
        videoId: video.id,
        name: "Section A",
        position: "before",
        targetItemId: clip2!.id,
        targetItemType: "clip",
      });

      // Add SectionB before Clip4: [Clip1, SectionA, Clip2, Clip3, SectionB, Clip4]
      const sectionB = await clipService.createClipSectionAtPosition({
        videoId: video.id,
        name: "Section B",
        position: "before",
        targetItemId: clip4!.id,
        targetItemType: "clip",
      });

      // Verify initial timeline
      const initialTimeline = await clipService.getTimeline(video.id);
      expect(
        initialTimeline.map((t) => ({ type: t.type, id: t.data.id }))
      ).toEqual([
        { type: "clip", id: clip1!.id },
        { type: "clip-section", id: sectionA.id },
        { type: "clip", id: clip2!.id },
        { type: "clip", id: clip3!.id },
        { type: "clip-section", id: sectionB.id },
        { type: "clip", id: clip4!.id },
      ]);

      // Move SectionB up (past Clip3)
      // Expected: [Clip1, SectionA, Clip2, SectionB, Clip3, Clip4]
      await clipService.reorderClipSection(sectionB.id, "up");

      const timeline1 = await clipService.getTimeline(video.id);
      expect(timeline1.map((t) => ({ type: t.type, id: t.data.id }))).toEqual([
        { type: "clip", id: clip1!.id },
        { type: "clip-section", id: sectionA.id },
        { type: "clip", id: clip2!.id },
        { type: "clip-section", id: sectionB.id },
        { type: "clip", id: clip3!.id },
        { type: "clip", id: clip4!.id },
      ]);

      // Move SectionB up again (past Clip2)
      // Expected: [Clip1, SectionA, SectionB, Clip2, Clip3, Clip4]
      await clipService.reorderClipSection(sectionB.id, "up");

      const timeline2 = await clipService.getTimeline(video.id);
      expect(timeline2.map((t) => ({ type: t.type, id: t.data.id }))).toEqual([
        { type: "clip", id: clip1!.id },
        { type: "clip-section", id: sectionA.id },
        { type: "clip-section", id: sectionB.id },
        { type: "clip", id: clip2!.id },
        { type: "clip", id: clip3!.id },
        { type: "clip", id: clip4!.id },
      ]);

      // Move SectionB up again (past SectionA)
      // Expected: [Clip1, SectionB, SectionA, Clip2, Clip3, Clip4]
      await clipService.reorderClipSection(sectionB.id, "up");

      const timeline3 = await clipService.getTimeline(video.id);
      expect(timeline3.map((t) => ({ type: t.type, id: t.data.id }))).toEqual([
        { type: "clip", id: clip1!.id },
        { type: "clip-section", id: sectionB.id },
        { type: "clip-section", id: sectionA.id },
        { type: "clip", id: clip2!.id },
        { type: "clip", id: clip3!.id },
        { type: "clip", id: clip4!.id },
      ]);
    });
  });

  describe("appendFromObs", () => {
    it("returns empty array when CLI detects no clips", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      mockVideoProcessing.getLatestOBSVideoClips = vi
        .fn()
        .mockResolvedValue({ clips: [] });

      const result = await clipService.appendFromObs({
        videoId: video.id,
        insertionPoint: start,
        items: [],
      });

      expect(result).toEqual([]);
      expect(mockVideoProcessing.getLatestOBSVideoClips).toHaveBeenCalledWith({
        filePath: undefined,
        startTime: undefined,
      });
    });

    it("inserts clips detected by CLI", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      mockVideoProcessing.getLatestOBSVideoClips = vi.fn().mockResolvedValue({
        clips: [
          { inputVideo: "/mnt/c/obs/video.mkv", startTime: 0, endTime: 10 },
          { inputVideo: "/mnt/c/obs/video.mkv", startTime: 15, endTime: 25 },
        ],
      });

      const result = await clipService.appendFromObs({
        videoId: video.id,
        insertionPoint: start,
        items: [],
      });

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        videoFilename: "/mnt/c/obs/video.mkv",
        sourceStartTime: 0,
        sourceEndTime: 10,
      });

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline).toHaveLength(2);
    });

    it("converts Windows path to WSL path", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      mockVideoProcessing.getLatestOBSVideoClips = vi
        .fn()
        .mockResolvedValue({ clips: [] });

      await clipService.appendFromObs({
        videoId: video.id,
        filePath: "C:\\Users\\Matt\\Videos\\obs\\recording.mkv",
        insertionPoint: start,
        items: [],
      });

      expect(mockVideoProcessing.getLatestOBSVideoClips).toHaveBeenCalledWith({
        filePath: "/mnt/c/Users/Matt/Videos/obs/recording.mkv",
        startTime: undefined,
      });
    });

    it("deduplicates clips that already exist", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      // First, add a clip directly
      await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [
          { inputVideo: "/mnt/c/obs/video.mkv", startTime: 0, endTime: 10 },
        ],
      });

      // CLI returns the same clip plus a new one
      mockVideoProcessing.getLatestOBSVideoClips = vi.fn().mockResolvedValue({
        clips: [
          { inputVideo: "/mnt/c/obs/video.mkv", startTime: 0, endTime: 10 }, // duplicate
          { inputVideo: "/mnt/c/obs/video.mkv", startTime: 15, endTime: 25 }, // new
        ],
      });

      const result = await clipService.appendFromObs({
        videoId: video.id,
        insertionPoint: start,
        items: await getItems(clipService, video.id),
      });

      // Should only add the new clip
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        sourceStartTime: 15,
        sourceEndTime: 25,
      });

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline).toHaveLength(2);
    });

    it("deduplicates clips with nearly identical start/end times (rounding tolerance)", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      // First, add a clip directly
      await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [
          {
            inputVideo: "/mnt/c/obs/video.mkv",
            startTime: 441.88,
            endTime: 445.06,
          },
        ],
      });

      // CLI returns the "same" clip but with slightly different times (float rounding)
      mockVideoProcessing.getLatestOBSVideoClips = vi.fn().mockResolvedValue({
        clips: [
          {
            inputVideo: "/mnt/c/obs/video.mkv",
            startTime: 441.87,
            endTime: 445.07,
          },
        ],
      });

      const result = await clipService.appendFromObs({
        videoId: video.id,
        insertionPoint: start,
        items: await getItems(clipService, video.id),
      });

      // Should be skipped as a duplicate — times differ by only 0.01s
      expect(result).toHaveLength(0);

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline).toHaveLength(1);
    });

    it("deduplicates clips with drifted startTime from ffmpeg re-detection (0.57s drift)", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      // First clip inserted correctly
      await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [
          {
            inputVideo: "/mnt/c/obs/video.mkv",
            startTime: 2.05,
            endTime: 5.33,
          },
        ],
      });

      // Re-detection returns same clip with drifted startTime (0.57s difference)
      mockVideoProcessing.getLatestOBSVideoClips = vi.fn().mockResolvedValue({
        clips: [
          {
            inputVideo: "/mnt/c/obs/video.mkv",
            startTime: 1.48,
            endTime: 5.33,
          },
        ],
      });

      const result = await clipService.appendFromObs({
        videoId: video.id,
        insertionPoint: start,
        items: await getItems(clipService, video.id),
      });

      // Should be skipped as a duplicate — 0.57s drift is within 0.6s tolerance
      expect(result).toHaveLength(0);

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline).toHaveLength(1);
    });

    it("inserts genuinely distinct clips that differ by more than 0.6s", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      // First clip
      await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [
          {
            inputVideo: "/mnt/c/obs/video.mkv",
            startTime: 2.0,
            endTime: 5.0,
          },
        ],
      });

      // New clip with start and end both differing by more than 0.6s
      mockVideoProcessing.getLatestOBSVideoClips = vi.fn().mockResolvedValue({
        clips: [
          {
            inputVideo: "/mnt/c/obs/video.mkv",
            startTime: 8.0,
            endTime: 12.0,
          },
        ],
      });

      const result = await clipService.appendFromObs({
        videoId: video.id,
        insertionPoint: start,
        items: await getItems(clipService, video.id),
      });

      // Should be inserted — clearly a different clip
      expect(result).toHaveLength(1);

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline).toHaveLength(2);
    });

    it("calculates start time from last clip with same input video", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      // Add existing clip
      await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [
          { inputVideo: "/mnt/c/obs/video.mkv", startTime: 0, endTime: 100 },
        ],
      });

      mockVideoProcessing.getLatestOBSVideoClips = vi.fn().mockResolvedValue({
        clips: [
          { inputVideo: "/mnt/c/obs/video.mkv", startTime: 150, endTime: 200 },
        ],
      });

      await clipService.appendFromObs({
        videoId: video.id,
        filePath: "C:\\obs\\video.mkv",
        insertionPoint: start,
        items: await getItems(clipService, video.id),
      });

      // Should pass startTime = endTime of last clip - 1 = 99
      expect(mockVideoProcessing.getLatestOBSVideoClips).toHaveBeenCalledWith({
        filePath: "/mnt/c/obs/video.mkv",
        startTime: 99,
      });
    });

    it("inserts clips at specified insertion point", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      // Add existing clip
      const [existingClip] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "other.mkv", startTime: 0, endTime: 10 }],
      });

      mockVideoProcessing.getLatestOBSVideoClips = vi.fn().mockResolvedValue({
        clips: [
          { inputVideo: "/mnt/c/obs/new.mkv", startTime: 0, endTime: 10 },
        ],
      });

      const result = await clipService.appendFromObs({
        videoId: video.id,
        insertionPoint: afterClip(existingClip!.id),
        items: await getItems(clipService, video.id),
      });

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline.map((t) => t.data.id)).toEqual([
        existingClip!.id,
        result[0]!.id,
      ]);
    });

    it("serializes concurrent append-from-obs calls via mutex", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      mockVideoProcessing.getLatestOBSVideoClips = vi.fn().mockResolvedValue({
        clips: [
          { inputVideo: "/mnt/c/obs/video.mkv", startTime: 0, endTime: 10 },
          { inputVideo: "/mnt/c/obs/video.mkv", startTime: 15, endTime: 25 },
        ],
      });

      // Fire two concurrent appendFromObs calls — mutex serializes them
      const [result1, result2] = await Promise.all([
        clipService.appendFromObs({
          videoId: video.id,
          insertionPoint: start,
          items: [],
        }),
        clipService.appendFromObs({
          videoId: video.id,
          insertionPoint: start,
          items: [],
        }),
      ]);

      // One call inserts clips, the other finds them as duplicates
      const totalInserted = result1.length + result2.length;
      expect(totalInserted).toBe(2);

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline).toHaveLength(2);
    });

    it("mutex releases on error allowing subsequent calls", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      // First call: mock throws
      mockVideoProcessing.getLatestOBSVideoClips = vi
        .fn()
        .mockRejectedValueOnce(new Error("CLI failed"))
        .mockResolvedValueOnce({
          clips: [
            { inputVideo: "/mnt/c/obs/video.mkv", startTime: 0, endTime: 10 },
          ],
        });

      // First call should fail
      await expect(
        clipService.appendFromObs({
          videoId: video.id,
          insertionPoint: start,
          items: [],
        })
      ).rejects.toThrow();

      // Second call should succeed — mutex was released
      const result = await clipService.appendFromObs({
        videoId: video.id,
        insertionPoint: start,
        items: [],
      });

      expect(result).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Optimistic Insertion Point Resolution (integration tests)
  //
  // These test that ClipService correctly resolves FrontendInsertionPoints
  // that reference optimistic (not-yet-persisted) items to their nearest
  // persisted ancestor.
  // ==========================================================================

  describe("optimistic insertion point resolution", () => {
    it("resolves after-clip on optimistic item to nearest persisted section", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      // Seed: [ClipA, Section1] in DB
      const [clipA] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });
      const section = await clipService.createClipSectionAtInsertionPoint({
        videoId: video.id,
        name: "Section 1",
        insertionPoint: afterClip(clipA!.id),
        items: await getItems(clipService, video.id),
      });

      // Frontend items: [ClipA (db), Section1 (db), OptClip1 (optimistic)]
      const items: FrontendTimelineItem[] = [
        {
          type: "on-database",
          frontendId: clipA!.id as FrontendId,
          databaseId: clipA!.id as DatabaseId,
        },
        {
          type: "clip-section-on-database",
          frontendId: section.id as FrontendId,
          databaseId: section.id as DatabaseId,
        },
        {
          type: "optimistically-added",
          frontendId: "opt-1" as FrontendId,
        },
      ];

      // Insert after the optimistic clip - should resolve to after Section1
      await clipService.appendClips({
        videoId: video.id,
        insertionPoint: {
          type: "after-clip",
          frontendClipId: "opt-1" as FrontendId,
        },
        items,
        clips: [{ inputVideo: "test.mp4", startTime: 10, endTime: 20 }],
      });

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline.map((t) => ({ type: t.type, id: t.data.id }))).toEqual([
        { type: "clip", id: clipA!.id },
        { type: "clip-section", id: section.id },
        { type: "clip", id: expect.any(String) }, // New clip after section
      ]);
    });

    it("resolves after-clip on optimistic item to nearest persisted clip", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      // Seed: [Section1, ClipA] in DB
      const section = await clipService.createClipSectionAtInsertionPoint({
        videoId: video.id,
        name: "Section 1",
        insertionPoint: start,
        items: [],
      });
      const [clipA] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: afterSection(section.id),
        items: await getItems(clipService, video.id),
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      // Frontend items: [Section1 (db), ClipA (db), OptClip1 (optimistic)]
      const items: FrontendTimelineItem[] = [
        {
          type: "clip-section-on-database",
          frontendId: section.id as FrontendId,
          databaseId: section.id as DatabaseId,
        },
        {
          type: "on-database",
          frontendId: clipA!.id as FrontendId,
          databaseId: clipA!.id as DatabaseId,
        },
        {
          type: "optimistically-added",
          frontendId: "opt-1" as FrontendId,
        },
      ];

      // Insert after optimistic clip - should resolve to after ClipA
      await clipService.appendClips({
        videoId: video.id,
        insertionPoint: {
          type: "after-clip",
          frontendClipId: "opt-1" as FrontendId,
        },
        items,
        clips: [{ inputVideo: "test.mp4", startTime: 10, endTime: 20 }],
      });

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline.map((t) => ({ type: t.type, id: t.data.id }))).toEqual([
        { type: "clip-section", id: section.id },
        { type: "clip", id: clipA!.id },
        { type: "clip", id: expect.any(String) }, // New clip after clipA
      ]);
    });

    it("resolves after-clip-section on optimistic section to nearest persisted item", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      // Seed: [Section1, ClipA] in DB
      const section = await clipService.createClipSectionAtInsertionPoint({
        videoId: video.id,
        name: "Section 1",
        insertionPoint: start,
        items: [],
      });
      const [clipA] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: afterSection(section.id),
        items: await getItems(clipService, video.id),
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      // Frontend items: [Section1 (db), ClipA (db), OptSection (optimistic)]
      const items: FrontendTimelineItem[] = [
        {
          type: "clip-section-on-database",
          frontendId: section.id as FrontendId,
          databaseId: section.id as DatabaseId,
        },
        {
          type: "on-database",
          frontendId: clipA!.id as FrontendId,
          databaseId: clipA!.id as DatabaseId,
        },
        {
          type: "clip-section-optimistically-added",
          frontendId: "opt-section-1" as FrontendId,
        },
      ];

      // Insert after optimistic section - should resolve to after ClipA
      await clipService.appendClips({
        videoId: video.id,
        insertionPoint: {
          type: "after-clip-section",
          frontendClipSectionId: "opt-section-1" as FrontendId,
        },
        items,
        clips: [{ inputVideo: "test.mp4", startTime: 10, endTime: 20 }],
      });

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline.map((t) => ({ type: t.type, id: t.data.id }))).toEqual([
        { type: "clip-section", id: section.id },
        { type: "clip", id: clipA!.id },
        { type: "clip", id: expect.any(String) }, // New clip after clipA
      ]);
    });

    it("resolves to start when no persisted items exist before optimistic item", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      // Frontend items: [OptClip (optimistic)] — no persisted items
      const items: FrontendTimelineItem[] = [
        {
          type: "optimistically-added",
          frontendId: "opt-1" as FrontendId,
        },
      ];

      // Insert after optimistic clip with no persisted items before it
      await clipService.appendClips({
        videoId: video.id,
        insertionPoint: {
          type: "after-clip",
          frontendClipId: "opt-1" as FrontendId,
        },
        items,
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline).toHaveLength(1);
    });

    it("resolves end with only optimistic items to start", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      // Frontend items: [OptClip (optimistic)] — no persisted items
      const items: FrontendTimelineItem[] = [
        {
          type: "optimistically-added",
          frontendId: "opt-1" as FrontendId,
        },
      ];

      await clipService.appendClips({
        videoId: video.id,
        insertionPoint: end,
        items,
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });

      const timeline = await clipService.getTimeline(video.id);
      expect(timeline).toHaveLength(1);
    });

    it("skips shouldArchive clips when resolving end insertion point", async () => {
      const video = await clipService.createVideo("test-video.mp4");

      // Create clipA in DB then archive it (simulates optimistic delete -> DB pairing -> archive)
      const [clipA] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "test.mp4", startTime: 0, endTime: 10 }],
      });
      await clipService.archiveClips([clipA!.id]);

      // Frontend still has clipA as on-database with shouldArchive: true
      const items: FrontendTimelineItem[] = [
        {
          type: "on-database",
          frontendId: clipA!.id as FrontendId,
          databaseId: clipA!.id as DatabaseId,
          shouldArchive: true,
        },
      ];

      mockVideoProcessing.getLatestOBSVideoClips = vi.fn().mockResolvedValue({
        clips: [
          { inputVideo: "/mnt/c/obs/video.mkv", startTime: 0, endTime: 10 },
        ],
      });

      // This should NOT throw "Could not find a clip to insert after"
      // because resolveInsertionPoint should skip the shouldArchive clip
      const result = await clipService.appendFromObs({
        videoId: video.id,
        insertionPoint: end,
        items,
      });

      expect(result).toHaveLength(1);
    });
  });

  // ==========================================================================
  // createVideoFromSelection (Issue #197 - copy mode)
  // ==========================================================================

  describe("createVideoFromSelection", () => {
    it("copy mode creates a new video with selected clips, originals remain in source", async () => {
      const video = await clipService.createVideo("source-video.mp4");

      const [clipA, clipB] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [
          { inputVideo: "footage.mp4", startTime: 0, endTime: 10 },
          { inputVideo: "footage.mp4", startTime: 10, endTime: 20 },
        ],
      });

      // Copy only clipA to a new video
      const newVideo = await clipService.createVideoFromSelection({
        sourceVideoId: video.id,
        clipIds: [clipA!.id],
        clipSectionIds: [],
        title: "New Video from Selection",
        mode: "copy",
      });

      expect(newVideo).toMatchObject({
        id: expect.any(String),
        path: "New Video from Selection",
      });

      // New video should have the copied clip
      const newTimeline = await clipService.getTimeline(newVideo.id);
      expect(newTimeline).toHaveLength(1);
      expect(newTimeline[0]!.type).toBe("clip");

      // Source video should still have both clips (originals remain)
      const sourceTimeline = await clipService.getTimeline(video.id);
      expect(sourceTimeline).toHaveLength(2);
      expect(sourceTimeline.map((t) => t.data.id)).toEqual([
        clipA!.id,
        clipB!.id,
      ]);
    });

    it("copy mode creates a new video with selected clip sections, originals remain", async () => {
      const video = await clipService.createVideo("source-video.mp4");

      const sectionA = await clipService.createClipSectionAtInsertionPoint({
        videoId: video.id,
        name: "Section A",
        insertionPoint: start,
        items: [],
      });

      await clipService.createClipSectionAtInsertionPoint({
        videoId: video.id,
        name: "Section B",
        insertionPoint: afterSection(sectionA.id),
        items: await getItems(clipService, video.id),
      });

      // Copy only sectionA to a new video
      const newVideo = await clipService.createVideoFromSelection({
        sourceVideoId: video.id,
        clipIds: [],
        clipSectionIds: [sectionA.id],
        title: "Sections Video",
        mode: "copy",
      });

      // New video should have the copied section
      const newTimeline = await clipService.getTimeline(newVideo.id);
      expect(newTimeline).toHaveLength(1);
      expect(newTimeline[0]!.type).toBe("clip-section");
      expect((newTimeline[0]!.data as any).name).toBe("Section A");

      // Source video should still have both sections
      const sourceTimeline = await clipService.getTimeline(video.id);
      expect(sourceTimeline).toHaveLength(2);
    });

    it("mixed selection creates a new video with all selected items", async () => {
      const video = await clipService.createVideo("source-video.mp4");

      const sectionA = await clipService.createClipSectionAtInsertionPoint({
        videoId: video.id,
        name: "Section A",
        insertionPoint: start,
        items: [],
      });

      const [clipA] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: afterSection(sectionA.id),
        items: await getItems(clipService, video.id),
        clips: [{ inputVideo: "footage.mp4", startTime: 0, endTime: 10 }],
      });

      await clipService.createClipSectionAtInsertionPoint({
        videoId: video.id,
        name: "Section B",
        insertionPoint: afterClip(clipA!.id),
        items: await getItems(clipService, video.id),
      });

      // Copy sectionA and clipA (mixed selection)
      const newVideo = await clipService.createVideoFromSelection({
        sourceVideoId: video.id,
        clipIds: [clipA!.id],
        clipSectionIds: [sectionA.id],
        title: "Mixed Selection",
        mode: "copy",
      });

      const newTimeline = await clipService.getTimeline(newVideo.id);
      expect(newTimeline).toHaveLength(2);
      expect(newTimeline.map((t) => t.type)).toEqual(["clip-section", "clip"]);
    });

    it("items in new video preserve their relative order from source timeline", async () => {
      const video = await clipService.createVideo("source-video.mp4");

      // Create timeline: [ClipA, SectionX, ClipB, ClipC]
      const [clipA] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "footage.mp4", startTime: 0, endTime: 10 }],
      });

      const sectionX = await clipService.createClipSectionAtInsertionPoint({
        videoId: video.id,
        name: "Section X",
        insertionPoint: afterClip(clipA!.id),
        items: await getItems(clipService, video.id),
      });

      const [, clipC] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: afterSection(sectionX.id),
        items: await getItems(clipService, video.id),
        clips: [
          { inputVideo: "footage.mp4", startTime: 10, endTime: 20 },
          { inputVideo: "footage.mp4", startTime: 20, endTime: 30 },
        ],
      });

      // Select ClipC, ClipA, SectionX (out of order) - should preserve original timeline order
      const newVideo = await clipService.createVideoFromSelection({
        sourceVideoId: video.id,
        clipIds: [clipC!.id, clipA!.id],
        clipSectionIds: [sectionX.id],
        title: "Ordered Selection",
        mode: "copy",
      });

      const newTimeline = await clipService.getTimeline(newVideo.id);
      expect(newTimeline).toHaveLength(3);
      // Should be in original timeline order: [ClipA, SectionX, ClipC]
      expect(newTimeline.map((t) => t.type)).toEqual([
        "clip",
        "clip-section",
        "clip",
      ]);
    });

    it("copied clips retain all metadata", async () => {
      const video = await clipService.createVideo("source-video.mp4");

      const [clip] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "footage.mp4", startTime: 5, endTime: 15 }],
      });

      // Update the clip with all metadata fields
      await clipService.updateClips([
        {
          id: clip!.id,
          scene: "intro-scene",
          profile: "main-camera",
          beatType: "hook",
        },
      ]);

      const newVideo = await clipService.createVideoFromSelection({
        sourceVideoId: video.id,
        clipIds: [clip!.id],
        clipSectionIds: [],
        title: "Metadata Test",
        mode: "copy",
      });

      const newTimeline = await clipService.getTimeline(newVideo.id);
      expect(newTimeline).toHaveLength(1);

      const copiedClip = newTimeline[0]!.data;
      expect(copiedClip).toMatchObject({
        videoFilename: "footage.mp4",
        sourceStartTime: 5,
        sourceEndTime: 15,
        scene: "intro-scene",
        profile: "main-camera",
        beatType: "hook",
      });
      // Copied clip should have a NEW id
      expect(copiedClip!.id).not.toBe(clip!.id);
    });

    it("copied clip sections retain their names", async () => {
      const video = await clipService.createVideo("source-video.mp4");

      const section = await clipService.createClipSectionAtInsertionPoint({
        videoId: video.id,
        name: "Important Section Name",
        insertionPoint: start,
        items: [],
      });

      const newVideo = await clipService.createVideoFromSelection({
        sourceVideoId: video.id,
        clipIds: [],
        clipSectionIds: [section.id],
        title: "Section Name Test",
        mode: "copy",
      });

      const newTimeline = await clipService.getTimeline(newVideo.id);
      expect(newTimeline).toHaveLength(1);

      const copiedSection = newTimeline[0]!.data as typeof section;
      expect(copiedSection.name).toBe("Important Section Name");
      // Copied section should have a NEW id
      expect(copiedSection.id).not.toBe(section.id);
    });

    it("new video inherits lessonId from source video", async () => {
      // First create a video with a lesson association
      // We need to create the lesson structure first
      const repoVersionId = crypto.randomUUID();
      const sectionId = crypto.randomUUID();
      const lessonId = crypto.randomUUID();

      // Insert repo, repoVersion, section, lesson directly
      await testDb.insert(schema.repos).values({
        id: crypto.randomUUID(),
        filePath: "/test",
        name: "Test Repo",
      });

      await testDb.insert(schema.repoVersions).values({
        id: repoVersionId,
        repoId: (await testDb.query.repos.findFirst())!.id,
        name: "v1",
      });

      await testDb.insert(schema.sections).values({
        id: sectionId,
        repoVersionId,
        path: "/test/section",
        order: 0,
      });

      await testDb.insert(schema.lessons).values({
        id: lessonId,
        sectionId,
        path: "/test/lesson",
        order: 0,
      });

      // Create video with lessonId
      await testDb.insert(schema.videos).values({
        id: "source-video-id",
        path: "source-video.mp4",
        originalFootagePath: "",
        lessonId,
      });

      const video = (await testDb.query.videos.findFirst({
        where: (v, { eq }) => eq(v.id, "source-video-id"),
      }))!;

      const [clip] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "footage.mp4", startTime: 0, endTime: 10 }],
      });

      const newVideo = await clipService.createVideoFromSelection({
        sourceVideoId: video.id,
        clipIds: [clip!.id],
        clipSectionIds: [],
        title: "Inherits Lesson",
        mode: "copy",
      });

      expect(newVideo.lessonId).toBe(lessonId);
    });

    it("selecting a single clip creates a valid new video", async () => {
      const video = await clipService.createVideo("source-video.mp4");

      const [clip] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [{ inputVideo: "footage.mp4", startTime: 0, endTime: 10 }],
      });

      const newVideo = await clipService.createVideoFromSelection({
        sourceVideoId: video.id,
        clipIds: [clip!.id],
        clipSectionIds: [],
        title: "Single Clip",
        mode: "copy",
      });

      expect(newVideo.id).toBeDefined();
      const newTimeline = await clipService.getTimeline(newVideo.id);
      expect(newTimeline).toHaveLength(1);
    });

    it("selecting all items creates a new video with everything", async () => {
      const video = await clipService.createVideo("source-video.mp4");

      const sectionA = await clipService.createClipSectionAtInsertionPoint({
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

      // Select everything
      const newVideo = await clipService.createVideoFromSelection({
        sourceVideoId: video.id,
        clipIds: [clipA!.id, clipB!.id],
        clipSectionIds: [sectionA.id],
        title: "Complete Copy",
        mode: "copy",
      });

      const newTimeline = await clipService.getTimeline(newVideo.id);
      expect(newTimeline).toHaveLength(3);
      expect(newTimeline.map((t) => t.type)).toEqual([
        "clip-section",
        "clip",
        "clip",
      ]);

      // Source should still have all items
      const sourceTimeline = await clipService.getTimeline(video.id);
      expect(sourceTimeline).toHaveLength(3);
    });

    // ==========================================================================
    // Move mode tests (Issue #198)
    // ==========================================================================

    it("move mode creates a new video AND archives originals from source", async () => {
      const video = await clipService.createVideo("source-video.mp4");

      const [clipA, clipB] = await clipService.appendClips({
        videoId: video.id,
        insertionPoint: start,
        items: [],
        clips: [
          { inputVideo: "footage.mp4", startTime: 0, endTime: 10 },
          { inputVideo: "footage.mp4", startTime: 10, endTime: 20 },
        ],
      });

      // Move clipA to a new video
      const newVideo = await clipService.createVideoFromSelection({
        sourceVideoId: video.id,
        clipIds: [clipA!.id],
        clipSectionIds: [],
        title: "Moved Video",
        mode: "move",
      });

      // New video should have the moved clip
      const newTimeline = await clipService.getTimeline(newVideo.id);
      expect(newTimeline).toHaveLength(1);
      expect(newTimeline[0]!.type).toBe("clip");

      // Source video should only have clipB (clipA was archived)
      const sourceTimeline = await clipService.getTimeline(video.id);
      expect(sourceTimeline).toHaveLength(1);
      expect(sourceTimeline[0]!.data.id).toBe(clipB!.id);
    });

    it("move mode archives original clip sections from source", async () => {
      const video = await clipService.createVideo("source-video.mp4");

      const sectionA = await clipService.createClipSectionAtInsertionPoint({
        videoId: video.id,
        name: "Section A",
        insertionPoint: start,
        items: [],
      });

      await clipService.createClipSectionAtInsertionPoint({
        videoId: video.id,
        name: "Section B",
        insertionPoint: afterSection(sectionA.id),
        items: await getItems(clipService, video.id),
      });

      // Move sectionA to a new video
      const newVideo = await clipService.createVideoFromSelection({
        sourceVideoId: video.id,
        clipIds: [],
        clipSectionIds: [sectionA.id],
        title: "Moved Sections",
        mode: "move",
      });

      // New video should have sectionA
      const newTimeline = await clipService.getTimeline(newVideo.id);
      expect(newTimeline).toHaveLength(1);
      expect((newTimeline[0]!.data as any).name).toBe("Section A");

      // Source video should only have sectionB (sectionA was archived)
      const sourceTimeline = await clipService.getTimeline(video.id);
      expect(sourceTimeline).toHaveLength(1);
      expect((sourceTimeline[0]!.data as any).name).toBe("Section B");
    });

    it("move mode with mixed selection archives all selected originals", async () => {
      const video = await clipService.createVideo("source-video.mp4");

      const sectionA = await clipService.createClipSectionAtInsertionPoint({
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

      const sectionB = await clipService.createClipSectionAtInsertionPoint({
        videoId: video.id,
        name: "Section B",
        insertionPoint: afterClip(clipB!.id),
        items: await getItems(clipService, video.id),
      });

      // Move sectionA and clipA (leave clipB and sectionB)
      const newVideo = await clipService.createVideoFromSelection({
        sourceVideoId: video.id,
        clipIds: [clipA!.id],
        clipSectionIds: [sectionA.id],
        title: "Mixed Move",
        mode: "move",
      });

      // New video should have both moved items
      const newTimeline = await clipService.getTimeline(newVideo.id);
      expect(newTimeline).toHaveLength(2);
      expect(newTimeline.map((t) => t.type)).toEqual(["clip-section", "clip"]);

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
          beatType: "moved-beat",
        },
      ]);

      const newVideo = await clipService.createVideoFromSelection({
        sourceVideoId: video.id,
        clipIds: [clip!.id],
        clipSectionIds: [],
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
        beatType: "moved-beat",
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

      const sectionX = await clipService.createClipSectionAtInsertionPoint({
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
        clipSectionIds: [sectionX.id],
        title: "Ordered Move",
        mode: "move",
      });

      const newTimeline = await clipService.getTimeline(newVideo.id);
      expect(newTimeline).toHaveLength(3);
      // Should be in original timeline order: [ClipA, SectionX, ClipC]
      expect(newTimeline.map((t) => t.type)).toEqual([
        "clip",
        "clip-section",
        "clip",
      ]);

      // Source should only have clipB
      const sourceTimeline = await clipService.getTimeline(video.id);
      expect(sourceTimeline).toHaveLength(1);
      expect(sourceTimeline[0]!.data.id).toBe(clipB!.id);
    });
  });
});
