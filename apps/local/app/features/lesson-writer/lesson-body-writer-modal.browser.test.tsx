import { fromPartial } from "@total-typescript/shoehorn";
import { userEvent } from "@vitest/browser/context";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { Toaster } from "@/components/ui/sonner";
import { UploadContext } from "@/features/upload-manager/upload-context";
import type { WriterContextData } from "@/services/video-posting-context.server";
import { LessonBodyWriterModal } from "./lesson-body-writer-modal";

/**
 * "More?": Apply saves the Body, then the writer moves on to the next Video
 * with an empty Lesson Body, remounted, so nothing of the last Video is left.
 * The server is stubbed at the network: the writer's data through the
 * router's loader, the save and the "find next" through fetch.
 */
const VIDEOS: Record<string, { title: string; body: string }> = {
  v1: { title: "Video One", body: "First video body" },
  v2: { title: "Video Two", body: "" },
};
const NEXT: Record<string, string | null> = { v1: "v2", v2: null };

function writerData(videoId: string) {
  const video = VIDEOS[videoId]!;
  return {
    body: video.body,
    description: null,
    writerContext: fromPartial<WriterContextData>({
      transcript: "",
      transcriptWordCount: 0,
      indexedClips: [],
      memory: "",
      repoId: null,
      fullPath: "",
      files: [],
      chapters: [],
      isStandalone: true,
      videoTitle: video.title,
      courseStructure: null,
      links: [],
      beats: [],
      script: "",
      animaticLines: [],
      diagramTexts: [],
      quizIds: [],
    }),
  };
}

const saves: Array<{ videoId: string; body: string }> = [];

beforeEach(() => {
  saves.length = 0;
  localStorage.clear();
  vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const save = url.match(/\/api\/videos\/(\w+)\/lesson-writer$/);
    if (save && init?.method === "POST") {
      const form = init.body as FormData;
      saves.push({ videoId: save[1]!, body: String(form.get("body")) });
      return Response.json({ ok: true });
    }
    const next = url.match(/\/api\/videos\/(\w+)\/next-video-needing-body$/);
    if (next) return Response.json({ nextVideoId: NEXT[next[1]!] ?? null });
    return new Response(null, { status: 404 });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const noJobs = fromPartial<React.ContextType<typeof UploadContext>>({
  jobs: fromPartial({ jobs: {} }),
  subscribeToJobEvents: () => () => {},
  startImageUpload: () => {},
  removeLocalImages: () => {},
});

function renderWriter(onOpenChange: (open: boolean) => void) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <UploadContext.Provider value={noJobs}>
            <Toaster />
            <LessonBodyWriterModal
              videoId="v1"
              open
              onOpenChange={onOpenChange}
            />
          </UploadContext.Provider>
        ),
      },
      {
        path: "/api/videos/:videoId/lesson-writer",
        loader: ({ params }) => writerData(params.videoId!),
      },
    ],
    { initialEntries: ["/"] }
  );
  return render(<RouterProvider router={router} />);
}

describe("LessonBodyWriterModal: More?", () => {
  it("applies, opens the next Video with an empty Lesson Body on fresh state, and closes when none is left", async () => {
    const onOpenChange = vi.fn();
    const screen = renderWriter(onOpenChange);

    await expect
      .element(screen.getByTestId("writer-modal-breadcrumb"))
      .toHaveTextContent("Video One");
    await expect.element(screen.getByText("First video body")).toBeVisible();

    // Leave something in this Video's writer that only its own state holds.
    const chatBox = screen.getByPlaceholder("What would you like to create?");
    await userEvent.fill(chatBox.element() as HTMLElement, "a draft for v1");

    await screen.getByRole("checkbox", { name: "More?" }).click();
    // Ctrl+Enter presses the same Apply as the button.
    await screen.getByTestId("writer-modal-breadcrumb").click();
    await userEvent.keyboard("{Control>}{Enter}{/Control}");

    // The Body was saved, and the writer moved on rather than closing.
    await expect
      .element(screen.getByTestId("writer-modal-breadcrumb"))
      .toHaveTextContent("Video Two");
    expect(saves).toEqual([{ videoId: "v1", body: "First video body" }]);
    expect(onOpenChange).not.toHaveBeenCalled();

    // Fresh state: neither v1's document nor its chat draft came along.
    expect(screen.getByText("First video body").query()).toBeNull();
    await expect
      .element(screen.getByPlaceholder("What would you like to create?"))
      .toHaveValue("");

    // Only "More?" carries over.
    await expect
      .element(screen.getByRole("checkbox", { name: "More?" }))
      .toBeChecked();

    // v2 is the last one: Apply saves it, then the writer closes and says so.
    await screen.getByRole("button", { name: /Apply/ }).click();
    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(saves.map((s) => s.videoId)).toEqual(["v1", "v2"]);
    await expect
      .element(screen.getByText("No more Videos with an empty Lesson Body"))
      .toBeVisible();
  });
});
