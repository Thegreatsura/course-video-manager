import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  createInitialWriterTurnState,
  writerTurnReducer,
} from "./writer-turn-reducer";

const tester = () =>
  new ReducerTester(writerTurnReducer, createInitialWriterTurnState());

describe("writerTurnReducer", () => {
  it("a turn the API fails surfaces its kind, and Retry re-runs it", () => {
    const t = tester().send({ type: "turn-started" }).send({
      type: "turn-failed",
      error: "[writer:overloaded] Anthropic is overloaded right now (529).",
    });

    expect(t.getState()).toEqual({
      phase: "failed",
      failure: {
        kind: "overloaded",
        message: "Anthropic is overloaded right now (529).",
      },
      stopping: false,
    });

    const state = t
      .send({ type: "retry-requested" })
      .send({ type: "turn-started" })
      .send({ type: "turn-finished", unrecoveredToolError: null })
      .getState();

    expect(state).toEqual(createInitialWriterTurnState());
    expect(t.getEffects()).toEqual([{ type: "regenerate-last-turn" }]);
  });

  it("a turn that ends on a rejected tool call is a failure the user can retry", () => {
    const t = tester().send({ type: "turn-started" }).send({
      type: "turn-finished",
      unrecoveredToolError: "writeDocument input failed validation: content",
    });

    expect(t.getState().failure).toEqual({
      kind: "invalid-tool-input",
      message: "writeDocument input failed validation: content",
    });

    t.send({ type: "retry-requested" });
    expect(t.getState().phase).toBe("running");
    expect(t.getEffects()).toEqual([{ type: "regenerate-last-turn" }]);
  });

  it("a dropped connection with no server tag is named as one", () => {
    const state = tester()
      .send({ type: "turn-started" })
      .send({ type: "turn-failed", error: "Failed to fetch" })
      .getState();

    expect(state.failure?.kind).toBe("network");
  });

  it("stopping a turn is not a failure", () => {
    const t = tester()
      .send({ type: "turn-started" })
      .send({ type: "stop-requested" })
      .send({ type: "turn-finished", unrecoveredToolError: "half a call" });

    expect(t.getState()).toEqual(createInitialWriterTurnState());
    expect(t.getEffects()).toEqual([{ type: "stop-stream" }]);
  });

  it("a finished reply can be regenerated, but not while a turn runs", () => {
    const t = tester()
      .send({ type: "turn-started" })
      .send({ type: "regenerate-requested" })
      .send({ type: "retry-requested" })
      .send({ type: "turn-finished", unrecoveredToolError: null })
      .send({ type: "regenerate-requested" });

    expect(t.getState().phase).toBe("running");
    expect(t.getEffects()).toEqual([{ type: "regenerate-last-turn" }]);
  });

  it("a new message clears the last turn's failure, and so does clearing the chat", () => {
    const failed = () =>
      tester()
        .send({ type: "turn-started" })
        .send({ type: "turn-failed", error: "[writer:auth] bad key" });

    expect(failed().send({ type: "turn-started" }).getState().failure).toBe(
      null
    );
    expect(failed().send({ type: "chat-cleared" }).getState()).toEqual(
      createInitialWriterTurnState()
    );
  });
});
