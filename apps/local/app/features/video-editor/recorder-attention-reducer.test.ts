import { describe, expect, it } from "vitest";
import {
  createInitialRecorderAttentionState,
  holdsRecorder,
  recorderAttentionReducer,
  type recorderAttentionReducer as attention,
} from "./recorder-attention-reducer";

const MINUTE = 60_000;

/**
 * The editor's away count on a fake clock: `wait-while-away` is a timer at
 * `now + ms`, stopped when the reducer stops it, and `advance` fires the due
 * ones as `use-cvm-recorder.ts` does.
 */
const editor = () => {
  let state = createInitialRecorderAttentionState();
  let now = 0;
  const timers = new Map<object, number>();
  const exec = Object.assign(
    (effect: attention.Effect) => {
      const timer = {};
      timers.set(timer, now + effect.ms);
      return timer;
    },
    { stop: (timer: object) => void timers.delete(timer) }
  ) as never;
  const send = (action: attention.Action) => {
    state = recorderAttentionReducer(state, action, exec);
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [timer, due] of timers) {
      if (due > now || !timers.has(timer)) continue;
      timers.delete(timer);
      send({ type: "away-time-elapsed" });
    }
  };
  return { send, advance, holds: () => holdsRecorder(state) };
};

describe("an editor letting the recorder go when its window is left (#2383)", () => {
  it("lets it go once the window has been unfocused for 2 minutes", () => {
    const e = editor();
    e.send({ type: "window-left" });
    e.advance(2 * MINUTE - 1);
    expect(e.holds()).toBe(true);
    e.advance(1);
    expect(e.holds()).toBe(false);
  });

  it("focus coming back cancels the count, and takes the recorder back once it has gone", () => {
    const e = editor();
    e.send({ type: "window-left" });
    e.advance(MINUTE);
    e.send({ type: "window-focused" });
    e.advance(10 * MINUTE);
    expect(e.holds()).toBe(true);

    // Left again: the count starts afresh.
    e.send({ type: "window-left" });
    e.advance(MINUTE);
    expect(e.holds()).toBe(true);
    e.advance(MINUTE);
    expect(e.holds()).toBe(false);

    e.send({ type: "window-focused" });
    expect(e.holds()).toBe(true);
  });

  it("never lets it go while a Recording Session holds it; once over, counts 2 minutes afresh", () => {
    const e = editor();
    e.send({ type: "recording-heard", recording: true });
    e.send({ type: "window-left" });
    e.advance(30 * MINUTE);
    expect(e.holds()).toBe(true);

    e.send({ type: "recording-heard", recording: false });
    e.advance(2 * MINUTE - 1);
    expect(e.holds()).toBe(true);
    e.advance(1);
    expect(e.holds()).toBe(false);
  });
});
