import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  animaticCommentThreadReducer,
  createInitialAnimaticCommentThreadState,
  selectThreadTarget,
} from "./animatic-comment-thread-reducer";

const thread = () =>
  new ReducerTester(
    animaticCommentThreadReducer,
    createInitialAnimaticCommentThreadState()
  );

const mockup = (id: string) => ({ type: "clip-mockup", id }) as const;

describe("animaticCommentThreadReducer", () => {
  it("a comment typed as the Animatic plays on lands on the Clip Mockup the thread opened on", () => {
    const tester = thread()
      .send({ type: "popover-toggled", open: true })
      .send({ type: "thread-shown", target: mockup("m1") })
      // The stage moves on; the bridge reports it again only on reopen.
      .send({ type: "thread-shown", target: mockup("m2") })
      .send({ type: "draft-edited", draft: "  Zoom in here  " })
      .send({ type: "comment-submitted" });

    expect(selectThreadTarget(tester.getState(), mockup("m2"))).toEqual(
      mockup("m1")
    );
    expect(tester.getState().draft).toBe("");
    expect(tester.getEffects()).toEqual([
      {
        type: "write-comment",
        event: { type: "create", target: mockup("m1"), body: "Zoom in here" },
      },
    ]);
  });

  it("closed and reopened, the thread follows the stage again and keeps an unsent draft", () => {
    const state = thread()
      .send({ type: "thread-shown", target: mockup("m1") })
      .send({ type: "draft-edited", draft: "Half a thought" })
      .send({ type: "popover-toggled", open: false })
      .send({ type: "thread-hidden" })
      .send({ type: "thread-shown", target: mockup("m3") })
      .getState();

    expect(selectThreadTarget(state, mockup("m4"))).toEqual(mockup("m3"));
    expect(state.draft).toBe("Half a thought");
  });

  it("a blank comment is never sent", () => {
    const tester = thread()
      .send({ type: "thread-shown", target: mockup("m1") })
      .send({ type: "draft-edited", draft: "   " })
      .send({ type: "comment-submitted" });

    expect(tester.getEffects()).toEqual([]);
  });
});
