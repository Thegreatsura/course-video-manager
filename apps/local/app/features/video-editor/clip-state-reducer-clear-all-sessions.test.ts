import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vitest";
import {
  clipStateReducer,
  type DatabaseId,
  type FrontendId,
} from "./clip-state-reducer";
import { ReducerTester } from "@/test-utils/reducer-tester";
import { countClipsToClear, getSessionPanels } from "./video-editor-selectors";

const createInitialState = (): clipStateReducer.State => ({
  clipIdsBeingTranscribed: new Set(),
  clipIdsWithTranscriptWords: new Set(),
  // A clip already on the timeline when the editor opened: deleting it puts
  // it in the "Deleted clips" panel, which has its own "Clear all".
  items: [
    fromPartial({
      type: "on-database",
      frontendId: "fe-timeline" as FrontendId,
      databaseId: "db-timeline" as DatabaseId,
    }),
  ],
  insertionPoint: { type: "end" },
  insertionOrder: 0,
  error: null,
  sessions: [],
});

/**
 * Two Recording Sessions, each with a deleted clip, the second still holding
 * one pending clip; plus a deleted timeline clip in the "Deleted clips" panel.
 */
const recordTwoSessions = () => {
  const tester = new ReducerTester(clipStateReducer, createInitialState());

  tester
    .send({
      type: "recording-started",
      outputPath: "/tmp/recording-1.mkv",
      silenceLength: "short",
    })
    .send(
      fromPartial({
        type: "new-optimistic-clip-detected",
        soundDetectionId: "sound-1",
      })
    );
  const session1Clip = tester.getState().items[1]!.frontendId;
  tester
    .send({ type: "clips-deleted", clipIds: [session1Clip] })
    .send({ type: "recording-stopped" })
    .send({
      type: "recording-started",
      outputPath: "/tmp/recording-2.mkv",
      silenceLength: "short",
    })
    .send(
      fromPartial({
        type: "new-optimistic-clip-detected",
        soundDetectionId: "sound-2",
      })
    )
    .send(
      fromPartial({
        type: "new-optimistic-clip-detected",
        soundDetectionId: "sound-3",
      })
    );
  const session2Clip = tester.getState().items[2]!.frontendId;
  tester.send({
    type: "clips-deleted",
    clipIds: [session2Clip, "fe-timeline" as FrontendId],
  });

  return tester.resetExec();
};

const panelsOf = (state: clipStateReducer.State) =>
  getSessionPanels(state.items, state.sessions);

// Ids are random per run, so compare clips by what identifies them here.
const survivors = (state: clipStateReducer.State) =>
  state.items.map((item) => ({
    type: item.type,
    insertionOrder: "insertionOrder" in item ? item.insertionOrder : null,
  }));

describe("clearing all Recording Sessions at once", () => {
  it("clears every session's archived clips, keeps the pending one, and touches no server", () => {
    const tester = recordTwoSessions();
    expect(countClipsToClear(panelsOf(tester.getState()))).toBe(3);

    const state = tester
      .send({ type: "permanently-remove-all-archived" })
      .getState();

    expect(countClipsToClear(panelsOf(state))).toBe(0);
    expect(survivors(state)).toEqual([
      { type: "optimistically-added", insertionOrder: 3 },
    ]);
    expect(tester.getEffects()).toEqual([]);
  });

  it("does exactly what pressing each session's own Clear all does", () => {
    const oneByOne = recordTwoSessions();
    for (const panel of panelsOf(oneByOne.getState())) {
      oneByOne.send({
        type: "permanently-remove-archived",
        sessionId: panel.sessionId,
      });
    }

    const allAtOnce = recordTwoSessions().send({
      type: "permanently-remove-all-archived",
    });

    expect(survivors(allAtOnce.getState())).toEqual(
      survivors(oneByOne.getState())
    );
    expect(allAtOnce.getEffects()).toEqual(oneByOne.getEffects());
  });
});
