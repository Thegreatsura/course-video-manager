import { describe, expect, it } from "vitest";
import { formatVideoBreadcrumb } from "./video-breadcrumb";

describe("formatVideoBreadcrumb", () => {
  it("joins section, lesson and video for a lesson video", () => {
    expect(
      formatVideoBreadcrumb({
        isStandalone: false,
        sectionPath: "01-intro",
        lessonPath: "01.02-setup",
        videoTitle: "Problem",
      })
    ).toBe("01-intro/01.02-setup/Problem");
  });

  it("is just the title for a standalone video", () => {
    expect(
      formatVideoBreadcrumb({
        isStandalone: true,
        sectionPath: "",
        lessonPath: "",
        videoTitle: "Solo",
      })
    ).toBe("Solo");
  });
});
