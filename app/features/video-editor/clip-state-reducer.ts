import type { DB } from "@/db/schema";
import type { BeatType } from "@/services/tt-cli-service";
import type { EffectReducer } from "use-effect-reducer";
import type { Brand } from "./utils";

export type DatabaseId = Brand<string, "DatabaseId">;
export type FrontendId = Brand<string, "FrontendId">;
export type FrontendInsertionPoint =
  | {
      type: "start";
    }
  | {
      type: "after-clip";
      frontendClipId: FrontendId;
    }
  | {
      type: "after-clip-section";
      frontendClipSectionId: FrontendId;
    }
  | {
      type: "end";
    };

export type ClipOnDatabase = {
  type: "on-database";
  frontendId: FrontendId;
  databaseId: DatabaseId;
  videoFilename: string;
  sourceStartTime: number; // Start time in source video (seconds)
  sourceEndTime: number; // End time in source video (seconds)
  text: string;
  transcribedAt: Date | null;
  scene: string | null;
  profile: string | null;
  insertionOrder: number | null;
  beatType: BeatType;
};

export type ClipOptimisticallyAdded = {
  type: "optimistically-added";
  frontendId: FrontendId;
  scene: string;
  profile: string;
  /**
   * An integer, incremented each time a new optimistically added clip is added.
   * Used to determine which clips should be paired with which database clips,
   * and to handle the deletion of the latest inserted clip.
   */
  insertionOrder: number;
  /**
   * If true, when the optimistically added clip is replaced with the database clip,
   * the clip will be archived. Allows the user to delete the clip before it's transcribed.
   */
  shouldArchive?: boolean;
  beatType: BeatType;
  /**
   * Unique ID for the sound detection that triggered this clip.
   * Used for deduplication - prevents duplicate clips from React StrictMode double-firing.
   */
  soundDetectionId: string;
};

export const createFrontendId = (): FrontendId => {
  return crypto.randomUUID() as FrontendId;
};

export type Clip = ClipOnDatabase | ClipOptimisticallyAdded;

export type ClipSectionOnDatabase = {
  type: "clip-section-on-database";
  frontendId: FrontendId;
  databaseId: DatabaseId;
  name: string;
  insertionOrder: number | null;
};

export type ClipSectionOptimisticallyAdded = {
  type: "clip-section-optimistically-added";
  frontendId: FrontendId;
  name: string;
  insertionOrder: number;
  shouldArchive?: boolean;
};

export type ClipSection =
  | ClipSectionOnDatabase
  | ClipSectionOptimisticallyAdded;

export type TimelineItem = Clip | ClipSection;

export type EditorError = {
  message: string;
  effectType: string;
  timestamp: number;
};

export namespace clipStateReducer {
  export type State = {
    items: TimelineItem[];
    clipIdsBeingTranscribed: Set<FrontendId>;
    insertionPoint: FrontendInsertionPoint;
    insertionOrder: number;
    /**
     * When set, indicates a fatal error has occurred in the video editor.
     * The editor should display an error overlay and require a page refresh.
     */
    error: EditorError | null;
  };

  export type Action =
    | {
        type: "new-optimistic-clip-detected";
        scene: string;
        profile: string;
        soundDetectionId: string;
      }
    | {
        type: "new-database-clips";
        clips: DB.Clip[];
      }
    | {
        type: "clips-deleted";
        clipIds: FrontendId[];
      }
    | {
        type: "clips-transcribed";
        clips: {
          databaseId: DatabaseId;
          text: string;
        }[];
      }
    | {
        type: "set-insertion-point-after";
        clipId: FrontendId;
      }
    | {
        type: "set-insertion-point-before";
        clipId: FrontendId;
      }
    | {
        type: "delete-latest-inserted-clip";
      }
    | {
        type: "toggle-beat-at-insertion-point";
      }
    | {
        type: "toggle-beat-for-clip";
        clipId: FrontendId;
      }
    | {
        type: "move-clip";
        clipId: FrontendId;
        direction: "up" | "down";
      }
    | {
        type: "add-clip-section";
        name: string;
      }
    | {
        type: "update-clip-section";
        clipSectionId: FrontendId;
        name: string;
      }
    | {
        type: "add-clip-section-at";
        name: string;
        position: "before" | "after";
        itemId: FrontendId;
      }
    | {
        type: "clip-section-created";
        frontendId: FrontendId;
        databaseId: DatabaseId;
      }
    | {
        type: "effect-failed";
        effectType: string;
        message: string;
      };

