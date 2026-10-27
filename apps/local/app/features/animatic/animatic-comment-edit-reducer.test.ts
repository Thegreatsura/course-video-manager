import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  animaticCommentEditReducer,
  createInitialAnimaticCommentEditState,
} from "./animatic-comment-edit-reducer";

const comment = () =>
  new ReducerTester(
    animaticCommentEditReducer,
    createInitialAnimaticCommentEditState()
  );

describe("animaticCommentEditReducer", () => {
  it("an edit starts from the body as it is now and saves it trimmed", () => {
    const tester = comment()
      .send({ type: "edit-clicked", body: "Polled body" })
      .send({ type: "edit-draft-edited", draft: "Polled body, edited " })
      .send({ type: "edit-saved", commentId: "c1", body: "Polled body" });

    expect(tester.getState().editing).toBe(false);
    expect(tester.getEffects()).toEqual([
      {
        type: "write-comment",
        event: { type: "update", commentId: "c1", body: "Polled body, edited" },
      },
    ]);
  });

  it("an unchanged edit closes without a write, a blank one stays open, and Cancel drops the draft", () => {
    const tester = comment()
      .send({ type: "edit-clicked", body: "Same" })
      .send({ type: "edit-draft-edited", draft: " Same " })
      .send({ type: "edit-saved", commentId: "c1", body: "Same" });
    expect(tester.getState().editing).toBe(false);

    tester
      .send({ type: "edit-clicked", body: "Same" })
      .send({ type: "edit-draft-edited", draft: "  " })
      .send({ type: "edit-saved", commentId: "c1", body: "Same" });
    expect(tester.getState().editing).toBe(true);

    tester
      .send({ type: "edit-cancelled" })
      .send({ type: "edit-clicked", body: "Same" });
    expect(tester.getState()).toEqual({ editing: true, draft: "Same" });
    expect(tester.getEffects()).toEqual([]);
  });
});
