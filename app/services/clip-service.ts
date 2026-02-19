/**
 * ClipService - Deep module with RPC transport for clip operations
 *
 * This service provides a simple, typed, Promise-based interface for all clip
 * and clip-section operations. The frontend calls typed methods, and internally
 * these are dispatched through an RPC-style transport.
 *
 * Two transports are available:
 * - HTTP transport (production): Single fetch to /clip-service route
 * - Direct transport (tests): Calls handler directly with PGlite
 */

import type { InferSelectModel } from "drizzle-orm";
import type { clips, clipSections, videos } from "@/db/schema";

// ============================================================================
// Database Types
// ============================================================================

export type Clip = InferSelectModel<typeof clips>;
export type ClipSection = InferSelectModel<typeof clipSections>;
export type Video = InferSelectModel<typeof videos>;

// ============================================================================
// Insertion Point Types
// ============================================================================

/**
 * Insertion point for clips - where to insert in the timeline.
 * Used by appendClips and createClipSectionAtInsertionPoint.
 */
export type InsertionPoint =
  | { type: "start" }
  | { type: "after-clip"; databaseClipId: string }
  | { type: "after-clip-section"; clipSectionId: string };

/**
 * Position for creating clip sections relative to a target item.
 * Used by createClipSectionAtPosition.
 */
export type Position = "before" | "after";
export type TargetItemType = "clip" | "clip-section";

// ============================================================================
// Timeline Types
// ============================================================================

/**
 * Unified timeline item - either a clip or a clip section.
 * Returned by getTimeline, sorted by order.
 */
export type TimelineItem =
  | { type: "clip"; data: Clip }
  | { type: "clip-section"; data: ClipSection };

// ============================================================================
// Direction Types
// ============================================================================

export type ReorderDirection = "up" | "down";

// ============================================================================
// Input Types for Methods
// ============================================================================

export interface AppendClipsInput {
  videoId: string;
  insertionPoint: InsertionPoint;
  clips: readonly {
    inputVideo: string;
    startTime: number;
    endTime: number;
  }[];
}

export interface AppendFromObsInput {
  videoId: string;
  filePath?: string;
  insertionPoint: InsertionPoint;
}

export interface UpdateClipInput {
  id: string;
  scene: string;
  profile: string;
  beatType: string;
}

export interface CreateClipSectionAtInsertionPointInput {
  videoId: string;
  name: string;
  insertionPoint: InsertionPoint;
}

export interface CreateClipSectionAtPositionInput {
  videoId: string;
  name: string;
  position: Position;
  targetItemId: string;
  targetItemType: TargetItemType;
}

// ============================================================================
// ClipService Interface
// ============================================================================

/**
 * The main ClipService interface. All methods return Promises.
 * No Effect.ts types are exposed to consumers.
 */
export interface ClipService {
  // Video fixture (primarily for tests)
  createVideo(path: string): Promise<Video>;

  // Timeline
  getTimeline(videoId: string): Promise<TimelineItem[]>;

  // Clip operations
  appendClips(input: AppendClipsInput): Promise<Clip[]>;
  appendFromObs(input: AppendFromObsInput): Promise<Clip[]>;
  archiveClips(clipIds: string[]): Promise<void>;
  updateClips(clips: UpdateClipInput[]): Promise<void>;
  updateBeat(clipId: string, beatType: string): Promise<void>;
  reorderClip(clipId: string, direction: ReorderDirection): Promise<void>;

  // Clip section operations
  createClipSectionAtInsertionPoint(
    input: CreateClipSectionAtInsertionPointInput
  ): Promise<ClipSection>;
  createClipSectionAtPosition(
    input: CreateClipSectionAtPositionInput
  ): Promise<ClipSection>;
  updateClipSection(clipSectionId: string, name: string): Promise<void>;
  archiveClipSections(clipSectionIds: string[]): Promise<void>;
  reorderClipSection(
    clipSectionId: string,
    direction: ReorderDirection
  ): Promise<void>;
}

// ============================================================================
// RPC Event Types (Internal)
// ============================================================================

/**
 * Discriminated union of all ClipService operations.
 * This is an internal implementation detail - not exported to consumers.
 */
export type ClipServiceEvent =
  | { type: "create-video"; path: string }
  | { type: "get-timeline"; videoId: string }
  | { type: "append-clips"; input: AppendClipsInput }
  | { type: "append-from-obs"; input: AppendFromObsInput }
  | { type: "archive-clips"; clipIds: string[] }
  | { type: "update-clips"; clips: UpdateClipInput[] }
  | { type: "update-beat"; clipId: string; beatType: string }
  | { type: "reorder-clip"; clipId: string; direction: ReorderDirection }
  | {
      type: "create-clip-section-at-insertion-point";
      input: CreateClipSectionAtInsertionPointInput;
    }
  | {
      type: "create-clip-section-at-position";
      input: CreateClipSectionAtPositionInput;
    }
  | { type: "update-clip-section"; clipSectionId: string; name: string }
  | { type: "archive-clip-sections"; clipSectionIds: string[] }
  | {
      type: "reorder-clip-section";
      clipSectionId: string;
      direction: ReorderDirection;
    };

// ============================================================================
// Transport Type
// ============================================================================

/**
 * Transport function signature. Takes an event, returns a Promise of the result.
 * HTTP transport sends to /clip-service route.
 * Direct transport calls handler directly.
 */
export type ClipServiceTransport = (
  event: ClipServiceEvent
) => Promise<unknown>;

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Creates a ClipService instance using the provided transport.
 * This is the internal factory - consumers use createHttpClipService() or
 * createDirectClipService() instead.
 */
export function createClipService(send: ClipServiceTransport): ClipService {
  return {
    async createVideo(path) {
      return send({ type: "create-video", path }) as Promise<Video>;
    },

    async getTimeline(videoId) {
      return send({ type: "get-timeline", videoId }) as Promise<TimelineItem[]>;
    },

    async appendClips(input) {
      return send({ type: "append-clips", input }) as Promise<Clip[]>;
    },

    async appendFromObs(input) {
      return send({ type: "append-from-obs", input }) as Promise<Clip[]>;
    },

    async archiveClips(clipIds) {
      await send({ type: "archive-clips", clipIds });
    },

    async updateClips(clips) {
      await send({ type: "update-clips", clips });
    },

    async updateBeat(clipId, beatType) {
      await send({ type: "update-beat", clipId, beatType });
    },

    async reorderClip(clipId, direction) {
      await send({ type: "reorder-clip", clipId, direction });
    },

    async createClipSectionAtInsertionPoint(input) {
      return send({
        type: "create-clip-section-at-insertion-point",
        input,
      }) as Promise<ClipSection>;
    },

    async createClipSectionAtPosition(input) {
      return send({
        type: "create-clip-section-at-position",
        input,
      }) as Promise<ClipSection>;
    },

    async updateClipSection(clipSectionId, name) {
      await send({ type: "update-clip-section", clipSectionId, name });
    },

    async archiveClipSections(clipSectionIds) {
      await send({ type: "archive-clip-sections", clipSectionIds });
    },

    async reorderClipSection(clipSectionId, direction) {
      await send({ type: "reorder-clip-section", clipSectionId, direction });
    },
  };
}