  export type Effect =
    | {
        type: "transcribe-clips";
        clipIds: DatabaseId[];
      }
    | {
        type: "archive-clips";
        clipIds: DatabaseId[];
      }
    | {
        type: "scroll-to-insertion-point";
      }
    | {
        type: "update-clips";
        clips: [
          DatabaseId,
          { scene: string; profile: string; beatType: BeatType },
        ][];
      }
    | {
        type: "update-beat";
        clipId: DatabaseId;
        beatType: BeatType;
      }
    | {
        type: "reorder-clip";
        clipId: DatabaseId;
        direction: "up" | "down";
      }
    | {
        type: "reorder-clip-section";
        clipSectionId: DatabaseId;
        direction: "up" | "down";
      }
    | {
        type: "archive-clip-sections";
        clipSectionIds: DatabaseId[];
      }
    | {
        type: "create-clip-section";
        frontendId: FrontendId;
        name: string;
        insertionPoint: FrontendInsertionPoint;
      }
    | {
        type: "update-clip-section";
        clipSectionId: DatabaseId;
        name: string;
      }
    | {
        type: "create-clip-section-at";
        frontendId: FrontendId;
        name: string;
        position: "before" | "after";
        targetItemId: DatabaseId;
        targetItemType: "clip" | "clip-section";
      };
}

export const clipStateReducer: EffectReducer<
  clipStateReducer.State,
  clipStateReducer.Action,
  clipStateReducer.Effect
