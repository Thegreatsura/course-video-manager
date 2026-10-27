import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  createInitialPitchFormState,
  pitchFormReducer,
  selectWaitingSave,
} from "./pitch-form-reducer";

const form = () =>
  new ReducerTester(
    pitchFormReducer,
    createInitialPitchFormState({
      title: "Zod",
      description: "",
      youtubeTitle: "",
      youtubeThumbnailDescription: "",
      newsletterTitle: "",
      tweet: "",
    })
  );

const edit = (
  field: pitchFormReducer.Field,
  value: string
): pitchFormReducer.Action => ({
  type: "field-edited",
  pitchId: "p1",
  field,
  value,
});

describe("pitchFormReducer", () => {
  it("typing saves only the last value once it pauses, then shows Saved for a moment", () => {
    const tester = form()
      .send(edit("title", "Zod 4"))
      .send(edit("title", "Zod 4 is out"))
      .send({ type: "edit-pause-elapsed", editId: 1 })
      .send({ type: "edit-pause-elapsed", editId: 2 });

    expect(tester.getState().saveState).toBe("pending");

    tester.send({ type: "pitch-field-saved" });
    expect(tester.getState().saveState).toBe("saved");

    tester.send({ type: "saved-shown-elapsed", editId: 2 });
    expect(tester.getState()).toMatchObject({
      saveState: "idle",
      fields: { title: "Zod 4 is out" },
    });
    expect(tester.getEffects()).toEqual([
      { type: "wait-for-edit-pause", editId: 1 },
      { type: "wait-for-edit-pause", editId: 2 },
      {
        type: "save-pitch-field",
        pitchId: "p1",
        field: "title",
        value: "Zod 4 is out",
      },
      { type: "reload-pitch" },
      { type: "wait-before-hiding-saved", editId: 2 },
    ]);
  });

  it("moving to another field before the pause still saves the first one", () => {
    const tester = form()
      .send(edit("title", "Zod 4"))
      .send(edit("tweet", "New video"))
      .send({ type: "edit-pause-elapsed", editId: 2 });

    expect(tester.getEffects()).toEqual([
      { type: "wait-for-edit-pause", editId: 1 },
      {
        type: "save-pitch-field",
        pitchId: "p1",
        field: "title",
        value: "Zod 4",
      },
      { type: "wait-for-edit-pause", editId: 2 },
      {
        type: "save-pitch-field",
        pitchId: "p1",
        field: "tweet",
        value: "New video",
      },
    ]);
  });

  it("Saving… stays up while a newer edit is waiting or in flight, and an old Saved timer never hides it", () => {
    const tester = form()
      .send(edit("description", "A"))
      .send({ type: "edit-pause-elapsed", editId: 1 })
      .send({ type: "pitch-field-saved" })
      .send(edit("description", "AB"))
      .send({ type: "saved-shown-elapsed", editId: 1 });

    expect(tester.getState().saveState).toBe("pending");
    expect(selectWaitingSave(tester.getState())).toEqual({
      pitchId: "p1",
      field: "description",
      value: "AB",
    });

    tester
      .send({ type: "edit-pause-elapsed", editId: 2 })
      .send(edit("description", "ABC"))
      .send({ type: "pitch-field-saved" });

    expect(tester.getState().saveState).toBe("pending");
  });

  it("a failed save says so and never shows Saved", () => {
    const tester = form()
      .send(edit("newsletterTitle", "Hi"))
      .send({ type: "edit-pause-elapsed", editId: 1 })
      .resetExec()
      .send({ type: "pitch-field-save-failed" });

    expect(tester.getState().saveState).toBe("idle");
    expect(tester.getEffects()).toEqual([
      { type: "show-error", message: "Couldn't save the Pitch" },
    ]);
  });
});
