import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it, vi } from "vitest";
import {
  clipStateReducer,
  type DatabaseId,
  type FrontendId,
} from "./clip-state-reducer";
import type {
  EffectObject,
  EffectReducer,
  EffectReducerExec,
  EventObject,
} from "use-effect-reducer";

const createMockExec = () => {
  const fn = vi.fn() as any;
  fn.stop = vi.fn();
  fn.replace = vi.fn();
  return fn;
};

const createInitialState = (
  overrides: Partial<clipStateReducer.State> = {}
): clipStateReducer.State => ({
  clipIdsBeingTranscribed: new Set(),
  items: [],
  insertionPoint: { type: "end" },
  insertionOrder: 0,
  error: null,
  ...overrides,
});

class ReducerTester<
  TState,
  TAction extends EventObject,
  TEffect extends EffectObject<TState, TAction>,
> {
  private reducer: EffectReducer<TState, TAction, TEffect>;
  private state: TState;
  private exec: EffectReducerExec<TState, TAction, TEffect>;

  constructor(
    reducer: EffectReducer<TState, TAction, TEffect>,
    initialState: TState
  ) {
    this.reducer = reducer;
    this.state = initialState;
    this.exec = createMockExec();
  }

  public send(action: TAction) {
    this.state = this.reducer(this.state, action, this.exec);
    return this;
  }

  public getState() {
    return this.state;
  }

  public getExec() {
    return this.exec;
  }
}

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
      expect(reportEffect2).not.toHaveBeenCalledWith({
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

    it("Optimistically added clips that have been archived will archive database clips that replace them", () => {
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
      const stateWithNoDatabaseClips = clipStateReducer(
        stateWithOneOptimisticClipDeleted,
        {
          type: "new-database-clips",
          clips: [fromPartial({ id: "123" })],
        },
        reportEffect
      );

      expect(stateWithNoDatabaseClips.items.length).toBe(0);
      expect(reportEffect).toHaveBeenCalledWith({
        type: "archive-clips",
        clipIds: ["123"],
      });
      expect(reportEffect).not.toHaveBeenCalledWith({
        type: "transcribe-clips",
        clipIds: ["123"],
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
    it(
      "Should move the insertion point to the previous clip when a clip is deleted"
    );
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
});