> = (
  state: clipStateReducer.State,
  action: clipStateReducer.Action,
  exec
): clipStateReducer.State => {
  switch (action.type) {
    case "new-optimistic-clip-detected": {
      // Check if clip with same soundDetectionId already exists (deduplication for React StrictMode)
      const existingClip = state.items.find(
        (c) =>
          c.type === "optimistically-added" &&
          c.soundDetectionId === action.soundDetectionId
      );
      if (existingClip) {
        return state;
      }

      const newFrontendId = createFrontendId();
      const newClip: ClipOptimisticallyAdded = {
        type: "optimistically-added",
        frontendId: newFrontendId,
        scene: action.scene,
        profile: action.profile,
        insertionOrder: state.insertionOrder + 1,
        beatType: "none",
        soundDetectionId: action.soundDetectionId,
      };

      let newInsertionPoint: FrontendInsertionPoint = state.insertionPoint;

      let newClips: TimelineItem[];
      if (state.insertionPoint.type === "end") {
        // Append to end
        newClips = [...state.items, newClip];
      } else if (state.insertionPoint.type === "start") {
        // Insert at start
        newClips = [newClip, ...state.items];
        newInsertionPoint = {
          type: "after-clip",
          frontendClipId: newFrontendId,
        };
      } else if (state.insertionPoint.type === "after-clip") {
        const targetClipId = state.insertionPoint.frontendClipId;
        // Insert at insertion point
        const insertionPointIndex = state.items.findIndex(
          (c) => c.frontendId === targetClipId
        );
        if (insertionPointIndex === -1) {
          throw new Error("Target clip not found when inserting after");
        }
        newClips = [
          ...state.items.slice(0, insertionPointIndex + 1),
          newClip,
          ...state.items.slice(insertionPointIndex + 1),
        ];
        newInsertionPoint = {
          type: "after-clip",
          frontendClipId: newFrontendId,
        };
      } else {
        // after-clip-section
        const targetClipSectionId = state.insertionPoint.frontendClipSectionId;
        // Insert at insertion point
        const insertionPointIndex = state.items.findIndex(
          (c) => c.frontendId === targetClipSectionId
        );
        if (insertionPointIndex === -1) {
          throw new Error("Target clip section not found when inserting after");
        }
        newClips = [
          ...state.items.slice(0, insertionPointIndex + 1),
          newClip,
          ...state.items.slice(insertionPointIndex + 1),
        ];
        newInsertionPoint = {
          type: "after-clip",
          frontendClipId: newFrontendId,
        };
      }

      exec({
        type: "scroll-to-insertion-point",
      });

      return {
        ...state,
        items: newClips,
        insertionOrder: state.insertionOrder + 1,
        insertionPoint: newInsertionPoint,
      };
    }
    case "new-database-clips": {
      let shouldScrollToBottom = false;

      let newClipsState: (TimelineItem | undefined)[] = [...state.items];

      const clipsToArchive = new Set<DatabaseId>();
      const databaseClipIdsToTranscribe = new Set<DatabaseId>();
      const frontendClipIdsToTranscribe = new Set<FrontendId>();
      const clipsToUpdateScene = new Map<
        DatabaseId,
        { scene: string; profile: string; beatType: BeatType }
      >();

      let newInsertionPoint: FrontendInsertionPoint = state.insertionPoint;

      const optimisticClipsSortedByInsertionOrder = newClipsState
        .filter((c) => c?.type === "optimistically-added")
        .sort((a, b) => {
          return a.insertionOrder! - b.insertionOrder!;
        });

      for (const databaseClip of action.clips) {
        const firstOfSortedClips =
          optimisticClipsSortedByInsertionOrder.shift();
        // Find the first optimistically added clip
        const index = newClipsState.findIndex(
          (c) =>
            c?.type === "optimistically-added" &&
            c.insertionOrder === firstOfSortedClips?.insertionOrder
        );

        // If there is a first optimistically added clip, we need to pair it with the database clip
        if (firstOfSortedClips) {
          const frontendClip = newClipsState[index];
          // If the optimistically added clip should be archived, archive the database clip
          if (
            frontendClip?.type === "optimistically-added" &&
            frontendClip?.shouldArchive
          ) {
            clipsToArchive.add(databaseClip.id);
            newClipsState[index] = undefined;
          } else if (frontendClip?.type === "optimistically-added") {
            const newDatabaseClip: ClipOnDatabase = {
              ...databaseClip,
              type: "on-database",
              frontendId: frontendClip.frontendId,
              databaseId: databaseClip.id,
              scene: frontendClip.scene,
              profile: frontendClip.profile,
              insertionOrder: frontendClip.insertionOrder,
              beatType: frontendClip.beatType,
            };
            newClipsState[index] = newDatabaseClip;
            clipsToUpdateScene.set(databaseClip.id, {
              scene: frontendClip.scene,
              profile: frontendClip.profile,
              beatType: frontendClip.beatType,
            });
            frontendClipIdsToTranscribe.add(frontendClip.frontendId);
            databaseClipIdsToTranscribe.add(databaseClip.id);
          }
        } else {
          const newFrontendId = createFrontendId();

          const newDatabaseClip: ClipOnDatabase = {
            type: "on-database",
            ...databaseClip,
            frontendId: newFrontendId,
            databaseId: databaseClip.id,
            insertionOrder: state.insertionOrder + 1,
            beatType: databaseClip.beatType as BeatType,
          };

          const result = insertClip(
            newClipsState,
            newDatabaseClip,
            state.insertionPoint
          );

          newClipsState = result.clips;
          newInsertionPoint = result.insertionPoint;

          frontendClipIdsToTranscribe.add(newFrontendId);
          databaseClipIdsToTranscribe.add(databaseClip.id);

          shouldScrollToBottom = true;
        }
      }

      if (clipsToUpdateScene.size > 0) {
        exec({
          type: "update-clips",
          clips: Array.from(clipsToUpdateScene.entries()),
        });
      }

      if (shouldScrollToBottom) {
        exec({
          type: "scroll-to-insertion-point",
        });
      }

      if (clipsToArchive.size > 0) {
        exec({
          type: "archive-clips",
          clipIds: Array.from(clipsToArchive),
        });
      }

      if (databaseClipIdsToTranscribe.size > 0) {
        exec({
          type: "transcribe-clips",
          clipIds: Array.from(databaseClipIdsToTranscribe),
        });
      }

      return {
        ...state,
        clipIdsBeingTranscribed: new Set([
          ...Array.from(state.clipIdsBeingTranscribed),
          ...Array.from(frontendClipIdsToTranscribe),
        ]),
        items: newClipsState.filter((c) => c !== undefined),
        insertionPoint: newInsertionPoint,
      };
    }
    case "clips-deleted": {
      const { items, clipsToArchive, clipSectionsToArchive, insertionPoint } =
        archiveClips(state.items, action.clipIds, state.insertionPoint);

      if (clipsToArchive.size > 0) {
        exec({
          type: "archive-clips",
          clipIds: Array.from(clipsToArchive),
        });
      }
      if (clipSectionsToArchive.size > 0) {
        exec({
          type: "archive-clip-sections",
          clipSectionIds: Array.from(clipSectionsToArchive),
        });
      }
      return {
        ...state,
        items,
        insertionPoint: insertionPoint,
      };
    }
    case "clips-transcribed": {
      const set = new Set([...state.clipIdsBeingTranscribed]);

      const textMap: Record<DatabaseId, string> = action.clips.reduce(
        (acc, clip) => {
          acc[clip.databaseId] = clip.text;
          return acc;
        },
        {} as Record<DatabaseId, string>
      );

      return {
        ...state,
        items: state.items.map((item) => {
          if (item.type === "on-database" && textMap[item.databaseId]) {
            set.delete(item.frontendId);
            return { ...item, text: textMap[item.databaseId]! };
          }
          return item;
        }),
        clipIdsBeingTranscribed: set,
      };
    }
    case "set-insertion-point-after": {
      const item = state.items.find((c) => c.frontendId === action.clipId);
      if (!item) {
        return state;
      }

      // Set insertion point based on item type
      let insertionPoint: FrontendInsertionPoint;
      if (item.type === "on-database" || item.type === "optimistically-added") {
        insertionPoint = {
          type: "after-clip",
          frontendClipId: action.clipId,
        };
      } else {
        insertionPoint = {
          type: "after-clip-section",
          frontendClipSectionId: action.clipId,
        };
      }

      return {
        ...state,
        insertionPoint,
      };
    }
    case "set-insertion-point-before": {
      const item = state.items.find((c) => c.frontendId === action.clipId);
      if (!item) {
        return state;
      }

      // If inserting before, we need to find the previous item's frontendId
      // to use as insertAfterId, OR use INSERTION_POINT_START if this is first item
      const itemIndex = state.items.findIndex(
        (c) => c.frontendId === action.clipId
      );

      let insertionPoint: FrontendInsertionPoint;
      if (itemIndex === 0) {
        // First item - use start
        insertionPoint = { type: "start" };
      } else {
        // Not first item - use previous item's frontendId based on its type
        const previousItem = state.items[itemIndex - 1];

        if (previousItem) {
          if (
            previousItem.type === "on-database" ||
            previousItem.type === "optimistically-added"
          ) {
            insertionPoint = {
              type: "after-clip",
              frontendClipId: previousItem.frontendId,
            };
          } else {
            insertionPoint = {
              type: "after-clip-section",
              frontendClipSectionId: previousItem.frontendId,
            };
          }
        } else {
          throw new Error("Previous item not found when inserting before");
        }
      }

      return {
        ...state,
        insertionPoint,
      };
    }
    case "delete-latest-inserted-clip": {
      if (state.insertionPoint.type === "start") {
        return state;
      }

      if (state.insertionPoint.type === "end") {
        const lastClip = state.items[state.items.length - 1];

        if (!lastClip) {
          return state;
        }
        const { items, clipsToArchive, clipSectionsToArchive, insertionPoint } =
          archiveClips(
            state.items,
            [lastClip.frontendId],
            state.insertionPoint
          );

        if (clipsToArchive.size > 0) {
          exec({
            type: "archive-clips",
            clipIds: Array.from(clipsToArchive),
          });
        }
        if (clipSectionsToArchive.size > 0) {
          exec({
            type: "archive-clip-sections",
            clipSectionIds: Array.from(clipSectionsToArchive),
          });
        }

        return {
          ...state,
          items,
          insertionPoint,
        };
      }

      const clipIdToArchive =
        state.insertionPoint.type === "after-clip"
          ? state.insertionPoint.frontendClipId
          : state.insertionPoint.frontendClipSectionId;

      const archiveResult = archiveClips(
        state.items,
        [clipIdToArchive],
        state.insertionPoint
      );

      if (archiveResult.clipsToArchive.size > 0) {
        exec({
          type: "archive-clips",
          clipIds: Array.from(archiveResult.clipsToArchive),
        });
      }
      if (archiveResult.clipSectionsToArchive.size > 0) {
        exec({
          type: "archive-clip-sections",
          clipSectionIds: Array.from(archiveResult.clipSectionsToArchive),
        });
      }

      return {
        ...state,
        items: archiveResult.items,
        insertionPoint: archiveResult.insertionPoint,
      };
    }
    case "toggle-beat-at-insertion-point": {
      // Find the clip at the insertion point (similar to delete-latest-inserted-clip)
      let clipToToggle: Clip | undefined;

      if (state.insertionPoint.type === "start") {
        // No clip before start
        return state;
      }

      if (state.insertionPoint.type === "end") {
        const lastItem = state.items[state.items.length - 1];
        if (
          lastItem &&
          (lastItem.type === "on-database" ||
            lastItem.type === "optimistically-added")
        ) {
          clipToToggle = lastItem;
        }
      } else if (state.insertionPoint.type === "after-clip") {
        const targetFrontendId = state.insertionPoint.frontendClipId;
        const item = state.items.find((c) => c.frontendId === targetFrontendId);
        if (
          item &&
          (item.type === "on-database" || item.type === "optimistically-added")
        ) {
          clipToToggle = item;
        }
      } else if (state.insertionPoint.type === "after-clip-section") {
        // Don't toggle beat for clip sections
        return state;
      }

      if (!clipToToggle) {
        return state;
      }

      const newBeatType: BeatType =
        clipToToggle.beatType === "none" ? "long" : "none";

      // If it's a database clip, fire an effect to update the DB
      if (clipToToggle.type === "on-database") {
        exec({
          type: "update-beat",
          clipId: clipToToggle.databaseId,
          beatType: newBeatType,
        });
      }

      return {
        ...state,
        items: state.items.map((item) =>
          item.frontendId === clipToToggle!.frontendId &&
          (item.type === "on-database" || item.type === "optimistically-added")
            ? { ...item, beatType: newBeatType }
            : item
        ),
      };
    }
    case "toggle-beat-for-clip": {
      const item = state.items.find((c) => c.frontendId === action.clipId);

      if (
        !item ||
        (item.type !== "on-database" && item.type !== "optimistically-added")
      ) {
        return state;
      }

      const clipToToggle = item;
      const newBeatType: BeatType =
        clipToToggle.beatType === "none" ? "long" : "none";

      // If it's a database clip, fire an effect to update the DB
      if (clipToToggle.type === "on-database") {
        exec({
          type: "update-beat",
          clipId: clipToToggle.databaseId,
          beatType: newBeatType,
        });
      }

      return {
        ...state,
        items: state.items.map((item) =>
          item.frontendId === action.clipId &&
          (item.type === "on-database" || item.type === "optimistically-added")
            ? { ...item, beatType: newBeatType }
            : item
        ),
      };
    }
    case "move-clip": {
      const clipIndex = state.items.findIndex(
        (c) => c.frontendId === action.clipId
      );

      if (clipIndex === -1) {
        return state;
      }

      const item = state.items[clipIndex]!;
      const targetIndex =
        action.direction === "up" ? clipIndex - 1 : clipIndex + 1;

      // Check boundaries
      if (targetIndex < 0 || targetIndex >= state.items.length) {
        return state;
      }

      // Swap items in the array
      const newItems = [...state.items];
      newItems[clipIndex] = newItems[targetIndex]!;
      newItems[targetIndex] = item;

      // Fire effect to update database based on item type
      if (item.type === "on-database") {
        exec({
          type: "reorder-clip",
          clipId: item.databaseId,
          direction: action.direction,
        });
      } else if (item.type === "clip-section-on-database") {
        exec({
          type: "reorder-clip-section",
          clipSectionId: item.databaseId,
          direction: action.direction,
        });
      }

      return {
        ...state,
        items: newItems,
      };
    }
    case "add-clip-section": {
      const newFrontendId = createFrontendId();
      const newClipSection: ClipSectionOptimisticallyAdded = {
        type: "clip-section-optimistically-added",
        frontendId: newFrontendId,
        name: action.name,
        insertionOrder: state.insertionOrder + 1,
      };

      let newInsertionPoint: FrontendInsertionPoint = {
        type: "after-clip-section",
        frontendClipSectionId: newFrontendId,
      };

      let newItems: TimelineItem[];
      if (state.insertionPoint.type === "end") {
        // Append to end
        newItems = [...state.items, newClipSection];
      } else if (state.insertionPoint.type === "start") {
        // Insert at start
        newItems = [newClipSection, ...state.items];
      } else if (state.insertionPoint.type === "after-clip") {
        const targetClipId = state.insertionPoint.frontendClipId;
        const insertionPointIndex = state.items.findIndex(
          (c) => c.frontendId === targetClipId
        );
        if (insertionPointIndex === -1) {
          throw new Error(
            "Target clip not found when inserting clip section after"
          );
        }
        newItems = [
          ...state.items.slice(0, insertionPointIndex + 1),
          newClipSection,
          ...state.items.slice(insertionPointIndex + 1),
        ];
      } else {
        // after-clip-section
        const targetClipSectionId = state.insertionPoint.frontendClipSectionId;
        const insertionPointIndex = state.items.findIndex(
          (c) => c.frontendId === targetClipSectionId
        );
        if (insertionPointIndex === -1) {
          throw new Error(
            "Target clip section not found when inserting clip section after"
          );
        }
        newItems = [
          ...state.items.slice(0, insertionPointIndex + 1),
          newClipSection,
          ...state.items.slice(insertionPointIndex + 1),
        ];
      }

      exec({
        type: "create-clip-section",
        frontendId: newFrontendId,
        name: action.name,
        insertionPoint: state.insertionPoint,
      });

      exec({
        type: "scroll-to-insertion-point",
      });

      return {
        ...state,
        items: newItems,
        insertionOrder: state.insertionOrder + 1,
        insertionPoint: newInsertionPoint,
      };
    }
    case "update-clip-section": {
      const clipSection = state.items.find(
        (item) => item.frontendId === action.clipSectionId
      );
      if (
        !clipSection ||
        (clipSection.type !== "clip-section-on-database" &&
          clipSection.type !== "clip-section-optimistically-added")
      ) {
        return state;
      }

      // Only fire effect for database clip sections
      if (clipSection.type === "clip-section-on-database") {
        exec({
          type: "update-clip-section",
          clipSectionId: clipSection.databaseId,
          name: action.name,
        });
      }

      return {
        ...state,
        items: state.items.map((item) => {
          if (item.frontendId === action.clipSectionId) {
            return { ...item, name: action.name };
          }
          return item;
        }),
      };
    }
    case "add-clip-section-at": {
      const targetItem = state.items.find(
        (item) => item.frontendId === action.itemId
      );
      if (!targetItem) {
        return state;
      }

      const targetIndex = state.items.findIndex(
        (item) => item.frontendId === action.itemId
      );

      const newFrontendId = createFrontendId();
      const newClipSection: ClipSectionOptimisticallyAdded = {
        type: "clip-section-optimistically-added",
        frontendId: newFrontendId,
        name: action.name,
        insertionOrder: state.insertionOrder + 1,
      };

      // Insert at the correct position
      let newItems: TimelineItem[];
      if (action.position === "before") {
        newItems = [
          ...state.items.slice(0, targetIndex),
          newClipSection,
          ...state.items.slice(targetIndex),
        ];
      } else {
        // after
        newItems = [
          ...state.items.slice(0, targetIndex + 1),
          newClipSection,
          ...state.items.slice(targetIndex + 1),
        ];
      }

      // Fire the appropriate effect based on whether the target has a database ID
      if (
        targetItem.type === "on-database" ||
        targetItem.type === "clip-section-on-database"
      ) {
        const targetDatabaseId = targetItem.databaseId;
        const targetItemType: "clip" | "clip-section" =
          targetItem.type === "on-database" ? "clip" : "clip-section";
        exec({
          type: "create-clip-section-at",
          frontendId: newFrontendId,
          name: action.name,
          position: action.position,
          targetItemId: targetDatabaseId,
          targetItemType: targetItemType,
        });
      } else {
        // For optimistically added items, calculate the insertion point
        let insertionPoint: FrontendInsertionPoint;
        if (action.position === "after") {
          if (targetItem.type === "clip-section-optimistically-added") {
            insertionPoint = {
              type: "after-clip-section",
              frontendClipSectionId: targetItem.frontendId,
            };
          } else {
            insertionPoint = {
              type: "after-clip",
              frontendClipId: targetItem.frontendId,
            };
          }
        } else {
          // "before" - use the item before the target as insertion point
          if (targetIndex === 0) {
            insertionPoint = { type: "start" };
          } else {
            const prevItem = state.items[targetIndex - 1]!;
            if (
              prevItem.type === "on-database" ||
              prevItem.type === "optimistically-added"
            ) {
              insertionPoint = {
                type: "after-clip",
                frontendClipId: prevItem.frontendId,
              };
            } else {
              insertionPoint = {
                type: "after-clip-section",
                frontendClipSectionId: prevItem.frontendId,
              };
            }
          }
        }
        exec({
          type: "create-clip-section",
          frontendId: newFrontendId,
          name: action.name,
          insertionPoint,
        });
      }

      // Don't scroll when adding section via context menu - user is organizing content
      // and doesn't expect to be scrolled around

      return {
        ...state,
        items: newItems,
        insertionOrder: state.insertionOrder + 1,
        // Don't move insertion point - user is just organizing content via context menu
      };
    }
    case "clip-section-created": {
      return {
        ...state,
        items: state.items.map((item) => {
          if (
            item.frontendId === action.frontendId &&
            item.type === "clip-section-optimistically-added"
          ) {
            const onDatabase: ClipSectionOnDatabase = {
              type: "clip-section-on-database",
              frontendId: item.frontendId,
              databaseId: action.databaseId,
              name: item.name,
              insertionOrder: item.insertionOrder,
            };
            return onDatabase;
          }
          return item;
        }),
      };
    }
    case "effect-failed": {
      return {
        ...state,
        error: {
          message: action.message,
          effectType: action.effectType,
          timestamp: Date.now(),
        },
      };
    }
  }
  return state;
};

