import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vitest";
import {
  clipStateReducer,
  type ClipOnDatabase,
  type ClipOptimisticallyAdded,
  type DatabaseId,
  type FrontendId,
} from "./clip-state-reducer";
import { createMockExec, ReducerTester } from "@/test-utils/reducer-tester";

const createInitialState = (
  overrides: Partial<clipStateReducer.State> = {}
): clipStateReducer.State => ({
  clipIdsBeingTranscribed: new Set(),
  items: [],
  insertionPoint: { type: "end" },
  insertionOrder: 0,
  error: null,
  sessions: [],
  ...overrides,
});

describe("clipStateReducer", () => {
  describe("Transcribing", () => {
    it("should not transcribe when a new optimistic clip is added", () => {
      const reportEffect = createMockExec();
      const newState = clipStateReducer(
        createInitialState(),
        fromPartial({
          type: "new-optimistic-clip-detected",
          soundDetectionId: "sound-1",
        }),
        reportEffect
      );

      const clipIds = newState.items.map((clip) => clip.frontendId);

      expect(reportEffect).not.toHaveBeenCalledWith({
        type: "transcribe-clips",
        clipIds,
      });
    });

    it("Should transcribe when a new database clip is added", () => {
      const reportEffect = createMockExec();
      const newState = clipStateReducer(
        createInitialState(),
        {
          type: "new-database-clips",
          clips: [
            fromPartial({
              id: "123",
              text: "",
            }),
          ],
        },
        reportEffect
      );

      expect(reportEffect).toHaveBeenCalledWith({
        type: "transcribe-clips",
        clipIds: ["123"],
      });

      expect(newState.clipIdsBeingTranscribed.size).toBe(1);

      const stateAfterTranscribe = clipStateReducer(
        newState,
        {
          type: "clips-transcribed",
          clips: [
            fromPartial({ databaseId: "123" as DatabaseId, text: "Hello" }),
          ],
        },
        reportEffect
      );

      expect(stateAfterTranscribe.clipIdsBeingTranscribed.size).toBe(0);
      expect(stateAfterTranscribe.items[0]).toMatchObject({
        text: "Hello",
      });
    });
  });

  describe("Optimistic Clips", () => {
    it("Should handle a single optimistic clip which gets replaced with a database clip", () => {
      const reportEffect1 = createMockExec();
      const stateWithOneOptimisticClip = clipStateReducer(
        createInitialState(),
        fromPartial({
          type: "new-optimistic-clip-detected",
          soundDetectionId: "sound-1",
        }),
        reportEffect1
      );

      expect(stateWithOneOptimisticClip.items[0]).toMatchObject({
        type: "optimistically-added",
      });
      expect(reportEffect1).toHaveBeenCalledWith({
        type: "scroll-to-insertion-point",
      });

      const reportEffect2 = createMockExec();
      const stateWithOneDatabaseClip = clipStateReducer(
        stateWithOneOptimisticClip,
        {
          type: "new-database-clips",
          clips: [fromPartial({ id: "123" })],
        },
        reportEffect2
      );

      expect(stateWithOneDatabaseClip.items.length).toBe(1);

      expect(stateWithOneDatabaseClip.items[0]).toMatchObject({
        type: "on-database",
        id: "123",
      });
      expect(reportEffect2).toHaveBeenCalledWith({
        type: "scroll-to-insertion-point",
      });
      expect(reportEffect2).toHaveBeenCalledWith({
        type: "transcribe-clips",
        clipIds: ["123"],
      });
    });

    it("Should handle two optimistic clips which get replaced with a database clip", () => {
      const reportEffect1 = createMockExec();
      const stateWithOneOptimisticClip = clipStateReducer(
        createInitialState(),
        fromPartial({
          type: "new-optimistic-clip-detected",
          scene: "Camera",
          profile: "Landscape",
          soundDetectionId: "sound-1",
        }),
        reportEffect1
      );

      const stateWithTwoOptimisticClips = clipStateReducer(
        stateWithOneOptimisticClip,
        fromPartial({
          type: "new-optimistic-clip-detected",
          scene: "No Face",
          profile: "Portrait",
          soundDetectionId: "sound-2",
        }),
        reportEffect1
      );

      const reportEffect2 = createMockExec();
      const stateWithOneDatabaseClip = clipStateReducer(
        stateWithTwoOptimisticClips,
        fromPartial({
          type: "new-database-clips",
          clips: [fromPartial({ id: "1" })],
        }),
        reportEffect2
      );

      expect(reportEffect2).toHaveBeenCalledWith({
        type: "update-clips",
        clips: [
          ["1", { scene: "Camera", profile: "Landscape", beatType: "none" }],
        ],
      });

      expect(stateWithOneDatabaseClip.items.length).toBe(2);
      expect(stateWithOneDatabaseClip.items[0]).toMatchObject({
        type: "on-database",
        id: "1",
      });

      const reportEffect3 = createMockExec();
      const stateWithTwoDatabaseClips = clipStateReducer(
        stateWithOneDatabaseClip,
        fromPartial({
          type: "new-database-clips",
          clips: [fromPartial({ id: "2" })],
        }),
        reportEffect3
      );

      expect(reportEffect3).toHaveBeenCalledWith({
        type: "update-clips",
        clips: [
          ["2", { scene: "No Face", profile: "Portrait", beatType: "none" }],
        ],
      });

      expect(stateWithTwoDatabaseClips.items.length).toBe(2);
      expect(stateWithTwoDatabaseClips.items[0]).toMatchObject({
        type: "on-database",
        id: "1",
      });
      expect(stateWithTwoDatabaseClips.items[1]).toMatchObject({
        type: "on-database",
        id: "2",
      });
    });

    it("If there are no optimistic clips, a new database clip should be added", () => {
      const reportEffect = createMockExec();
      const stateWithASingleDatabaseClip = clipStateReducer(
        createInitialState(),
        fromPartial({
          type: "new-database-clips",
          clips: [fromPartial({ id: "123" })],
        }),
        reportEffect
      );

      expect(stateWithASingleDatabaseClip.items.length).toBe(1);
      expect(reportEffect).toHaveBeenCalledWith({
        type: "scroll-to-insertion-point",
      });
    });
  });

  describe("Archiving Optimistically Added Clips", () => {
    it("Should archive an optimistically added clip when it is deleted", () => {
      const reportEffect = createMockExec();
      const stateWithOneOptimisticClip = clipStateReducer(
        createInitialState(),
        fromPartial({
          type: "new-optimistic-clip-detected",
          soundDetectionId: "sound-1",
        }),
        reportEffect
      );

      const optimisticClipId = stateWithOneOptimisticClip.items[0]!.frontendId;

      const stateWithOneOptimisticClipDeleted = clipStateReducer(
        stateWithOneOptimisticClip,
        fromPartial({
          type: "clips-deleted",
          clipIds: [optimisticClipId],
        }),
        reportEffect
      );

      expect(stateWithOneOptimisticClipDeleted.items[0]).toMatchObject({
        type: "optimistically-added",
        shouldArchive: true,
      });
    });

    it("Archived optimistic clips are converted to ClipOnDatabase with shouldArchive: true when DB clip arrives", () => {
      const mockExec1 = createMockExec();
      const stateWithOneOptimisticClip = clipStateReducer(
        createInitialState(),
        fromPartial({
          type: "new-optimistic-clip-detected",
          soundDetectionId: "sound-1",
        }),
        mockExec1
      );

      const optimisticClipId = stateWithOneOptimisticClip.items[0]!.frontendId;

      const mockExec2 = createMockExec();
      const stateWithOneOptimisticClipDeleted = clipStateReducer(
        stateWithOneOptimisticClip,
        {
          type: "clips-deleted",
          clipIds: [optimisticClipId],
        },
        mockExec2
      );

      const reportEffect = createMockExec();
      const finalState = clipStateReducer(
        stateWithOneOptimisticClipDeleted,
        {
          type: "new-database-clips",
          clips: [
            fromPartial({
              id: "123",
              text: "",
              videoFilename: "clip.mp4",
              sourceStartTime: 0,
              sourceEndTime: 5,
            }),
          ],
        },
        reportEffect
      );

      // Clip stays in state as ClipOnDatabase with shouldArchive: true
      expect(finalState.items.length).toBe(1);
      expect(finalState.items[0]).toMatchObject({
        type: "on-database",
        databaseId: "123",
        frontendId: optimisticClipId,
        shouldArchive: true,
      });

      // Archives the clip in the DB
      expect(reportEffect).toHaveBeenCalledWith({
        type: "archive-clips",
        clipIds: ["123"],
      });

      // Transcribes the clip so transcript text is available
      expect(reportEffect).toHaveBeenCalledWith({
        type: "transcribe-clips",
        clipIds: ["123"],
      });
    });

    it("Archived optimistic clips transfer scene/profile/beatType to the resulting ClipOnDatabase", () => {
      const mockExec1 = createMockExec();
      const stateWithOneOptimisticClip = clipStateReducer(
        createInitialState(),
        fromPartial({
          type: "new-optimistic-clip-detected",
          soundDetectionId: "sound-1",
          scene: "Camera",
          profile: "TikTok",
        }),
        mockExec1
      );

      const optimisticClipId = stateWithOneOptimisticClip.items[0]!.frontendId;

      const mockExec2 = createMockExec();
      const stateWithOneOptimisticClipDeleted = clipStateReducer(
        stateWithOneOptimisticClip,
        {
          type: "clips-deleted",
          clipIds: [optimisticClipId],
        },
        mockExec2
      );

      const reportEffect = createMockExec();
      const finalState = clipStateReducer(
        stateWithOneOptimisticClipDeleted,
        {
          type: "new-database-clips",
          clips: [fromPartial({ id: "456", text: "" })],
        },
        reportEffect
      );

      expect(finalState.items[0]).toMatchObject({
        type: "on-database",
        scene: "Camera",
        profile: "TikTok",
        beatType: "none",
        shouldArchive: true,
      });

      // Scene/profile should be updated on the server too
      expect(reportEffect).toHaveBeenCalledWith({
        type: "update-clips",
        clips: [
          ["456", { scene: "Camera", profile: "TikTok", beatType: "none" }],
        ],
      });
    });
  });

  describe("Archiving Database Clips", () => {
    it("Should archive a database clip when it is deleted", () => {
      const reportEffect1 = createMockExec();
      const stateWithOneDatabaseClip = clipStateReducer(
        createInitialState(),
        {
          type: "new-database-clips",
          clips: [fromPartial({ id: "123" })],
        },
        reportEffect1
      );

      const databaseClipId = stateWithOneDatabaseClip.items[0]!.frontendId;

      const reportEffect2 = createMockExec();
      const stateWithOneDatabaseClipDeleted = clipStateReducer(
        stateWithOneDatabaseClip,
        {
          type: "clips-deleted",
          clipIds: [databaseClipId],
        },
        reportEffect2
      );

      expect(stateWithOneDatabaseClipDeleted.items.length).toBe(0);
      expect(reportEffect2).toHaveBeenCalledWith({
        type: "archive-clips",
        clipIds: ["123"],
      });
    });
  });

  describe("Deleting Orphaned Clips", () => {
    it("Should immediately remove an orphaned clip when deleted", () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      tester
        .send({ type: "recording-started", outputPath: "/tmp/recording.mkv" })
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            soundDetectionId: "sound-1",
          })
        )
        .send({ type: "recording-stopped" });

      const sessionId = tester.getState().sessions[0]!.id;

      // Mark clip as orphaned via session-polling-complete
      tester.send({ type: "session-polling-complete", sessionId });

      const orphanedClip = tester.getState()
        .items[0] as ClipOptimisticallyAdded;
      expect(orphanedClip.isOrphaned).toBe(true);

      // Delete the orphaned clip
      tester.send({
        type: "clips-deleted",
        clipIds: [orphanedClip.frontendId],
      });

      // Clip should be completely removed, not marked as shouldArchive
      expect(tester.getState().items).toHaveLength(0);
    });
  });

  describe("Insertion Point", () => {
    it("Should allow for inserting clips at the start of the video", async () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      const stateWithClips = tester
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Scene 1",
            soundDetectionId: "sound-1",
          })
        )
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Scene 2",
            soundDetectionId: "sound-2",
          })
        )
        .getState();

      const stateWithStartInsertionPoint = tester
        .send(
          fromPartial({
            type: "set-insertion-point-before",
            clipId: stateWithClips.items[0]!.frontendId,
          })
        )
        .getState();

      expect(stateWithStartInsertionPoint.insertionPoint).toEqual({
        type: "start",
      });

      const stateWithOneMoreClip = tester
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Scene 3",
            soundDetectionId: "sound-3",
          })
        )
        .getState();

      expect(stateWithOneMoreClip.items).toMatchObject([
        {
          scene: "Scene 3",
        },
        {
          scene: "Scene 1",
        },
        {
          scene: "Scene 2",
        },
      ]);

      const stateWithTwoMoreClips = tester
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Scene 4",
            soundDetectionId: "sound-4",
          })
        )
        .getState();

      expect(stateWithTwoMoreClips.items).toMatchObject([
        {
          scene: "Scene 3",
        },
        {
          scene: "Scene 4",
        },
        {
          scene: "Scene 1",
        },
        {
          scene: "Scene 2",
        },
      ]);

      const stateWithDatabaseClips = tester
        .send({
          type: "new-database-clips",
          clips: [
            fromPartial({
              id: "1",
            }),
            fromPartial({
              id: "2",
            }),
            fromPartial({
              id: "3",
            }),
            fromPartial({
              id: "4",
            }),
          ],
        })
        .getState();

      expect(stateWithDatabaseClips.items).toMatchObject([
        {
          id: "3",
          scene: "Scene 3",
        },
        {
          id: "4",
          scene: "Scene 4",
        },
        {
          id: "1",
          scene: "Scene 1",
        },
        {
          id: "2",
          scene: "Scene 2",
        },
      ]);
    });

    it("Should allow for inserting clips after a specific clip", async () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      const stateWithClips = tester
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Scene 1",
            soundDetectionId: "sound-1",
          })
        )
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Scene 2",
            soundDetectionId: "sound-2",
          })
        )
        .getState();

      const stateWithEndInsertionPoint = tester
        .send(
          fromPartial({
            type: "set-insertion-point-after",
            clipId: stateWithClips.items[0]!.frontendId,
          })
        )
        .getState();

      expect(stateWithEndInsertionPoint.insertionPoint).toEqual({
        type: "after-clip",
        frontendClipId: stateWithClips.items[0]!.frontendId,
      });

      const stateWithOneMoreClip = tester
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Scene 3",
            soundDetectionId: "sound-3",
          })
        )
        .getState();

      expect(stateWithOneMoreClip.items).toMatchObject([
        {
          scene: "Scene 1",
        },
        {
          scene: "Scene 3",
        },
        {
          scene: "Scene 2",
        },
      ]);

      const stateWithDatabaseClips = tester
        .send({
          type: "new-database-clips",
          clips: [
            fromPartial({ id: "1" }),
            fromPartial({ id: "2" }),
            fromPartial({ id: "3" }),
          ],
        })
        .getState();

      expect(stateWithDatabaseClips.items).toMatchObject([
        {
          id: "1",
          scene: "Scene 1",
        },
        {
          id: "3",
          scene: "Scene 3",
        },
        {
          id: "2",
          scene: "Scene 2",
        },
      ]);
    });

    it("Should handle new database clips being added after an optimistic clip", async () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      const stateWithClips = tester
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Scene 1",
            soundDetectionId: "sound-1",
          })
        )
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Scene 2",
            soundDetectionId: "sound-2",
          })
        )
        .getState();

      const stateWithDatabaseClips = tester
        .send(
          fromPartial({
            type: "set-insertion-point-after",
            clipId: stateWithClips.items[0]!.frontendId,
          })
        )
        .send(
          fromPartial({
            type: "new-database-clips",
            clips: [
              fromPartial({ id: "1" }),
              fromPartial({ id: "2" }),
              fromPartial({ id: "3" }),
            ],
          })
        )
        .getState();

      expect(stateWithDatabaseClips.items).toMatchObject([
        {
          id: "1",
          scene: "Scene 1",
        },
        {
          id: "3",
        },
        {
          id: "2",
          scene: "Scene 2",
        },
      ]);
    });

    it("Should move the insertion point to the previous clip when the latest inserted clip is deleted", async () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      const stateWithClips = tester
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Scene 1",
            soundDetectionId: "sound-1",
          })
        )
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Scene 2",
            soundDetectionId: "sound-2",
          })
        )
        .getState();

      const stateWithLatestInsertedClipDeleted = tester
        .send({
          type: "set-insertion-point-after",
          clipId: stateWithClips.items[0]!.frontendId,
        })
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Scene 3",
            soundDetectionId: "sound-3",
          })
        )
        .send({
          type: "delete-latest-inserted-clip",
        })
        .getState();

      expect(stateWithLatestInsertedClipDeleted.items).toMatchObject([
        {
          scene: "Scene 1",
        },
        {
          scene: "Scene 3",
          shouldArchive: true,
        },
        {
          scene: "Scene 2",
        },
      ]);

      // The insertion point should be after the first clip
      expect(stateWithLatestInsertedClipDeleted.insertionPoint).toEqual({
        type: "after-clip",
        frontendClipId: stateWithClips.items[0]!.frontendId,
      });
    });
  });

  describe("Deleting clips", () => {
    it("Should move the insertion point to the previous item when a clip section is deleted", () => {
      const tester = new ReducerTester(
        clipStateReducer,
        createInitialState({
          items: [
            fromPartial({
              type: "on-database",
              frontendId: "fe-1" as FrontendId,
              databaseId: "db-1" as DatabaseId,
              scene: "Clip 1",
              insertionOrder: null,
            }),
            fromPartial({
              type: "clip-section-on-database",
              frontendId: "fe-s1" as FrontendId,
              databaseId: "db-s1" as DatabaseId,
              name: "Section 1",
              insertionOrder: null,
            }),
            fromPartial({
              type: "on-database",
              frontendId: "fe-2" as FrontendId,
              databaseId: "db-2" as DatabaseId,
              scene: "Clip 2",
              insertionOrder: null,
            }),
          ],
          insertionPoint: { type: "end" },
        })
      );

      const state = tester
        .send({
          type: "clips-deleted",
          clipIds: ["fe-s1" as FrontendId],
        })
        .getState();

      expect(state.items).toHaveLength(2);
      expect(state.items).toMatchObject([
        { scene: "Clip 1" },
        { scene: "Clip 2" },
      ]);

      // Insertion point should move to after Clip 1 (the item before the deleted section)
      expect(state.insertionPoint).toEqual({
        type: "after-clip",
        frontendClipId: "fe-1",
      });
    });

    it("Should move the insertion point to end when deleting a clip section that is the first item", () => {
      const tester = new ReducerTester(
        clipStateReducer,
        createInitialState({
          items: [
            fromPartial({
              type: "clip-section-on-database",
              frontendId: "fe-s1" as FrontendId,
              databaseId: "db-s1" as DatabaseId,
              name: "Section 1",
              insertionOrder: null,
            }),
            fromPartial({
              type: "on-database",
              frontendId: "fe-1" as FrontendId,
              databaseId: "db-1" as DatabaseId,
              scene: "Clip 1",
              insertionOrder: null,
            }),
          ],
          insertionPoint: {
            type: "after-clip",
            frontendClipId: "fe-1" as FrontendId,
          },
        })
      );

      const state = tester
        .send({
          type: "clips-deleted",
          clipIds: ["fe-s1" as FrontendId],
        })
        .getState();

      expect(state.items).toHaveLength(1);
      expect(state.items).toMatchObject([{ scene: "Clip 1" }]);

      // No item before the deleted section, so insertion point should be "end"
      expect(state.insertionPoint).toEqual({
        type: "end",
      });
    });

    it("Should move the insertion point to the previous clip section when deleting a clip section after another section", () => {
      const tester = new ReducerTester(
        clipStateReducer,
        createInitialState({
          items: [
            fromPartial({
              type: "clip-section-on-database",
              frontendId: "fe-s1" as FrontendId,
              databaseId: "db-s1" as DatabaseId,
              name: "Section 1",
              insertionOrder: null,
            }),
            fromPartial({
              type: "clip-section-on-database",
              frontendId: "fe-s2" as FrontendId,
              databaseId: "db-s2" as DatabaseId,
              name: "Section 2",
              insertionOrder: null,
            }),
            fromPartial({
              type: "on-database",
              frontendId: "fe-1" as FrontendId,
              databaseId: "db-1" as DatabaseId,
              scene: "Clip 1",
              insertionOrder: null,
            }),
          ],
          insertionPoint: {
            type: "after-clip",
            frontendClipId: "fe-1" as FrontendId,
          },
        })
      );

      const state = tester
        .send({
          type: "clips-deleted",
          clipIds: ["fe-s2" as FrontendId],
        })
        .getState();

      expect(state.items).toHaveLength(2);
      expect(state.items).toMatchObject([
        { name: "Section 1" },
        { scene: "Clip 1" },
      ]);

      // Should select the previous item (Section 1)
      expect(state.insertionPoint).toEqual({
        type: "after-clip-section",
        frontendClipSectionId: "fe-s1",
      });
    });
  });

  describe("Deleting Latest Inserted Clip", () => {
    it("When all clips have no insertion order, the last clip should be deleted", () => {
      const finalState = new ReducerTester(
        clipStateReducer,
        createInitialState({
          items: [
            fromPartial({
              type: "on-database",
              frontendId: "1",
              scene: "Scene 1",
              profile: "Profile 1",
              insertionOrder: null,
            }),
            fromPartial({
              type: "on-database",
              frontendId: "2",
              scene: "Scene 2",
              profile: "Profile 2",
              insertionOrder: null,
            }),
          ],
        })
      )
        .send(
          fromPartial({
            type: "delete-latest-inserted-clip",
          })
        )
        .getState();

      expect(finalState.items).toMatchObject([
        {
          frontendId: "1",
        },
      ]);
    });
  });

  describe("Inserting clips with clip sections", () => {
    it("Should correctly insert a clip just before a section (after a clip that precedes the section)", () => {
      // Setup: Clip 1 -> Section -> Clip 2
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      // Add first clip
      const stateWithFirstClip = tester
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Clip 1",
            soundDetectionId: "sound-1",
          })
        )
        .getState();

      const firstClipId = stateWithFirstClip.items[0]!.frontendId;

      // Add section after first clip
      const stateWithSection = tester
        .send({
          type: "add-clip-section",
          name: "Section 1",
        })
        .getState();

      const sectionId = stateWithSection.items[1]!.frontendId;

      // Add second clip after section
      const stateWithTwoClipsAndSection = tester
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Clip 2",
            soundDetectionId: "sound-2",
          })
        )
        .getState();

      // Verify structure: [Clip 1, Section, Clip 2]
      expect(stateWithTwoClipsAndSection.items).toHaveLength(3);
      expect(stateWithTwoClipsAndSection.items[0]).toMatchObject({
        scene: "Clip 1",
      });
      expect(stateWithTwoClipsAndSection.items[1]).toMatchObject({
        name: "Section 1",
      });
      expect(stateWithTwoClipsAndSection.items[2]).toMatchObject({
        scene: "Clip 2",
      });

      // Now set insertion point BEFORE the section (which means after Clip 1)
      const stateWithInsertionBeforeSection = tester
        .send({
          type: "set-insertion-point-before",
          clipId: sectionId,
        })
        .getState();

      // Insertion point should be after Clip 1
      expect(stateWithInsertionBeforeSection.insertionPoint).toEqual({
        type: "after-clip",
        frontendClipId: firstClipId,
      });

      // Insert a new clip (Clip 3) at this insertion point
      const stateWithNewClip = tester
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Clip 3",
            soundDetectionId: "sound-3",
          })
        )
        .getState();

      // Verify structure: [Clip 1, Clip 3, Section, Clip 2]
      expect(stateWithNewClip.items).toHaveLength(4);
      expect(stateWithNewClip.items).toMatchObject([
        { scene: "Clip 1" },
        { scene: "Clip 3" },
        { name: "Section 1" },
        { scene: "Clip 2" },
      ]);

      // Insertion point should now be after Clip 3
      expect(stateWithNewClip.insertionPoint).toEqual({
        type: "after-clip",
        frontendClipId: stateWithNewClip.items[1]!.frontendId,
      });
    });

    it("Should correctly handle insertion point when setting it before a section at the start", () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      // Add section at start
      const stateWithSection = tester
        .send({
          type: "add-clip-section",
          name: "Section 1",
        })
        .getState();

      const sectionId = stateWithSection.items[0]!.frontendId;

      // Add clip after section
      tester.send(
        fromPartial({
          type: "new-optimistic-clip-detected",
          scene: "Clip 1",
          soundDetectionId: "sound-1",
        })
      );

      // Set insertion point before the section (should be "start")
      const stateWithInsertionBeforeSection = tester
        .send({
          type: "set-insertion-point-before",
          clipId: sectionId,
        })
        .getState();

      expect(stateWithInsertionBeforeSection.insertionPoint).toEqual({
        type: "start",
      });

      // Insert a new clip (should go before the section)
      const stateWithNewClip = tester
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Clip 2",
            soundDetectionId: "sound-2",
          })
        )
        .getState();

      // Verify structure: [Clip 2, Section, Clip 1]
      expect(stateWithNewClip.items).toMatchObject([
        { scene: "Clip 2" },
        { name: "Section 1" },
        { scene: "Clip 1" },
      ]);
    });

    it("Should correctly insert clips after a section", () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      // Add clip
      tester.send(
        fromPartial({
          type: "new-optimistic-clip-detected",
          scene: "Clip 1",
          soundDetectionId: "sound-1",
        })
      );

      // Add section
      const stateWithSection = tester
        .send({
          type: "add-clip-section",
          name: "Section 1",
        })
        .getState();

      // Insertion point should now be after the section
      expect(stateWithSection.insertionPoint).toEqual({
        type: "after-clip-section",
        frontendClipSectionId: stateWithSection.items[1]!.frontendId,
      });

      // Insert a new clip after the section
      const stateWithNewClip = tester
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Clip 2",
            soundDetectionId: "sound-2",
          })
        )
        .getState();

      // Verify structure: [Clip 1, Section, Clip 2]
      expect(stateWithNewClip.items).toMatchObject([
        { scene: "Clip 1" },
        { name: "Section 1" },
        { scene: "Clip 2" },
      ]);

      // Insertion point should be after Clip 2
      expect(stateWithNewClip.insertionPoint).toEqual({
        type: "after-clip",
        frontendClipId: stateWithNewClip.items[2]!.frontendId,
      });
    });
  });

  describe("Adding clip section after optimistic clip section", () => {
    it("Should add a clip section after an optimistically added clip section", () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      // Add first section via add-clip-section (creates an optimistically added section)
      const stateWithFirstSection = tester
        .send({
          type: "add-clip-section",
          name: "Section 1",
        })
        .getState();

      expect(stateWithFirstSection.items).toHaveLength(1);
      expect(stateWithFirstSection.items[0]).toMatchObject({
        type: "clip-section-optimistically-added",
        name: "Section 1",
      });

      const firstSectionId = stateWithFirstSection.items[0]!.frontendId;

      // Now add another section after the optimistic section via add-clip-section-at
      const stateWithSecondSection = tester
        .send({
          type: "add-clip-section-at",
          name: "Section 2",
          position: "after",
          itemId: firstSectionId,
        })
        .getState();

      // Should have both sections
      expect(stateWithSecondSection.items).toHaveLength(2);
      expect(stateWithSecondSection.items).toMatchObject([
        { name: "Section 1" },
        { name: "Section 2" },
      ]);
    });

    it("Should add a clip section before an optimistically added clip section", () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      // Add first section
      const stateWithFirstSection = tester
        .send({
          type: "add-clip-section",
          name: "Section 1",
        })
        .getState();

      const firstSectionId = stateWithFirstSection.items[0]!.frontendId;

      // Add section before the optimistic section
      const stateWithSecondSection = tester
        .send({
          type: "add-clip-section-at",
          name: "Section 0",
          position: "before",
          itemId: firstSectionId,
        })
        .getState();

      expect(stateWithSecondSection.items).toHaveLength(2);
      expect(stateWithSecondSection.items).toMatchObject([
        { name: "Section 0" },
        { name: "Section 1" },
      ]);
    });
  });

  describe("Appending optimistic clips with sections present", () => {
    it("Should append optimistic clips at end when sections exist", () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      // Add clip, section, clip - then append more at end
      tester
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Clip 1",
            soundDetectionId: "sound-1",
          })
        )
        .send({
          type: "add-clip-section",
          name: "Section 1",
        })
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Clip 2",
            soundDetectionId: "sound-2",
          })
        );

      // Now add more clips - should append after Clip 2
      const state = tester
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Clip 3",
            soundDetectionId: "sound-3",
          })
        )
        .getState();

      expect(state.items).toHaveLength(4);
      expect(state.items).toMatchObject([
        { scene: "Clip 1" },
        { name: "Section 1" },
        { scene: "Clip 2" },
        { scene: "Clip 3" },
      ]);
    });

    it("Should replace optimistic clips with database clips when sections are interleaved", () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      // Add clip, section, clip
      tester
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Clip 1",
            soundDetectionId: "sound-1",
          })
        )
        .send({
          type: "add-clip-section",
          name: "Section 1",
        })
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Clip 2",
            soundDetectionId: "sound-2",
          })
        );

      // Replace first optimistic clip with database clip
      const stateAfterFirstDb = tester
        .send({
          type: "new-database-clips",
          clips: [fromPartial({ id: "db-1" })],
        })
        .getState();

      expect(stateAfterFirstDb.items).toHaveLength(3);
      expect(stateAfterFirstDb.items[0]).toMatchObject({
        type: "on-database",
        id: "db-1",
      });
      // Section should still be in position 1
      expect(stateAfterFirstDb.items[1]).toMatchObject({
        name: "Section 1",
      });
      // Second clip still optimistic
      expect(stateAfterFirstDb.items[2]).toMatchObject({
        type: "optimistically-added",
        scene: "Clip 2",
      });

      // Replace second optimistic clip with database clip
      const stateAfterSecondDb = tester
        .send({
          type: "new-database-clips",
          clips: [fromPartial({ id: "db-2" })],
        })
        .getState();

      expect(stateAfterSecondDb.items).toHaveLength(3);
      expect(stateAfterSecondDb.items).toMatchObject([
        { type: "on-database", id: "db-1" },
        { name: "Section 1" },
        { type: "on-database", id: "db-2" },
      ]);
    });

    it("Should handle multiple sequential optimistic clips after a section, then replace them", () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      // Add section first
      tester.send({
        type: "add-clip-section",
        name: "Section 1",
      });

      // Add 3 clips after section
      tester
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Clip A",
            soundDetectionId: "sound-a",
          })
        )
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Clip B",
            soundDetectionId: "sound-b",
          })
        )
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Clip C",
            soundDetectionId: "sound-c",
          })
        );

      const stateBeforeDb = tester.getState();
      expect(stateBeforeDb.items).toHaveLength(4);
      expect(stateBeforeDb.items).toMatchObject([
        { name: "Section 1" },
        { scene: "Clip A" },
        { scene: "Clip B" },
        { scene: "Clip C" },
      ]);

      // Replace all three with database clips one at a time
      tester.send({
        type: "new-database-clips",
        clips: [fromPartial({ id: "db-a" })],
      });
      tester.send({
        type: "new-database-clips",
        clips: [fromPartial({ id: "db-b" })],
      });
      const finalState = tester
        .send({
          type: "new-database-clips",
          clips: [fromPartial({ id: "db-c" })],
        })
        .getState();

      expect(finalState.items).toHaveLength(4);
      expect(finalState.items).toMatchObject([
        { name: "Section 1" },
        { type: "on-database", id: "db-a" },
        { type: "on-database", id: "db-b" },
        { type: "on-database", id: "db-c" },
      ]);
    });

    it("Should not displace sections when database clips arrive without matching optimistic clips", () => {
      const tester = new ReducerTester(
        clipStateReducer,
        createInitialState({
          items: [
            fromPartial({
              type: "on-database",
              frontendId: "fe-1" as FrontendId,
              databaseId: "db-1" as DatabaseId,
              scene: "Existing Clip",
              insertionOrder: null,
            }),
            fromPartial({
              type: "clip-section-on-database",
              frontendId: "fe-s1" as FrontendId,
              databaseId: "db-s1" as DatabaseId,
              name: "Section 1",
              insertionOrder: null,
            }),
          ],
        })
      );

      // A new database clip arrives with no matching optimistic clip
      // (e.g., from page refresh or another source)
      const state = tester
        .send({
          type: "new-database-clips",
          clips: [fromPartial({ id: "db-2" })],
        })
        .getState();

      // The new clip should be at the end (default insertion point),
      // section should stay in position
      expect(state.items).toHaveLength(3);
      expect(state.items[0]).toMatchObject({
        type: "on-database",
        databaseId: "db-1",
      });
      expect(state.items[1]).toMatchObject({
        name: "Section 1",
      });
      expect(state.items[2]).toMatchObject({
        type: "on-database",
        databaseId: "db-2",
      });
    });

    it("Should correctly handle insertion point after section when appending new clips from OBS", () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      // Add first clip
      tester.send(
        fromPartial({
          type: "new-optimistic-clip-detected",
          scene: "Clip 1",
          soundDetectionId: "sound-1",
        })
      );

      // Add section - insertion point moves to after-clip-section
      const stateWithSection = tester
        .send({
          type: "add-clip-section",
          name: "Section 1",
        })
        .getState();

      expect(stateWithSection.insertionPoint).toEqual({
        type: "after-clip-section",
        frontendClipSectionId: stateWithSection.items[1]!.frontendId,
      });

      // First OBS clip after section
      const stateWithClip2 = tester
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Clip 2",
            soundDetectionId: "sound-2",
          })
        )
        .getState();

      // Insertion point should move to after-clip (clip 2)
      expect(stateWithClip2.insertionPoint).toEqual({
        type: "after-clip",
        frontendClipId: stateWithClip2.items[2]!.frontendId,
      });

      // Second OBS clip - should go after clip 2, not after section
      const stateWithClip3 = tester
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Clip 3",
            soundDetectionId: "sound-3",
          })
        )
        .getState();

      expect(stateWithClip3.items).toMatchObject([
        { scene: "Clip 1" },
        { name: "Section 1" },
        { scene: "Clip 2" },
        { scene: "Clip 3" },
      ]);
    });
  });

  describe("Moving clips around sections", () => {
    it("Should fire reorder-clip effect when moving a database clip up past a section", () => {
      const tester = new ReducerTester(
        clipStateReducer,
        createInitialState({
          items: [
            fromPartial({
              type: "on-database",
              frontendId: "fe-1" as FrontendId,
              databaseId: "db-1" as DatabaseId,
              scene: "Clip 1",
              insertionOrder: null,
            }),
            fromPartial({
              type: "clip-section-on-database",
              frontendId: "fe-s1" as FrontendId,
              databaseId: "db-s1" as DatabaseId,
              name: "Section 1",
              insertionOrder: null,
            }),
            fromPartial({
              type: "on-database",
              frontendId: "fe-2" as FrontendId,
              databaseId: "db-2" as DatabaseId,
              scene: "Clip 2",
              insertionOrder: null,
            }),
          ],
        })
      );

      // Move Clip 2 up - should swap with section
      const state = tester
        .send({
          type: "move-clip",
          clipId: "fe-2" as FrontendId,
          direction: "up",
        })
        .getState();

      expect(state.items).toMatchObject([
        { scene: "Clip 1" },
        { scene: "Clip 2" },
        { name: "Section 1" },
      ]);

      expect(tester.getExec()).toHaveBeenCalledWith({
        type: "reorder-clip",
        clipId: "db-2",
        direction: "up",
      });
    });

    it("Should fire reorder-clip-section effect when moving a section down", () => {
      const tester = new ReducerTester(
        clipStateReducer,
        createInitialState({
          items: [
            fromPartial({
              type: "clip-section-on-database",
              frontendId: "fe-s1" as FrontendId,
              databaseId: "db-s1" as DatabaseId,
              name: "Section 1",
              insertionOrder: null,
            }),
            fromPartial({
              type: "on-database",
              frontendId: "fe-1" as FrontendId,
              databaseId: "db-1" as DatabaseId,
              scene: "Clip 1",
              insertionOrder: null,
            }),
          ],
        })
      );

      // Move section down - should swap with Clip 1
      const state = tester
        .send({
          type: "move-clip",
          clipId: "fe-s1" as FrontendId,
          direction: "down",
        })
        .getState();

      expect(state.items).toMatchObject([
        { scene: "Clip 1" },
        { name: "Section 1" },
      ]);

      expect(tester.getExec()).toHaveBeenCalledWith({
        type: "reorder-clip-section",
        clipSectionId: "db-s1",
        direction: "down",
      });
    });

    it("Should handle moving the first clip down past a section", () => {
      const tester = new ReducerTester(
        clipStateReducer,
        createInitialState({
          items: [
            fromPartial({
              type: "on-database",
              frontendId: "fe-1" as FrontendId,
              databaseId: "db-1" as DatabaseId,
              scene: "Clip 1",
              insertionOrder: null,
            }),
            fromPartial({
              type: "clip-section-on-database",
              frontendId: "fe-s1" as FrontendId,
              databaseId: "db-s1" as DatabaseId,
              name: "Section 1",
              insertionOrder: null,
            }),
            fromPartial({
              type: "on-database",
              frontendId: "fe-2" as FrontendId,
              databaseId: "db-2" as DatabaseId,
              scene: "Clip 2",
              insertionOrder: null,
            }),
          ],
        })
      );

      // Move Clip 1 down - should swap with section
      const state = tester
        .send({
          type: "move-clip",
          clipId: "fe-1" as FrontendId,
          direction: "down",
        })
        .getState();

      expect(state.items).toMatchObject([
        { name: "Section 1" },
        { scene: "Clip 1" },
        { scene: "Clip 2" },
      ]);
    });
  });

  describe("Deleting clips with sections", () => {
    it("Should move insertion point correctly when deleting a clip between sections", () => {
      const tester = new ReducerTester(
        clipStateReducer,
        createInitialState({
          items: [
            fromPartial({
              type: "clip-section-on-database",
              frontendId: "fe-s1" as FrontendId,
              databaseId: "db-s1" as DatabaseId,
              name: "Section 1",
              insertionOrder: null,
            }),
            fromPartial({
              type: "on-database",
              frontendId: "fe-1" as FrontendId,
              databaseId: "db-1" as DatabaseId,
              scene: "Clip 1",
              insertionOrder: null,
            }),
            fromPartial({
              type: "clip-section-on-database",
              frontendId: "fe-s2" as FrontendId,
              databaseId: "db-s2" as DatabaseId,
              name: "Section 2",
              insertionOrder: null,
            }),
          ],
          insertionPoint: {
            type: "after-clip",
            frontendClipId: "fe-1" as FrontendId,
          },
        })
      );

      // Delete Clip 1 - insertion point should move to previous item (Section 1)
      const state = tester
        .send({
          type: "clips-deleted",
          clipIds: ["fe-1" as FrontendId],
        })
        .getState();

      expect(state.items).toHaveLength(2);
      expect(state.items).toMatchObject([
        { name: "Section 1" },
        { name: "Section 2" },
      ]);

      expect(state.insertionPoint).toEqual({
        type: "after-clip-section",
        frontendClipSectionId: "fe-s1",
      });
    });

    it("Should handle delete-latest-inserted-clip when insertion point is after a section", () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      // Add a clip, section, then another clip
      tester
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Clip 1",
            soundDetectionId: "sound-1",
          })
        )
        .send({
          type: "add-clip-section",
          name: "Section 1",
        })
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            scene: "Clip 2",
            soundDetectionId: "sound-2",
          })
        );

      // Delete latest inserted clip (Clip 2)
      const stateAfterDelete = tester
        .send({
          type: "delete-latest-inserted-clip",
        })
        .getState();

      // Clip 2 should be marked for archive, insertion point should move to section
      expect(stateAfterDelete.items).toMatchObject([
        { scene: "Clip 1" },
        { name: "Section 1" },
        { scene: "Clip 2", shouldArchive: true },
      ]);

      // Insertion point should be after the section (the previous item)
      expect(stateAfterDelete.insertionPoint).toEqual({
        type: "after-clip-section",
        frontendClipSectionId: stateAfterDelete.items[1]!.frontendId,
      });
    });
  });

  describe("Clip section lifecycle (optimistic → on-database)", () => {
    it("Should transition an optimistic clip section to on-database when clip-section-created is dispatched", () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      // Add an optimistic section
      const stateWithSection = tester
        .send({
          type: "add-clip-section",
          name: "Section 1",
        })
        .getState();

      expect(stateWithSection.items[0]).toMatchObject({
        type: "clip-section-optimistically-added",
        name: "Section 1",
      });

      const frontendId = stateWithSection.items[0]!.frontendId;

      // Simulate the DB responding with the created section
      const stateAfterCreated = tester
        .send(
          fromPartial({
            type: "clip-section-created",
            frontendId,
            databaseId: "db-s1",
          })
        )
        .getState();

      // Should now be on-database
      expect(stateAfterCreated.items[0]).toMatchObject({
        type: "clip-section-on-database",
        frontendId,
        databaseId: "db-s1",
        name: "Section 1",
      });
    });

    it("Should fire reorder-clip-section effect when moving a section that was optimistic but has been persisted", () => {
      const tester = new ReducerTester(
        clipStateReducer,
        createInitialState({
          items: [
            fromPartial({
              type: "on-database",
              frontendId: "fe-1" as FrontendId,
              databaseId: "db-1" as DatabaseId,
              scene: "Clip 1",
              insertionOrder: null,
            }),
          ],
        })
      );

      // Add an optimistic section after Clip 1
      const stateWithSection = tester
        .send({
          type: "add-clip-section",
          name: "Section 1",
        })
        .getState();

      const sectionFrontendId = stateWithSection.items[1]!.frontendId;

      // Simulate DB response - section now has a database ID
      tester.send(
        fromPartial({
          type: "clip-section-created",
          frontendId: sectionFrontendId,
          databaseId: "db-s1",
        })
      );

      // Move the section up past Clip 1
      tester.send({
        type: "move-clip",
        clipId: sectionFrontendId,
        direction: "up",
      });

      // The reorder effect should have fired with the database ID
      expect(tester.getExec()).toHaveBeenCalledWith({
        type: "reorder-clip-section",
        clipSectionId: "db-s1",
        direction: "up",
      });
    });
  });

  describe("Recording Sessions", () => {
    describe("recording-started", () => {
      it("Should create a new session with displayNumber 1", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        tester.send({
          type: "recording-started",
          outputPath: "/tmp/recording.mkv",
        });

        const state = tester.getState();
        expect(state.sessions).toHaveLength(1);
        expect(state.sessions[0]).toMatchObject({
          displayNumber: 1,
          status: "recording",
        });
        expect(state.sessions[0]!.id).toBeTruthy();
      });

      it("Should increment displayNumber for subsequent sessions", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        tester
          .send({ type: "recording-started", outputPath: "/tmp/recording.mkv" })
          .send({
            type: "recording-started",
            outputPath: "/tmp/recording.mkv",
          });

        const state = tester.getState();
        expect(state.sessions).toHaveLength(2);
        expect(state.sessions[0]).toMatchObject({ displayNumber: 1 });
        expect(state.sessions[1]).toMatchObject({ displayNumber: 2 });
      });

      it("Should not affect existing items or insertionPoint", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        const stateBefore = tester.getState();
        tester.send({
          type: "recording-started",
          outputPath: "/tmp/recording.mkv",
        });
        const stateAfter = tester.getState();

        expect(stateAfter.items).toEqual(stateBefore.items);
        expect(stateAfter.insertionPoint).toEqual(stateBefore.insertionPoint);
        expect(stateAfter.insertionOrder).toEqual(stateBefore.insertionOrder);
      });

      it("Should store the outputPath from the action", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        tester.send({
          type: "recording-started",
          outputPath: "/videos/2026-03-04_10-30-00.mkv",
        });

        const state = tester.getState();
        expect(state.sessions[0]).toMatchObject({
          outputPath: "/videos/2026-03-04_10-30-00.mkv",
          status: "recording",
        });
      });

      it("Should preserve outputPath after recording stops", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        tester
          .send({
            type: "recording-started",
            outputPath: "/videos/session1.mkv",
          })
          .send({ type: "recording-stopped" });

        const state = tester.getState();
        expect(state.sessions[0]).toMatchObject({
          outputPath: "/videos/session1.mkv",
          status: "polling",
        });
      });

      it("Should store different outputPaths for different sessions", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        tester
          .send({
            type: "recording-started",
            outputPath: "/videos/session1.mkv",
          })
          .send({ type: "recording-stopped" })
          .send({
            type: "recording-started",
            outputPath: "/videos/session2.mkv",
          });

        const state = tester.getState();
        expect(state.sessions[0]).toMatchObject({
          outputPath: "/videos/session1.mkv",
          status: "polling",
        });
        expect(state.sessions[1]).toMatchObject({
          outputPath: "/videos/session2.mkv",
          status: "recording",
        });
      });

      it("Should fire start-session-polling effect with sessionId and outputPath", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        tester.send({
          type: "recording-started",
          outputPath: "/videos/recording.mkv",
        });

        const sessionId = tester.getState().sessions[0]!.id;

        expect(tester.getExec()).toHaveBeenCalledWith({
          type: "start-session-polling",
          sessionId,
          outputPath: "/videos/recording.mkv",
        });
      });

      it("Should fire separate start-session-polling effects for each session", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        tester.send({
          type: "recording-started",
          outputPath: "/videos/session1.mkv",
        });
        const session1Id = tester.getState().sessions[0]!.id;

        tester.resetExec().send({ type: "recording-stopped" });

        tester.resetExec().send({
          type: "recording-started",
          outputPath: "/videos/session2.mkv",
        });
        const session2Id = tester.getState().sessions[1]!.id;

        expect(tester.getExec()).toHaveBeenCalledWith({
          type: "start-session-polling",
          sessionId: session2Id,
          outputPath: "/videos/session2.mkv",
        });

        expect(session1Id).not.toEqual(session2Id);
      });

      it("Should fire scroll-to-insertion-point effect", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        tester.send({
          type: "recording-started",
          outputPath: "/videos/recording.mkv",
        });

        expect(tester.getExec()).toHaveBeenCalledWith({
          type: "scroll-to-insertion-point",
        });
      });
    });

    describe("recording-stopped", () => {
      it("Should mark the active session as no longer recording", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        tester
          .send({ type: "recording-started", outputPath: "/tmp/recording.mkv" })
          .send({ type: "recording-stopped" });

        const state = tester.getState();
        expect(state.sessions).toHaveLength(1);
        expect(state.sessions[0]).toMatchObject({
          displayNumber: 1,
          status: "polling",
        });
      });

      it("Should only mark the currently recording session as stopped", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        // Start first session, stop it, start second session
        tester
          .send({ type: "recording-started", outputPath: "/tmp/recording.mkv" })
          .send({ type: "recording-stopped" })
          .send({
            type: "recording-started",
            outputPath: "/tmp/recording.mkv",
          });

        const stateBefore = tester.getState();
        expect(stateBefore.sessions[0]).toMatchObject({ status: "polling" });
        expect(stateBefore.sessions[1]).toMatchObject({ status: "recording" });

        // Stop second session
        tester.send({ type: "recording-stopped" });

        const state = tester.getState();
        expect(state.sessions[0]).toMatchObject({ status: "polling" });
        expect(state.sessions[1]).toMatchObject({ status: "polling" });
      });

      it("Should fire start-session-timeout effect with the session id", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        tester.send({
          type: "recording-started",
          outputPath: "/tmp/recording.mkv",
        });
        const sessionId = tester.getState().sessions[0]!.id;

        tester.resetExec().send({ type: "recording-stopped" });

        expect(tester.getExec()).toHaveBeenCalledWith({
          type: "start-session-timeout",
          sessionId,
        });
      });

      it("Should no-op if no session is currently recording", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        const stateBefore = tester.getState();
        tester.send({ type: "recording-stopped" });
        const stateAfter = tester.getState();

        expect(stateAfter).toEqual(stateBefore);
        expect(tester.getExec()).not.toHaveBeenCalled();
      });
    });

    describe("session-polling-complete", () => {
      it("Should atomically set session status to done and mark orphans", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        tester
          .send({ type: "recording-started", outputPath: "/tmp/recording.mkv" })
          .send(
            fromPartial({
              type: "new-optimistic-clip-detected",
              soundDetectionId: "sound-1",
            })
          )
          .send(
            fromPartial({
              type: "new-optimistic-clip-detected",
              soundDetectionId: "sound-2",
            })
          )
          .send({ type: "recording-stopped" });

        const sessionId = tester.getState().sessions[0]!.id;

        tester.send({ type: "session-polling-complete", sessionId });

        const state = tester.getState();
        expect(state.sessions[0]).toMatchObject({ status: "done" });
        const clip1 = state.items[0] as ClipOptimisticallyAdded;
        const clip2 = state.items[1] as ClipOptimisticallyAdded;
        expect(clip1.isOrphaned).toBe(true);
        expect(clip2.isOrphaned).toBe(true);
      });

      it("Should only affect the targeted session", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        // Session 1 with a clip
        tester
          .send({
            type: "recording-started",
            outputPath: "/tmp/recording1.mkv",
          })
          .send(
            fromPartial({
              type: "new-optimistic-clip-detected",
              soundDetectionId: "sound-1",
            })
          )
          .send({ type: "recording-stopped" });

        const session1Id = tester.getState().sessions[0]!.id;

        // Session 2 with a clip
        tester
          .send({
            type: "recording-started",
            outputPath: "/tmp/recording2.mkv",
          })
          .send(
            fromPartial({
              type: "new-optimistic-clip-detected",
              soundDetectionId: "sound-2",
            })
          )
          .send({ type: "recording-stopped" });

        // Complete only session 1
        tester.send({
          type: "session-polling-complete",
          sessionId: session1Id,
        });

        const state = tester.getState();
        expect(state.sessions[0]).toMatchObject({ status: "done" });
        expect(state.sessions[1]).toMatchObject({ status: "polling" });

        const clip1 = state.items[0] as ClipOptimisticallyAdded;
        const clip2 = state.items[1] as ClipOptimisticallyAdded;
        expect(clip1.isOrphaned).toBe(true);
        expect(clip2.isOrphaned).toBeUndefined();
      });

      it("Should not mark archived clips as orphaned", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        tester
          .send({ type: "recording-started", outputPath: "/tmp/recording.mkv" })
          .send(
            fromPartial({
              type: "new-optimistic-clip-detected",
              soundDetectionId: "sound-1",
            })
          )
          .send(
            fromPartial({
              type: "new-optimistic-clip-detected",
              soundDetectionId: "sound-2",
            })
          )
          .send({ type: "recording-stopped" });

        const sessionId = tester.getState().sessions[0]!.id;

        // Archive the first clip
        const clip1Id = tester.getState().items[0]!.frontendId;
        tester.send({ type: "clips-deleted", clipIds: [clip1Id] });

        tester.send({ type: "session-polling-complete", sessionId });

        const state = tester.getState();
        expect(state.sessions[0]).toMatchObject({ status: "done" });

        const archivedClip = state.items.find(
          (c) => c.frontendId === clip1Id
        ) as ClipOptimisticallyAdded;
        expect(archivedClip.shouldArchive).toBe(true);
        expect(archivedClip.isOrphaned).toBeUndefined();

        const otherClip = state.items.find(
          (c) => c.frontendId !== clip1Id
        ) as ClipOptimisticallyAdded;
        expect(otherClip.isOrphaned).toBe(true);
      });

      it("Should no-op if session is already done", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        tester
          .send({ type: "recording-started", outputPath: "/tmp/recording.mkv" })
          .send(
            fromPartial({
              type: "new-optimistic-clip-detected",
              soundDetectionId: "sound-1",
            })
          )
          .send({ type: "recording-stopped" });

        const sessionId = tester.getState().sessions[0]!.id;

        tester.send({ type: "session-polling-complete", sessionId });
        const stateAfterFirst = tester.getState();

        tester.send({ type: "session-polling-complete", sessionId });
        const stateAfterSecond = tester.getState();

        expect(stateAfterSecond).toBe(stateAfterFirst);
      });

      it("Should set status to done even if no unresolved clips exist", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        tester
          .send({ type: "recording-started", outputPath: "/tmp/recording.mkv" })
          .send({ type: "recording-stopped" });

        const sessionId = tester.getState().sessions[0]!.id;

        tester.send({ type: "session-polling-complete", sessionId });

        const state = tester.getState();
        expect(state.sessions[0]).toMatchObject({ status: "done" });
      });
    });

    describe("new-optimistic-clip-detected with sessions", () => {
      it("Should associate optimistic clip with active recording session", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        tester
          .send({ type: "recording-started", outputPath: "/tmp/recording.mkv" })
          .send(
            fromPartial({
              type: "new-optimistic-clip-detected",
              soundDetectionId: "sound-1",
            })
          );

        const state = tester.getState();
        const clip = state.items[0] as ClipOptimisticallyAdded;
        expect(clip.sessionId).toBe(state.sessions[0]!.id);
      });

      it("Should auto-create a session if none exists when speech is detected", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        tester.send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            soundDetectionId: "sound-1",
          })
        );

        const state = tester.getState();
        expect(state.sessions).toHaveLength(1);
        expect(state.sessions[0]).toMatchObject({
          displayNumber: 1,
          status: "recording",
        });
        const clip = state.items[0] as ClipOptimisticallyAdded;
        expect(clip.sessionId).toBe(state.sessions[0]!.id);
      });

      it("Should associate multiple clips with the same active session", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        tester
          .send({ type: "recording-started", outputPath: "/tmp/recording.mkv" })
          .send(
            fromPartial({
              type: "new-optimistic-clip-detected",
              soundDetectionId: "sound-1",
            })
          )
          .send(
            fromPartial({
              type: "new-optimistic-clip-detected",
              soundDetectionId: "sound-2",
            })
          );

        const state = tester.getState();
        const sessionId = state.sessions[0]!.id;
        const clip1 = state.items[0] as ClipOptimisticallyAdded;
        const clip2 = state.items[1] as ClipOptimisticallyAdded;
        expect(clip1.sessionId).toBe(sessionId);
        expect(clip2.sessionId).toBe(sessionId);
      });

      it("Should not create a duplicate session when auto-creating and then detecting again", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        tester
          .send(
            fromPartial({
              type: "new-optimistic-clip-detected",
              soundDetectionId: "sound-1",
            })
          )
          .send(
            fromPartial({
              type: "new-optimistic-clip-detected",
              soundDetectionId: "sound-2",
            })
          );

        const state = tester.getState();
        expect(state.sessions).toHaveLength(1);
      });
    });

    describe("restore-clip", () => {
      it("Should set shouldArchive to false on an archived optimistic clip", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        tester
          .send({ type: "recording-started", outputPath: "/tmp/recording.mkv" })
          .send(
            fromPartial({
              type: "new-optimistic-clip-detected",
              soundDetectionId: "sound-1",
            })
          );

        const clipId = tester.getState().items[0]!.frontendId;

        // Archive the clip
        tester.send({ type: "clips-deleted", clipIds: [clipId] });

        const archivedClip = tester.getState()
          .items[0] as ClipOptimisticallyAdded;
        expect(archivedClip.shouldArchive).toBe(true);

        // Restore the clip
        tester.send({ type: "restore-clip", clipId });

        const restoredClip = tester.getState()
          .items[0] as ClipOptimisticallyAdded;
        expect(restoredClip.shouldArchive).toBeUndefined();
      });

      it("Should set shouldArchive to false on an archived database clip", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        tester
          .send({ type: "recording-started", outputPath: "/tmp/recording.mkv" })
          .send(
            fromPartial({
              type: "new-optimistic-clip-detected",
              soundDetectionId: "sound-1",
            })
          );

        const clipId = tester.getState().items[0]!.frontendId;

        // Archive the clip, then pair with DB clip (creates ClipOnDatabase with shouldArchive)
        tester.send({ type: "clips-deleted", clipIds: [clipId] }).send({
          type: "new-database-clips",
          clips: [fromPartial({ id: "db-1", text: "Hello world" })],
        });

        const archivedDbClip = tester.getState().items[0] as ClipOnDatabase;
        expect(archivedDbClip.type).toBe("on-database");
        expect(archivedDbClip.shouldArchive).toBe(true);

        // Restore the clip
        tester.resetExec().send({ type: "restore-clip", clipId });

        const restoredClip = tester.getState().items[0] as ClipOnDatabase;
        expect(restoredClip.shouldArchive).toBeUndefined();
      });

      it("Should fire unarchive-clips effect for restored database clips", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        tester
          .send({ type: "recording-started", outputPath: "/tmp/recording.mkv" })
          .send(
            fromPartial({
              type: "new-optimistic-clip-detected",
              soundDetectionId: "sound-1",
            })
          );

        const clipId = tester.getState().items[0]!.frontendId;

        tester.send({ type: "clips-deleted", clipIds: [clipId] }).send({
          type: "new-database-clips",
          clips: [fromPartial({ id: "db-1", text: "" })],
        });

        // Restore the resolved clip
        tester.resetExec().send({ type: "restore-clip", clipId });

        expect(tester.getExec()).toHaveBeenCalledWith({
          type: "unarchive-clips",
          clipIds: ["db-1"],
        });
      });

      it("Should not fire unarchive-clips effect for restored optimistic clips", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        tester
          .send({ type: "recording-started", outputPath: "/tmp/recording.mkv" })
          .send(
            fromPartial({
              type: "new-optimistic-clip-detected",
              soundDetectionId: "sound-1",
            })
          );

        const clipId = tester.getState().items[0]!.frontendId;

        tester.send({ type: "clips-deleted", clipIds: [clipId] });

        // Restore the unresolved clip
        tester.resetExec().send({ type: "restore-clip", clipId });

        expect(tester.getExec()).not.toHaveBeenCalledWith(
          expect.objectContaining({ type: "unarchive-clips" })
        );
      });

      it("Should no-op if clip is not found", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        const stateBefore = tester.getState();
        tester.send({
          type: "restore-clip",
          clipId: "nonexistent" as FrontendId,
        });

        expect(tester.getState()).toEqual(stateBefore);
        expect(tester.getExec()).not.toHaveBeenCalled();
      });
    });

    describe("permanently-remove-archived", () => {
      it("Should remove all archived optimistic clips for a session", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        tester.send({
          type: "recording-started",
          outputPath: "/tmp/recording.mkv",
        });

        const sessionId = tester.getState().sessions[0]!.id;

        // Add two optimistic clips and archive them
        tester
          .send(
            fromPartial({
              type: "new-optimistic-clip-detected",
              soundDetectionId: "sound-1",
            })
          )
          .send(
            fromPartial({
              type: "new-optimistic-clip-detected",
              soundDetectionId: "sound-2",
            })
          );

        const clip1Id = tester.getState().items[0]!.frontendId;
        const clip2Id = tester.getState().items[1]!.frontendId;

        tester.send({ type: "clips-deleted", clipIds: [clip1Id, clip2Id] });

        // Both should be archived
        expect(
          (tester.getState().items[0] as ClipOptimisticallyAdded).shouldArchive
        ).toBe(true);
        expect(
          (tester.getState().items[1] as ClipOptimisticallyAdded).shouldArchive
        ).toBe(true);

        // Permanently remove all archived clips for the session
        tester.send({
          type: "permanently-remove-archived",
          sessionId,
        });

        expect(tester.getState().items).toHaveLength(0);
      });

      it("Should remove orphaned optimistic clips for a session", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        tester.send({
          type: "recording-started",
          outputPath: "/tmp/recording.mkv",
        });

        const sessionId = tester.getState().sessions[0]!.id;

        tester
          .send(
            fromPartial({
              type: "new-optimistic-clip-detected",
              soundDetectionId: "sound-1",
            })
          )
          .send(
            fromPartial({
              type: "new-optimistic-clip-detected",
              soundDetectionId: "sound-2",
            })
          )
          .send({ type: "recording-stopped" })
          .send({ type: "session-polling-complete", sessionId });

        // Both clips should now be orphaned
        expect(
          (tester.getState().items[0] as ClipOptimisticallyAdded).isOrphaned
        ).toBe(true);
        expect(
          (tester.getState().items[1] as ClipOptimisticallyAdded).isOrphaned
        ).toBe(true);

        // Permanently remove all — should clear orphaned clips too
        tester.send({
          type: "permanently-remove-archived",
          sessionId,
        });

        expect(tester.getState().items).toHaveLength(0);
      });

      it("Should remove archived database clips for a session", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        tester
          .send({ type: "recording-started", outputPath: "/tmp/recording.mkv" })
          .send(
            fromPartial({
              type: "new-optimistic-clip-detected",
              soundDetectionId: "sound-1",
            })
          );

        const clipId = tester.getState().items[0]!.frontendId;

        // Archive, then pair with DB clip
        tester.send({ type: "clips-deleted", clipIds: [clipId] }).send({
          type: "new-database-clips",
          clips: [fromPartial({ id: "db-1", text: "Hello world" })],
        });

        const sessionId = tester.getState().sessions[0]!.id;
        const archivedDbClip = tester.getState().items[0] as ClipOnDatabase;
        expect(archivedDbClip.shouldArchive).toBe(true);

        // Permanently remove
        tester.resetExec().send({
          type: "permanently-remove-archived",
          sessionId,
        });

        expect(tester.getState().items).toHaveLength(0);
      });

      it("Should not affect clips from other sessions", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        // Session 1: create and archive a clip
        tester
          .send({ type: "recording-started", outputPath: "/tmp/recording.mkv" })
          .send(
            fromPartial({
              type: "new-optimistic-clip-detected",
              soundDetectionId: "sound-1",
            })
          );

        const session1Id = tester.getState().sessions[0]!.id;
        const clip1Id = tester.getState().items[0]!.frontendId;
        tester
          .send({ type: "clips-deleted", clipIds: [clip1Id] })
          .send({ type: "recording-stopped" });

        // Session 2: create and archive a clip
        tester
          .send({ type: "recording-started", outputPath: "/tmp/recording.mkv" })
          .send(
            fromPartial({
              type: "new-optimistic-clip-detected",
              soundDetectionId: "sound-2",
            })
          );

        const clip2Id = tester.getState().items[1]!.frontendId;
        tester.send({ type: "clips-deleted", clipIds: [clip2Id] });

        expect(tester.getState().items).toHaveLength(2);

        // Remove only session 1's archived clips
        tester.send({
          type: "permanently-remove-archived",
          sessionId: session1Id,
        });

        // Session 2's archived clip should remain
        expect(tester.getState().items).toHaveLength(1);
        expect(tester.getState().items[0]!.frontendId).toBe(clip2Id);
      });

      it("Should not affect non-archived clips in the same session", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        tester
          .send({ type: "recording-started", outputPath: "/tmp/recording.mkv" })
          .send(
            fromPartial({
              type: "new-optimistic-clip-detected",
              soundDetectionId: "sound-1",
            })
          )
          .send(
            fromPartial({
              type: "new-optimistic-clip-detected",
              soundDetectionId: "sound-2",
            })
          );

        const sessionId = tester.getState().sessions[0]!.id;
        const clip1Id = tester.getState().items[0]!.frontendId;

        // Archive only clip 1, leave clip 2 pending
        tester.send({ type: "clips-deleted", clipIds: [clip1Id] });

        // Permanently remove archived clips
        tester.send({
          type: "permanently-remove-archived",
          sessionId,
        });

        // Clip 2 (non-archived) should remain
        expect(tester.getState().items).toHaveLength(1);
        expect(
          (tester.getState().items[0] as ClipOptimisticallyAdded).shouldArchive
        ).toBeUndefined();
      });

      it("Should no-op if no archived clips exist for the session", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        tester
          .send({ type: "recording-started", outputPath: "/tmp/recording.mkv" })
          .send(
            fromPartial({
              type: "new-optimistic-clip-detected",
              soundDetectionId: "sound-1",
            })
          );

        const sessionId = tester.getState().sessions[0]!.id;
        const stateBefore = tester.getState();

        tester.send({
          type: "permanently-remove-archived",
          sessionId,
        });

        expect(tester.getState()).toEqual(stateBefore);
      });

      it("Should cause unpaired DB clips arriving later to appear as new timeline clips", () => {
        const tester = new ReducerTester(
          clipStateReducer,
          createInitialState()
        );

        // Start recording, add two optimistic clips, archive them
        tester
          .send({ type: "recording-started", outputPath: "/tmp/recording.mkv" })
          .send(
            fromPartial({
              type: "new-optimistic-clip-detected",
              soundDetectionId: "sound-1",
            })
          )
          .send(
            fromPartial({
              type: "new-optimistic-clip-detected",
              soundDetectionId: "sound-2",
            })
          );

        const sessionId = tester.getState().sessions[0]!.id;
        const clip1Id = tester.getState().items[0]!.frontendId;
        const clip2Id = tester.getState().items[1]!.frontendId;

        // Delete both clips (archive them)
        tester.send({ type: "clips-deleted", clipIds: [clip1Id, clip2Id] });

        expect(tester.getState().items).toHaveLength(2);
        expect(
          (tester.getState().items[0] as ClipOptimisticallyAdded).shouldArchive
        ).toBe(true);

        // "Clear all" — permanently removes archived clips before DB clips arrive
        tester.send({
          type: "permanently-remove-archived",
          sessionId,
        });

        expect(tester.getState().items).toHaveLength(0);

        // DB clips arrive after clear all — should appear as new unpaired clips
        tester.resetExec().send({
          type: "new-database-clips",
          clips: [
            fromPartial({ id: "db-1" as DatabaseId, text: "First clip" }),
            fromPartial({ id: "db-2" as DatabaseId, text: "Second clip" }),
          ],
        });

        // Both should appear as new timeline clips (not archived)
        expect(tester.getState().items).toHaveLength(2);

        const newClip1 = tester.getState().items[0] as ClipOnDatabase;
        const newClip2 = tester.getState().items[1] as ClipOnDatabase;

        expect(newClip1.type).toBe("on-database");
        expect(newClip1.databaseId).toBe("db-1");
        expect(newClip1.shouldArchive).toBeUndefined();
        // New frontend IDs — not the original archived clip IDs
        expect(newClip1.frontendId).not.toBe(clip1Id);
        expect(newClip1.frontendId).not.toBe(clip2Id);

        expect(newClip2.type).toBe("on-database");
        expect(newClip2.databaseId).toBe("db-2");
        expect(newClip2.shouldArchive).toBeUndefined();
        expect(newClip2.frontendId).not.toBe(clip1Id);
        expect(newClip2.frontendId).not.toBe(clip2Id);
      });
    });
  });

  describe("Scoped DB clip matching by outputPath", () => {
    it("should only match DB clips against optimistic clips from the session with the same outputPath", () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      // Session 1: recording to file A, add an optimistic clip
      tester
        .send({
          type: "recording-started",
          outputPath: "/tmp/recording-A.mkv",
        })
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            soundDetectionId: "sound-1",
          })
        )
        .send({ type: "recording-stopped" });

      const session1Id = tester.getState().sessions[0]!.id;
      const session1OutputPath = tester.getState().sessions[0]!.outputPath;

      // Session 2: recording to file B, add an optimistic clip
      tester
        .send({
          type: "recording-started",
          outputPath: "/tmp/recording-B.mkv",
        })
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            soundDetectionId: "sound-2",
          })
        );

      const session2Id = tester.getState().sessions[1]!.id;

      // Both sessions have one optimistic clip each
      const optimisticClips = tester
        .getState()
        .items.filter((c) => c.type === "optimistically-added");
      expect(optimisticClips).toHaveLength(2);

      // DB clip arrives from file A — should only pair with session 1's clip
      tester.send({
        type: "new-database-clips",
        clips: [fromPartial({ id: "db-1" as DatabaseId })],
        outputPath: session1OutputPath,
      });

      const stateAfter = tester.getState();

      // Session 1's clip should be resolved (on-database)
      const session1Clips = stateAfter.items.filter(
        (c) => c.type === "optimistically-added" && c.sessionId === session1Id
      );
      expect(session1Clips).toHaveLength(0); // resolved

      const resolvedClip = stateAfter.items.find(
        (c) =>
          c.type === "on-database" && c.databaseId === ("db-1" as DatabaseId)
      ) as ClipOnDatabase;
      expect(resolvedClip).toBeDefined();

      // Session 2's clip should still be optimistic (unresolved)
      const session2Clips = stateAfter.items.filter(
        (c) => c.type === "optimistically-added" && c.sessionId === session2Id
      );
      expect(session2Clips).toHaveLength(1);
    });

    it("should not match DB clips from file B against session A's optimistic clips", () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      // Session 1: recording to file A, add two optimistic clips
      tester
        .send({
          type: "recording-started",
          outputPath: "/tmp/recording-A.mkv",
        })
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            soundDetectionId: "sound-1",
          })
        )
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            soundDetectionId: "sound-2",
          })
        )
        .send({ type: "recording-stopped" });

      // DB clip arrives from file B (no session has this outputPath)
      // Should appear as new unpaired timeline clip
      tester.send({
        type: "new-database-clips",
        clips: [fromPartial({ id: "db-1" as DatabaseId })],
        outputPath: "/tmp/recording-B.mkv",
      });

      const stateAfter = tester.getState();

      // Session 1's optimistic clips should both still be unresolved
      const optimisticClips = stateAfter.items.filter(
        (c) => c.type === "optimistically-added"
      );
      expect(optimisticClips).toHaveLength(2);

      // The DB clip should appear as a new unpaired clip
      const dbClips = stateAfter.items.filter((c) => c.type === "on-database");
      expect(dbClips).toHaveLength(1);
      expect((dbClips[0] as ClipOnDatabase).databaseId).toBe("db-1");
    });

    it("should fall back to global matching when outputPath is not provided (backwards compat)", () => {
      const tester = new ReducerTester(clipStateReducer, createInitialState());

      // Session 1 with an optimistic clip
      tester
        .send({
          type: "recording-started",
          outputPath: "/tmp/recording.mkv",
        })
        .send(
          fromPartial({
            type: "new-optimistic-clip-detected",
            soundDetectionId: "sound-1",
          })
        );

      // DB clip arrives without outputPath — should still pair (backwards compat)
      tester.send({
        type: "new-database-clips",
        clips: [fromPartial({ id: "db-1" as DatabaseId })],
      });

      const stateAfter = tester.getState();

      // Optimistic clip should be resolved
      const optimisticClips = stateAfter.items.filter(
        (c) => c.type === "optimistically-added"
      );
      expect(optimisticClips).toHaveLength(0);

      const dbClips = stateAfter.items.filter((c) => c.type === "on-database");
      expect(dbClips).toHaveLength(1);
    });
  });
});
