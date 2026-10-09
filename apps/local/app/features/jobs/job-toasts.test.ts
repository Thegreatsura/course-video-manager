import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "@/components/ui/toast";
import { showJobSucceededToast } from "./job-toasts";
import type { SucceededToast } from "./job-succeeded-toast";

vi.mock("@/components/ui/toast", () => ({
  toast: {
    success: vi.fn(),
  },
}));

interface Button {
  label: string;
  onClick: () => void;
}
interface Options {
  duration: number;
  action?: Button;
  cancel?: Button;
}

const show = (decided: SucceededToast, title = "Test Video") => {
  showJobSucceededToast({
    type: "show-job-succeeded-toast",
    jobId: "job-1",
    title,
    toast: decided,
  });
  const call = vi.mocked(toast.success).mock.calls[0]!;
  return { headline: call[0], options: call[1] as Options };
};

describe("showJobSucceededToast", () => {
  const location = { href: "" };

  beforeEach(() => {
    vi.clearAllMocks();
    location.href = "";
    vi.stubGlobal("window", { location, open: vi.fn() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("youtube", () => {
    it("copies the YouTube Studio link, and goes to the Post", () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("navigator", { clipboard: { writeText } });

      const { headline, options } = show({
        shape: "youtube",
        videoId: "v1",
        youtubeVideoId: "yt-123",
      });

      expect(headline).toBe('"Test Video" uploaded to YouTube');
      expect(options.duration).toBe(Infinity);
      expect(options.action!.label).toBe("Copy YouTube Studio Link");
      options.action!.onClick();
      expect(writeText).toHaveBeenCalledWith(
        "https://studio.youtube.com/video/yt-123/edit"
      );
      expect(options.cancel!.label).toBe("Go to Post");
      options.cancel!.onClick();
      expect(location.href).toBe("/videos/v1/post");
    });

    it("omits the copy action when youtubeVideoId is null", () => {
      const { options } = show({
        shape: "youtube",
        videoId: "v1",
        youtubeVideoId: null,
      });
      expect(options.action).toBeUndefined();
    });
  });

  it("youtube-shorts: opens the Short on YouTube", () => {
    const { headline, options } = show({
      shape: "youtube-shorts",
      youtubeVideoId: "yt-9",
    });
    expect(headline).toBe('"Test Video" posted as YouTube Short');
    expect(options.action!.label).toBe("Open on YouTube");
    options.action!.onClick();
    expect(window.open).toHaveBeenCalledWith(
      "https://youtube.com/shorts/yt-9",
      "_blank"
    );
  });

  it("buffer: goes to the Post", () => {
    const { headline, options } = show({ shape: "buffer", videoId: "v1" });
    expect(headline).toBe('"Test Video" sent to Buffer');
    expect(options.cancel!.label).toBe("Go to Post");
    options.cancel!.onClick();
    expect(location.href).toBe("/videos/v1/post");
  });

  describe("posts that save a global link", () => {
    const fetchMock = vi.fn();
    beforeEach(() => {
      fetchMock.mockReset().mockResolvedValue(new Response(null));
      vi.stubGlobal("fetch", fetchMock);
    });

    const linkPosted = () => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0]!;
      const body = (init as RequestInit).body as FormData;
      return { url, title: body.get("title"), link: body.get("url") };
    };

    it("ai-hero: goes to AI Hero, and saves the post's link", () => {
      const { headline, options } = show({
        shape: "ai-hero",
        videoId: "v1",
        slug: "intro",
      });
      expect(headline).toBe('"Test Video" posted to AI Hero');
      expect(options.cancel!.label).toBe("Go to AI Hero");
      options.cancel!.onClick();
      expect(location.href).toBe("/videos/v1/ai-hero");
      expect(linkPosted()).toEqual({
        url: "/api/links",
        title: "Test Video",
        link: "https://aihero.dev/intro",
      });
    });

    it("skills-changelog: goes to the Skills Changelog, and saves its link", () => {
      const { headline, options } = show({
        shape: "skills-changelog",
        videoId: "v1",
        slug: "v1-2",
      });
      expect(headline).toBe('"Test Video" published as Skills Changelog');
      expect(options.cancel!.label).toBe("Go to Skills Changelog");
      options.cancel!.onClick();
      expect(location.href).toBe("/videos/v1/skills-changelog");
      expect(linkPosted()).toEqual({
        url: "/api/links",
        title: "Test Video",
        link: "https://www.aihero.dev/skills/v1-2",
      });
    });

    it("saves no link without a slug", () => {
      show({ shape: "ai-hero", videoId: "v1", slug: null });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("autofill: '<title> finished', back to the publish page", () => {
    const { headline, options } = show(
      { shape: "autofill", courseId: "c1" },
      "Autofill Generics"
    );
    expect(headline).toBe("Autofill Generics finished");
    expect(options.action!.label).toBe("Back to Publish");
    options.action!.onClick();
    expect(location.href).toBe("/courses/c1/publish");
  });

  describe("publish", () => {
    it("goes to the new Draft", () => {
      const { headline, options } = show(
        { shape: "publish", courseId: "c1", newDraftVersionId: "ver-2" },
        "Generics"
      );
      expect(headline).toBe('"Generics" published successfully');
      expect(options.action!.label).toBe("Go to Draft");
      options.action!.onClick();
      expect(location.href).toBe("/courses/c1?versionId=ver-2");
    });

    it("has no button without a new Draft", () => {
      const { options } = show({
        shape: "publish",
        courseId: "c1",
        newDraftVersionId: null,
      });
      expect(options.action).toBeUndefined();
    });
  });

  describe("generic", () => {
    it("an export: Open reveals the file", () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(null));
      vi.stubGlobal("fetch", fetchMock);
      const { headline, options } = show({
        shape: "generic",
        did: "exported successfully",
        revealVideoId: "v1",
      });
      expect(headline).toBe('"Test Video" exported successfully');
      expect(options.cancel!.label).toBe("Open");
      options.cancel!.onClick();
      expect(fetchMock).toHaveBeenCalledWith("/api/videos/v1/reveal", {
        method: "POST",
      });
    });

    it("anything else: its headline, no button", () => {
      const { headline, options } = show({
        shape: "generic",
        did: "finished",
        revealVideoId: null,
      });
      expect(headline).toBe('"Test Video" finished');
      expect(options.cancel).toBeUndefined();
      expect(options.action).toBeUndefined();
    });
  });
});