const insertClip = (
  items: (TimelineItem | undefined)[],
  newClip: Clip,
  insertionPoint: FrontendInsertionPoint
) => {
  let newInsertionPoint: FrontendInsertionPoint = insertionPoint;

  let newItems: (TimelineItem | undefined)[];
  if (insertionPoint.type === "end") {
    // Append to end
    newItems = [...items, newClip];
  } else if (insertionPoint.type === "start") {
    // Insert at start
    newItems = [newClip, ...items];
    newInsertionPoint = {
      type: "after-clip",
      frontendClipId: newClip.frontendId,
    };
  } else if (insertionPoint.type === "after-clip") {
    const targetClipId = insertionPoint.frontendClipId;
    // Insert at insertion point
    const insertionPointIndex = items.findIndex(
      (c) => c?.frontendId === targetClipId
    );
    if (insertionPointIndex === -1) {
      throw new Error("Target clip not found when inserting after");
    }
    newItems = [
      ...items.slice(0, insertionPointIndex + 1),
      newClip,
      ...items.slice(insertionPointIndex + 1),
    ];
    newInsertionPoint = {
      type: "after-clip",
      frontendClipId: targetClipId,
    };
  } else if (insertionPoint.type === "after-clip-section") {
    const targetClipSectionId = insertionPoint.frontendClipSectionId;
    // Insert at insertion point
    const insertionPointIndex = items.findIndex(
      (c) => c?.frontendId === targetClipSectionId
    );
    if (insertionPointIndex === -1) {
      throw new Error("Target clip section not found when inserting after");
    }
    newItems = [
      ...items.slice(0, insertionPointIndex + 1),
      newClip,
      ...items.slice(insertionPointIndex + 1),
    ];
    newInsertionPoint = {
      type: "after-clip",
      frontendClipId: newClip.frontendId,
    };
  } else {
    throw new Error("Unknown insertion point type");
  }

  return {
    clips: newItems,
    insertionPoint: newInsertionPoint,
  };
};

