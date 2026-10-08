/**
 * The models the Article Writer offers — document modes and chat modes alike.
 * Every model ID the writer can send lives here and nowhere else.
 *
 * The user picks one explicitly and it sticks. There is deliberately no "auto"
 * setting: an earlier picker flipped from Haiku to Sonnet once the first draft
 * existed, so the expensive first request warmed a cache on one model that
 * every later request read from another — the cache was never once hit.
 * Switching by hand still costs the cache once, which is the user's call.
 *
 * Adding a model needs an `@ai-sdk/anthropic` that knows the ID: the SDK caps
 * an unknown model's output at 4096 tokens, which truncates an article.
 */
export const ARTICLE_WRITER_MODELS = [
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { id: "claude-haiku-5-5", label: "Haiku 5.5" },
] as const;

export type ArticleWriterModel = (typeof ARTICLE_WRITER_MODELS)[number]["id"];

/** The default, and the fallback for anything not on the list. */
export const ARTICLE_WRITER_MODEL: ArticleWriterModel = "claude-sonnet-5-5";

export const ARTICLE_WRITER_MODEL_STORAGE_KEY = "article-writer-model";

export function isArticleWriterModel(
  value: unknown
): value is ArticleWriterModel {
  return ARTICLE_WRITER_MODELS.some((m) => m.id === value);
}

/**
 * The model to run, given whatever was saved or sent. A preference that names
 * a model no longer offered (or nothing at all) falls back to the default.
 */
export function resolveArticleWriterModel(value: unknown): ArticleWriterModel {
  return isArticleWriterModel(value) ? value : ARTICLE_WRITER_MODEL;
}
