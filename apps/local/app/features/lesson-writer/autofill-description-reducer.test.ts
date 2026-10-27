import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  autofillDescriptionReducer,
  createInitialAutofillDescriptionState,
} from "./autofill-description-reducer";

const opened = () =>
  new ReducerTester(
    autofillDescriptionReducer,
    createInitialAutofillDescriptionState()
  )
    .send({ type: "modal-opened", videoId: "v1" })
    // StrictMode runs the opening bridge twice; it still loads once.
    .send({ type: "modal-opened", videoId: "v1" });

describe("autofillDescriptionReducer", () => {
  it("a blank description with a lesson body autofills by itself, and the result replaces the box", () => {
    const tester = opened()
      .send({
        type: "lesson-writer-data-loaded",
        videoId: "v1",
        description: "  ",
        body: "Generics, explained.",
      })
      .send({ type: "autofill-succeeded", text: "Learn generics." });

    expect(tester.getState()).toMatchObject({
      status: "ready",
      description: "Learn generics.",
      autofilling: false,
    });
    expect(tester.getEffects()).toEqual([
      { type: "load-lesson-writer-data", videoId: "v1" },
      { type: "autofill-description", videoId: "v1" },
    ]);
  });

  it("an existing description is shown as it is, and Save writes what was typed and closes", () => {
    const tester = opened()
      .send({
        type: "lesson-writer-data-loaded",
        videoId: "v1",
        description: "Old",
        body: "Body",
      })
      .send({ type: "description-edited", description: "New" })
      .send({ type: "save-clicked", videoId: "v1" });

    expect(tester.getEffects()).toEqual([
      { type: "load-lesson-writer-data", videoId: "v1" },
      { type: "save-description", videoId: "v1", description: "New" },
      { type: "close-modal" },
    ]);
  });

  it("with no lesson body there is nothing to autofill from", () => {
    const tester = opened()
      .send({
        type: "lesson-writer-data-loaded",
        videoId: "v1",
        description: "",
        body: null,
      })
      .send({ type: "autofill-clicked", videoId: "v1" });

    expect(tester.getState().bodyIsEmpty).toBe(true);
    expect(tester.getEffects()).toEqual([
      { type: "load-lesson-writer-data", videoId: "v1" },
    ]);
  });

  it("a refused Autofill shows why, keeps the text, and can be retried; Save waits for it", () => {
    const tester = opened()
      .send({
        type: "lesson-writer-data-loaded",
        videoId: "v1",
        description: "Draft",
        body: "Body",
      })
      .send({ type: "autofill-clicked", videoId: "v1" })
      .send({ type: "save-clicked", videoId: "v1" })
      .send({ type: "autofill-failed", error: "The lesson body is empty." })
      .send({ type: "autofill-clicked", videoId: "v1" });

    expect(tester.getState()).toMatchObject({
      description: "Draft",
      autofillError: "The lesson body is empty.",
      autofilling: true,
    });
    expect(tester.getEffects()).toEqual([
      { type: "load-lesson-writer-data", videoId: "v1" },
      { type: "autofill-description", videoId: "v1" },
      { type: "autofill-description", videoId: "v1" },
    ]);
  });
});
