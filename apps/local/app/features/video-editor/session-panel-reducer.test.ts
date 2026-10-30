import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  createInitialSessionPanelState,
  selectElapsedSeconds,
  selectFocusIndicator,
  sessionPanelReducer,
} from "./session-panel-reducer";

const STARTED_AT = 1_000_000;

/** A panel mounted at `at`, and the effects its initial state declared. */
const mount = (init: { recording: boolean; at: number }) => {
  const mountEffects: sessionPanelReducer.Effect[] = [];
  const state = createInitialSessionPanelState(
    {
      recording: init.recording,
      startedAt: STARTED_AT,
      at: init.at,
      activeDiagramOpen: false,
      diagramFocused: false,
      browserFocused: false,
    },
    (effect) => {
      mountEffects.push(effect);
      return undefined as never;
    }
  );
  return {
    tester: new ReducerTester(sessionPanelReducer, state),
    mountEffects,
  };
};

const heard = (
  recording: boolean,
  at: number,
  startedAt = STARTED_AT
): sessionPanelReducer.Action => ({
  type: "session-heard",
  recording,
  startedAt,
  at,
  activeDiagramOpen: false,
});

const tick = (
  at: number,
  activeDiagramOpen = false
): sessionPanelReducer.Action => ({
  type: "clock-ticked",
  at,
  activeDiagramOpen,
});

describe("sessionPanelReducer", () => {
  it("a panel mounted on a recording session counts from the session's start, by the ticks it is sent", () => {
    const { tester, mountEffects } = mount({
      recording: true,
      at: STARTED_AT + 2_500,
    });
    expect(selectElapsedSeconds(tester.getState())).toBe(2);

    // The bridge reports the same session on mount: no second clock.
    tester
      .send(heard(true, STARTED_AT + 2_600))
      .send(tick(STARTED_AT + 3_600))
      .send(tick(STARTED_AT + 4_600));

    expect(selectElapsedSeconds(tester.getState())).toBe(4);
    expect(mountEffects).toEqual([{ type: "tick-every-second" }]);
    expect(tester.getEffects()).toEqual([]);
  });

  it("a session that starts recording after mount starts the clock, and stopping freezes it", () => {
    const { tester, mountEffects } = mount({ recording: false, at: 0 });

    tester
      .send(tick(STARTED_AT + 5_000))
      .send(heard(true, STARTED_AT))
      .send(tick(STARTED_AT + 1_000))
      .send(heard(false, STARTED_AT + 1_500))
      .send(tick(STARTED_AT + 9_000));

    expect(selectElapsedSeconds(tester.getState())).toBe(1);
    expect(selectFocusIndicator(tester.getState())).toBeNull();
    expect(mountEffects).toEqual([]);
    expect(tester.getEffects()).toEqual([{ type: "tick-every-second" }]);
  });

  it("a session restarted with a new start time counts again from that start", () => {
    const { tester } = mount({ recording: true, at: STARTED_AT + 60_000 });
    const restartedAt = STARTED_AT + 120_000;

    tester
      .send(heard(true, restartedAt + 500, restartedAt))
      .send(tick(restartedAt + 3_000));

    expect(selectElapsedSeconds(tester.getState())).toBe(3);
    expect(tester.getEffects()).toEqual([{ type: "tick-every-second" }]);
  });

  it("while recording, a focused Diagram beats a focused URL, which beats an open unfocused Diagram", () => {
    const { tester } = mount({ recording: true, at: STARTED_AT });
    const indicator = () => selectFocusIndicator(tester.getState());

    expect(indicator()).toBeNull();
    tester.send(tick(STARTED_AT + 1_000, true));
    expect(indicator()).toBe("diagram-not-focused");
    tester.send({ type: "browser-focus-changed", focused: true });
    expect(indicator()).toBe("url-focused");
    tester.send({ type: "diagram-focus-changed", focused: true });
    expect(indicator()).toBe("diagram-focused");
    tester.send({ type: "diagram-focus-changed", focused: false });
    expect(indicator()).toBe("url-focused");
    tester.send(heard(false, STARTED_AT + 2_000));
    expect(indicator()).toBeNull();
    expect(tester.getEffects()).toEqual([]);
  });
});
