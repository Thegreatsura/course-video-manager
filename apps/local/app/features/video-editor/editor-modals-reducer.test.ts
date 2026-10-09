import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  createInitialEditorModalsState,
  editorModalsReducer,
} from "./editor-modals-reducer";

const editor = () =>
  new ReducerTester(editorModalsReducer, createInitialEditorModalsState());

describe("editorModalsReducer", () => {
  it("opening a dialog replaces the open one, and the replaced one's late close leaves it open", () => {
    const tester = editor()
      .send({ type: "rename-video-clicked" })
      .send({ type: "copy-video-clicked" })
      .send({ type: "modal-dismissed", modal: "rename-video" });

    expect(tester.getState().openModal).toBe("copy-video");

    tester.send({ type: "modal-dismissed", modal: "copy-video" });

    expect(tester.getState().openModal).toBeNull();
    expect(tester.getEffects()).toEqual([]);
  });

  it("closing the paste dialog refreshes the video's files", () => {
    const tester = editor()
      .send({ type: "add-note-from-clipboard-clicked" })
      .send({ type: "modal-dismissed", modal: "paste-file" });

    expect(tester.getState().openModal).toBeNull();
    expect(tester.getEffects()).toEqual([{ type: "refresh-video-files" }]);
  });
});
