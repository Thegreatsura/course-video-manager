import { describe, expect, it } from "vitest";
import {
  ARTICLE_WRITER_MODEL,
  ARTICLE_WRITER_MODELS,
  resolveArticleWriterModel,
} from "./article-writer-model";

describe("resolveArticleWriterModel", () => {
  it("offers exactly Sonnet 5.5 and Haiku 5.5, defaulting to Sonnet", () => {
    expect(ARTICLE_WRITER_MODELS.map((m) => m.id)).toEqual([
      "claude-sonnet-5-5",
      "claude-haiku-5-5",
    ]);
    expect(ARTICLE_WRITER_MODEL).toBe("claude-sonnet-5-5");
  });

  it("keeps an offered model", () => {
    expect(resolveArticleWriterModel("claude-haiku-5-5")).toBe(
      "claude-haiku-5-5"
    );
  });

  it.each([
    ["a removed model", "claude-haiku-4-5"],
    ["the old auto setting", "auto"],
    ["nothing saved", null],
    ["nothing sent", undefined],
  ])("falls back to the default for %s", (_, value) => {
    expect(resolveArticleWriterModel(value)).toBe(ARTICLE_WRITER_MODEL);
  });
});
