import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  createInitialPostPageState,
  postPageReducer,
  selectGenerateRequest,
  type PostGenerationContext,
} from "./post-page-reducer";

const page = (selectedThumbnailId: string | null = "thumb-1") =>
  new ReducerTester(
    postPageReducer,
    createInitialPostPageState(selectedThumbnailId)
  );

const context: PostGenerationContext = {
  videoId: "video-1",
  enabledFiles: new Set(["notes.md"]),
  enabledSections: new Set(),
  includeTranscript: true,
  hasChapters: true,
  courseStructure: null,
  includeCourseStructure: true,
};

const generate = (field: postPageReducer.Field, currentText: string) =>
  ({
    type: "generate-clicked",
    field,
    currentText,
    askToReplace: true,
    request: selectGenerateRequest(field, context),
  }) as const;

describe("postPageReducer", () => {
  it("a generated title fills a blank title straight away", () => {
    const tester = page()
      .send(generate("title", "  "))
      .send({ type: "text-generated", field: "title", text: "Learn Zod" });

    expect(tester.getState().fields).toEqual({
      generating: null,
      pendingOverwrite: null,
    });
    expect(tester.getEffects()).toEqual([
      {
        type: "generate-text",
        field: "title",
        // With chapters and none ticked, the transcript stays out.
        request: {
          videoId: "video-1",
          mode: "youtube-title-single",
          enabledFiles: ["notes.md"],
          includeTranscript: false,
          enabledSections: [],
          courseStructure: undefined,
        },
      },
      { type: "apply-field-text", field: "title", text: "Learn Zod" },
    ]);
  });

  it("a generated description asks before replacing text; Cancel keeps it, Replace applies the new one", () => {
    const tester = page()
      .send(generate("description", "Old words"))
      .send({ type: "text-generated", field: "description", text: "New one" });

    expect(tester.getState().fields.pendingOverwrite).toEqual({
      field: "description",
      currentText: "Old words",
      pendingText: "New one",
    });

    tester
      .send({ type: "overwrite-cancelled" })
      .send(generate("description", "Old words"))
      .send({ type: "text-generated", field: "description", text: "Newer" })
      .send({ type: "overwrite-confirmed" });

    expect(tester.getState().fields.pendingOverwrite).toBeNull();
    const generateDescription = {
      type: "generate-text",
      field: "description",
      request: selectGenerateRequest("description", context),
    };
    expect(tester.getEffects()).toEqual([
      generateDescription,
      generateDescription,
      { type: "apply-field-text", field: "description", text: "Newer" },
    ]);
  });

  it("Copy from Pitch asks before replacing a typed title, and fills a blank one", () => {
    const tester = page().send({
      type: "copy-from-pitch-clicked",
      pitchTitle: "Pitch title",
      currentTitle: "Mine",
    });

    expect(tester.getState().fields.pendingOverwrite).toEqual({
      field: "title",
      currentText: "Mine",
      pendingText: "Pitch title",
    });
    expect(tester.getEffects()).toEqual([]);

    tester.send({ type: "overwrite-cancelled" }).send({
      type: "copy-from-pitch-clicked",
      pitchTitle: "Pitch title",
      currentTitle: "",
    });

    expect(tester.getEffects()).toEqual([
      { type: "apply-field-text", field: "title", text: "Pitch title" },
    ]);
  });

  it("one generation at a time; a failed one frees both buttons and applies nothing", () => {
    const tester = page()
      .send(generate("title", ""))
      .send(generate("description", ""))
      .send({ type: "text-generation-failed", field: "title" })
      .send(generate("description", ""));

    expect(tester.getState().fields.generating?.field).toBe("description");
    expect(tester.getEffects()).toEqual([
      {
        type: "generate-text",
        field: "title",
        request: selectGenerateRequest("title", context),
      },
      {
        type: "generate-text",
        field: "description",
        request: selectGenerateRequest("description", context),
      },
    ]);
  });

  it("Post checks for the Exported Video once, then queues the export ahead of the upload when there is none", () => {
    const tester = page()
      .send({ type: "privacy-status-selected", privacyStatus: "public" })
      .send({
        type: "post-clicked",
        videoId: "video-1",
        title: "Learn Zod",
        description: "All about Zod",
      })
      .send({
        type: "post-clicked",
        videoId: "video-1",
        title: "Learn Zod",
        description: "All about Zod",
      })
      .send({ type: "export-checked", exists: false });

    expect(tester.getState().checkingExport).toBeNull();
    expect(tester.getEffects()).toEqual([
      { type: "check-export", videoId: "video-1" },
      {
        type: "start-youtube-upload",
        videoId: "video-1",
        title: "Learn Zod",
        description: "All about Zod",
        privacyStatus: "public",
        thumbnailId: "thumb-1",
        exportFirst: true,
      },
      {
        type: "show-toast",
        title: "Export + upload started",
        description: '"Learn Zod" will export first, then upload to YouTube',
      },
    ]);
  });

  it("Post does nothing without a Thumbnail, a description, or a title YouTube would accept", () => {
    const tester = page()
      .send({ type: "thumbnail-delete-clicked", thumbnailId: "thumb-1" })
      .send({
        type: "post-clicked",
        videoId: "video-1",
        title: "Learn Zod",
        description: "All about Zod",
      })
      .send({ type: "thumbnail-selected", thumbnailId: "thumb-2" })
      .send({
        type: "post-clicked",
        videoId: "video-1",
        title: "Learn Zod",
        description: " ",
      })
      .send({
        type: "post-clicked",
        videoId: "video-1",
        title: "x".repeat(101),
        description: "All about Zod",
      });

    expect(tester.getState().checkingExport).toBeNull();
    expect(tester.getEffects()).toEqual([
      { type: "delete-thumbnail", thumbnailId: "thumb-1" },
    ]);
  });

  it("the YouTube id is read when the Video opens and stored when its upload Job succeeds", () => {
    const tester = page()
      .send({ type: "video-opened", videoId: "video-1" })
      .send({ type: "stored-youtube-video-id-read", youtubeVideoId: null });

    expect(tester.getState().storedYoutubeVideoId).toBe("");

    tester.send({
      type: "youtube-upload-succeeded",
      videoId: "video-1",
      youtubeVideoId: "yt-123",
    });

    expect(tester.getState().storedYoutubeVideoId).toBe("yt-123");
    expect(tester.getEffects()).toEqual([
      { type: "read-stored-youtube-video-id", videoId: "video-1" },
      {
        type: "store-youtube-video-id",
        videoId: "video-1",
        youtubeVideoId: "yt-123",
      },
    ]);
  });

  it("short links replace each aihero.dev URL in the description as it was when pressed", () => {
    const description =
      "See https://aihero.dev/a and https://aihero.dev/s/done and https://aihero.dev/a";
    const tester = page()
      .send({
        type: "convert-short-links-clicked",
        title: "",
        description: "No links here",
      })
      .send({
        type: "convert-short-links-clicked",
        title: "",
        description: "Only https://aihero.dev/s/done",
      })
      .send({ type: "convert-short-links-clicked", title: "", description })
      .send({
        type: "short-links-created",
        links: [
          {
            url: "https://aihero.dev/a",
            shortLinkUrl: "https://aihero.dev/s/x",
          },
        ],
      });

    expect(tester.getState().convertingShortLinks).toBeNull();
    expect(tester.getEffects()).toEqual([
      {
        type: "show-toast",
        title: "No aihero.dev links found",
        description: "The description doesn't contain any aihero.dev URLs.",
      },
      {
        type: "show-toast",
        title: "All links already converted",
        description: "All aihero.dev links are already short links.",
      },
      {
        type: "create-short-links",
        urls: ["https://aihero.dev/a"],
        linkDescription: "YouTube (Untitled)",
      },
      {
        type: "apply-field-text",
        field: "description",
        text: "See https://aihero.dev/s/x and https://aihero.dev/s/done and https://aihero.dev/s/x",
      },
      {
        type: "show-toast",
        title: "Links converted",
        description: "Converted 1 aihero.dev URL to short links.",
      },
    ]);
  });
});
