import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  createInitialShortsPostingState,
  selectDescriptionRequest,
  shortsPostingReducer,
} from "./shorts-posting-reducer";

const modal = (videoTitle = "Zod in 60 seconds") =>
  new ReducerTester(
    shortsPostingReducer,
    createInitialShortsPostingState(videoTitle)
  );

describe("shortsPostingReducer", () => {
  it("opening with a blank description generates one, once per mount, and fills it without asking", () => {
    const tester = modal()
      .send({
        type: "modal-opened",
        videoId: "short-1",
        mode: "both",
        description: "",
      })
      .send({ type: "text-generated", field: "description", text: "A Short" })
      .send({ type: "modal-closed" })
      .send({
        type: "modal-opened",
        videoId: "short-1",
        mode: "both",
        description: "",
      });

    expect(tester.getEffects()).toEqual([
      { type: "load-posted-status", videoId: "short-1" },
      {
        type: "generate-text",
        field: "description",
        request: selectDescriptionRequest("short-1"),
      },
      { type: "apply-field-text", field: "description", text: "A Short" },
      { type: "load-posted-status", videoId: "short-1" },
    ]);
  });

  it("a TikTok-only post never generates a description and goes to Buffer alone", () => {
    const tester = modal()
      .send({
        type: "modal-opened",
        videoId: "short-1",
        mode: "tiktok",
        description: "",
      })
      .send({
        type: "post-clicked",
        videoId: "short-1",
        mode: "tiktok",
        description: "",
      })
      .send({ type: "vertical-export-checked", exists: true });

    expect(tester.getEffects()).toEqual([
      { type: "load-posted-status", videoId: "short-1" },
      { type: "check-vertical-export", videoId: "short-1" },
      {
        type: "start-short-posting",
        videoId: "short-1",
        title: "Zod in 60 seconds",
        description: "",
        exportFirst: false,
        toYoutube: false,
        toBuffer: true,
      },
      { type: "close-modal" },
      { type: "show-toast", title: "Buffer posting started" },
    ]);
  });

  it("with no vertical export, both posts queue behind a new one", () => {
    const tester = modal()
      .send({ type: "title-edited", title: "  Zod tips  " })
      .send({
        type: "post-clicked",
        videoId: "short-1",
        mode: "both",
        description: " Learn Zod \n",
      })
      .send({ type: "vertical-export-checked", exists: false });

    expect(tester.getState().checkingExport).toBeNull();
    expect(tester.getEffects()).toEqual([
      { type: "check-vertical-export", videoId: "short-1" },
      {
        type: "start-short-posting",
        videoId: "short-1",
        title: "Zod tips",
        description: "Learn Zod",
        exportFirst: true,
        toYoutube: true,
        toBuffer: true,
      },
      { type: "close-modal" },
      {
        type: "show-toast",
        title: "Export + post started",
        description: '"Zod tips" will export first, then post',
      },
    ]);
  });

  it("Post Short is refused with the default title, or no description for YouTube", () => {
    const tester = modal("Short 7/16/2026")
      .send({
        type: "post-clicked",
        videoId: "short-1",
        mode: "both",
        description: "Learn Zod",
      })
      .send({ type: "title-edited", title: "Zod tips" })
      .send({
        type: "post-clicked",
        videoId: "short-1",
        mode: "youtube",
        description: "  ",
      });

    expect(tester.getState().checkingExport).toBeNull();
    expect(tester.getEffects()).toEqual([
      {
        type: "show-error",
        title:
          "Rename this short before posting — it still has its default title.",
      },
      { type: "show-error", title: "Description is required" },
    ]);
  });

  it("a renamed title is saved on blur, and a refused rename puts the saved title back", () => {
    const tester = modal()
      .send({ type: "title-blurred", videoId: "short-1" })
      .send({ type: "title-edited", title: " Zod tips " })
      .send({ type: "title-blurred", videoId: "short-1" })
      .send({ type: "rename-refused", reason: "name-taken" });

    expect(tester.getState().title).toBe("Zod in 60 seconds");
    expect(tester.getEffects()).toEqual([
      { type: "rename-short", videoId: "short-1", name: "Zod tips" },
      {
        type: "show-error",
        title: "That name is already taken in this lesson.",
      },
    ]);
  });

  it("a failed generation says so, and where a Short was posted is only shown for the open Short", () => {
    const tester = modal()
      .send({
        type: "modal-opened",
        videoId: "short-1",
        mode: "youtube",
        description: "",
      })
      .send({ type: "text-generation-failed", field: "description" })
      .send({ type: "modal-closed" })
      .send({
        type: "posted-status-loaded",
        videoId: "short-1",
        postedStatus: { youtube: true, tiktok: false },
      });

    expect(tester.getState().postedStatus).toBeNull();
    expect(tester.getState().fields.generating).toBeNull();
    expect(tester.getEffects()).toEqual([
      { type: "load-posted-status", videoId: "short-1" },
      {
        type: "generate-text",
        field: "description",
        request: selectDescriptionRequest("short-1"),
      },
      { type: "show-error", title: "Failed to generate text" },
    ]);
  });
});
