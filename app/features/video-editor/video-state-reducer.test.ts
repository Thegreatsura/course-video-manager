import { describe, expect, it, vi } from "vitest";
import { makeVideoEditorReducer } from "./video-state-reducer";
import type { videoStateReducer } from "./video-state-reducer";
import type { FrontendId } from "./clip-state-reducer";
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
}

const createInitialState = (
  overrides: Partial<videoStateReducer.State> = {}
): videoStateReducer.State => ({
  clipIdsPreloaded: new Set(),
  runningState: "paused",
  currentClipId: undefined,
  currentTimeInClip: 0,
  selectedClipsSet: new Set(),
  playbackRate: 1,
  showLastFrameOfVideo: false,
  ...overrides,
});

describe("videoStateReducer", () => {
  describe("shift-click multi-select", () => {
    it("should select range from section header to clip when shift-clicking", () => {
      const sectionId = "section-1" as FrontendId;
      const clip1 = "clip-1" as FrontendId;
      const clip2 = "clip-2" as FrontendId;
      const clip3 = "clip-3" as FrontendId;

      const itemIds = [clip1, sectionId, clip2, clip3];
      const clipIds = [clip1, clip2, clip3];

      const reducer = makeVideoEditorReducer(itemIds, clipIds);

      // Start with section header selected
      const tester = new ReducerTester(
        reducer,
        createInitialState({
          selectedClipsSet: new Set([sectionId]),
          currentClipId: clip1,
        })
      );

      // Shift-click clip3
      const state = tester
        .send({
          type: "click-clip",
          clipId: clip3,
          ctrlKey: false,
          shiftKey: true,
        })
        .getState();

      // Should select everything from sectionId to clip3
      expect(state.selectedClipsSet).toEqual(
        new Set([sectionId, clip2, clip3])
      );
    });

    it("should select range from clip to section header when shift-clicking", () => {
      const clip1 = "clip-1" as FrontendId;
      const sectionId = "section-1" as FrontendId;
      const clip2 = "clip-2" as FrontendId;

      const itemIds = [clip1, sectionId, clip2];
      const clipIds = [clip1, clip2];

      const reducer = makeVideoEditorReducer(itemIds, clipIds);

      // Start with clip2 selected
      const tester = new ReducerTester(
        reducer,
        createInitialState({
          selectedClipsSet: new Set([clip2]),
          currentClipId: clip1,
        })
      );

      // Shift-click clip1 (backwards selection)
      const state = tester
        .send({
          type: "click-clip",
          clipId: clip1,
          ctrlKey: false,
          shiftKey: true,
        })
        .getState();

      // Should select everything from clip1 to clip2, including the section
      expect(state.selectedClipsSet).toEqual(
        new Set([clip1, sectionId, clip2])
      );
    });

    it("should select range between two clips (no sections involved)", () => {
      const clip1 = "clip-1" as FrontendId;
      const clip2 = "clip-2" as FrontendId;
      const clip3 = "clip-3" as FrontendId;

      const itemIds = [clip1, clip2, clip3];
      const clipIds = [clip1, clip2, clip3];

      const reducer = makeVideoEditorReducer(itemIds, clipIds);

      const tester = new ReducerTester(
        reducer,
        createInitialState({
          selectedClipsSet: new Set([clip1]),
          currentClipId: clip1,
        })
      );

      const state = tester
        .send({
          type: "click-clip",
          clipId: clip3,
          ctrlKey: false,
          shiftKey: true,
        })
        .getState();

      expect(state.selectedClipsSet).toEqual(new Set([clip1, clip2, clip3]));
    });
  });
});
