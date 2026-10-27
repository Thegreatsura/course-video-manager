import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  createInitialVideoFilePasteState,
  videoFilePasteReducer,
} from "./video-file-paste-reducer";

const dialog = () =>
  new ReducerTester(
    videoFilePasteReducer,
    createInitialVideoFilePasteState()
  ).send({ type: "modal-opened" });

describe("videoFilePasteReducer", () => {
  it("pasted text is named after the next free default filename, created, then reported once", () => {
    const tester = dialog()
      .send({
        type: "content-pasted",
        content: { type: "text", data: "# Notes" },
        existingPaths: ["notes.md", "notes-1.md"],
      })
      .send({ type: "create-clicked", videoId: "v1" })
      .send({ type: "create-clicked", videoId: "v1" })
      .send({ type: "file-created", path: "notes-2.md" });

    expect(tester.getEffects()).toEqual([
      { type: "focus-paste-area" },
      { type: "focus-path-input" },
      {
        type: "create-file",
        videoId: "v1",
        path: "notes-2.md",
        content: "# Notes",
      },
      { type: "close-modal" },
      { type: "report-file-created", path: "notes-2.md" },
    ]);
  });

  it("a pasted image takes the next free diagram number, under a path the user can rename", () => {
    const tester = dialog()
      .send({
        type: "content-pasted",
        content: { type: "image", data: "data:image/png;base64,AAA" },
        existingPaths: ["diagram-1.png", "notes.md"],
        defaultTextFilename: "notes.md",
      })
      .send({ type: "path-edited", path: "architecture.png" })
      .send({ type: "create-clicked", videoId: "v1" });

    expect(tester.getEffects()).toContainEqual({
      type: "create-file",
      videoId: "v1",
      path: "architecture.png",
      content: "data:image/png;base64,AAA",
    });
  });

  it("a custom default filename without .md gets a plain counter", () => {
    const state = dialog()
      .send({
        type: "content-pasted",
        content: { type: "text", data: "x" },
        existingPaths: ["transcript.txt"],
        defaultTextFilename: "transcript.txt",
      })
      .getState();

    expect(state.path).toBe("transcript.txt-1");
  });

  it("nothing is created with no paste or a blank path, and reopening starts empty", () => {
    const tester = dialog()
      .send({ type: "create-clicked", videoId: "v1" })
      .send({
        type: "content-pasted",
        content: { type: "text", data: "x" },
        existingPaths: [],
      })
      .send({ type: "path-edited", path: "" })
      .send({ type: "create-clicked", videoId: "v1" })
      .send({ type: "modal-opened" });

    expect(tester.getState()).toEqual(createInitialVideoFilePasteState());
    expect(tester.getEffects()).toEqual([
      { type: "focus-paste-area" },
      { type: "focus-path-input" },
      { type: "focus-paste-area" },
    ]);
  });

  it("a failed create can be retried, and a stale success never closes a dialog that created nothing", () => {
    const tester = dialog()
      .send({ type: "file-created", path: "old.md" })
      .send({
        type: "content-pasted",
        content: { type: "text", data: "x" },
        existingPaths: [],
      })
      .send({ type: "create-clicked", videoId: "v1" })
      .send({ type: "file-create-failed" })
      .send({ type: "create-clicked", videoId: "v1" });

    expect(tester.getEffects()).toEqual([
      { type: "focus-paste-area" },
      { type: "focus-path-input" },
      { type: "create-file", videoId: "v1", path: "notes.md", content: "x" },
      { type: "create-file", videoId: "v1", path: "notes.md", content: "x" },
    ]);
  });
});
