/**
 * The one model the Article Writer uses — document modes and chat modes alike.
 *
 * This was a user-facing dropdown with an "auto" setting that picked Haiku
 * before the first draft existed and Sonnet afterwards. That flip meant the
 * expensive first request warmed a cache on one model and every later request
 * read from another — so the cache was never once hit. One model, always.
 *
 * Bumping this needs an `@ai-sdk/anthropic` that knows the ID: the SDK caps an
 * unknown model's output at 4096 tokens, which truncates an article.
 */
export const ARTICLE_WRITER_MODEL = "claude-sonnet-5-5";