type ArchiveClipMode =
  | {
      type: "move-insertion-point-to-previous-clip";
      originalClipIndex: number;
    }
  | {
      type: "do-nothing";
    };

const archiveClips = (
  allItems: TimelineItem[],
  frontendIds: FrontendId[],
  insertionPoint: FrontendInsertionPoint
): {
  items: TimelineItem[];
  insertionPoint: FrontendInsertionPoint;
  clipsToArchive: Set<DatabaseId>;
  clipSectionsToArchive: Set<DatabaseId>;
} => {
  const clipsToArchive = new Set<DatabaseId>();
  const clipSectionsToArchive = new Set<DatabaseId>();

  let archiveClipMode: ArchiveClipMode;

  if (
    insertionPoint.type === "after-clip" &&
    frontendIds.includes(insertionPoint.frontendClipId)
  ) {
    const clipId = insertionPoint.frontendClipId;
    const prevClipIndex = allItems.findIndex((c) => c.frontendId === clipId);
    if (prevClipIndex === -1) {
      throw new Error("Previous clip not found when archiving");
    }
    archiveClipMode = {
      type: "move-insertion-point-to-previous-clip",
      originalClipIndex: prevClipIndex,
    };
  } else if (
    insertionPoint.type === "after-clip-section" &&
    frontendIds.includes(insertionPoint.frontendClipSectionId)
  ) {
    const clipSectionId = insertionPoint.frontendClipSectionId;
    const prevClipIndex = allItems.findIndex(
      (c) => c.frontendId === clipSectionId
    );
    if (prevClipIndex === -1) {
      throw new Error("Previous clip section not found when archiving");
    }
    archiveClipMode = {
      type: "move-insertion-point-to-previous-clip",
      originalClipIndex: prevClipIndex,
    };
  } else {
    archiveClipMode = {
      type: "do-nothing",
    };
  }

  const items: (TimelineItem | undefined)[] = [...allItems];
  for (const clipId of frontendIds) {
    const index = items.findIndex((c) => c?.frontendId === clipId);
    if (index === -1) continue;

    const itemToReplace = items[index]!;
    if (itemToReplace.type === "optimistically-added") {
      itemToReplace.shouldArchive = true;
    } else if (itemToReplace.type === "on-database") {
      clipsToArchive.add(itemToReplace.databaseId);
      items[index] = undefined;
    } else if (itemToReplace.type === "clip-section-optimistically-added") {
      itemToReplace.shouldArchive = true;
    } else if (itemToReplace.type === "clip-section-on-database") {
      clipSectionsToArchive.add(itemToReplace.databaseId);
      items[index] = undefined;
    }
  }

  // If the insertion point is after a clip, and that clip has been deleted,
  // we need to find a candidate for the insertion point
  if (archiveClipMode.type === "move-insertion-point-to-previous-clip") {
    const slicedItems = items.slice(0, archiveClipMode.originalClipIndex);

    const previousNonUndefinedItem = slicedItems.findLast(
      (c) => c !== undefined
    );

    let newInsertionPoint: FrontendInsertionPoint;

    if (previousNonUndefinedItem) {
      if (
        previousNonUndefinedItem.type === "on-database" ||
        previousNonUndefinedItem.type === "optimistically-added"
      ) {
        newInsertionPoint = {
          type: "after-clip",
          frontendClipId: previousNonUndefinedItem.frontendId,
        };
      } else {
        newInsertionPoint = {
          type: "after-clip-section",
          frontendClipSectionId: previousNonUndefinedItem.frontendId,
        };
      }
    } else {
      newInsertionPoint = {
        type: "end",
      };
    }

    return {
      items: items.filter((c) => c !== undefined),
      insertionPoint: newInsertionPoint,
      clipsToArchive,
      clipSectionsToArchive,
    };
  }

  return {
    items: items.filter((c) => c !== undefined),
    insertionPoint: insertionPoint,
    clipsToArchive: clipsToArchive,
    clipSectionsToArchive: clipSectionsToArchive,
  };
};
