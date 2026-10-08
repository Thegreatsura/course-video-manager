/**
 * Shared test setup for the clip-service-*.test.ts integration tests.
 * A PGlite-backed ClipService with a fake VideoProcessingAdapter, reset
 * before every test, plus the insertion-point and timeline helpers.
 */

import { vi, beforeAll, beforeEach } from "vitest";
import { createDirectClipService } from "@/test-utils/direct-clip-service";
import { type VideoProcessingAdapter } from "./clip-service-handler";
import type {
  ClipService,
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

export let testDb: TestDb;
export let clipService: ClipService;
export let mockVideoProcessing: VideoProcessingAdapter;

export function setupClipServiceTests() {
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
}

export const getItems = async (
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
        type: "chapter-on-database",
        frontendId: item.data.id as FrontendId,
        databaseId: item.data.id as DatabaseId,
      };
    }
  });
};

export const afterClip = (id: string): FrontendInsertionPoint => ({
  type: "after-clip",
  frontendClipId: id as FrontendId,
});

export const afterSection = (id: string): FrontendInsertionPoint => ({
  type: "after-chapter",
  frontendChapterId: id as FrontendId,
});

export const start: FrontendInsertionPoint = { type: "start" };
