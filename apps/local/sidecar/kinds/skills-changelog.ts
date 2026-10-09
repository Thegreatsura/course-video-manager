import { Effect } from "effect";
import { JOB_PARAMS } from "../job-params";
import { CoursePublishService } from "@/services/course-publish-service";
import { postSkillsChangelogToAiHero } from "@/services/ai-hero-upload-service";
import { definePostingJobKind, type PostCheck } from "../job-kind";
import { reportPost } from "./post-events";
import { PostNotStartedError } from "./youtube";

/**
 * **Skills Changelog post** (#5 in docs/plans/background-jobs-sidecar.md):
 * published on AI Hero with its Kit newsletter draft — the same
 * `postSkillsChangelogToAiHero` the `post-skills-changelog` route ran. A
 * POSTING kind (decision 5): one attempt, never re-queued, and only the
 * author's Retry runs it again.
 */
export const skillsChangelogJobKind = definePostingJobKind({
  params: JOB_PARAMS["skills-changelog"],
  run: (params, ctx) =>
    Effect.gen(function* () {
      const publish = yield* CoursePublishService;
      const filePath = yield* publish.resolveExportPath(params.videoId);
      if (!filePath) {
        return yield* new PostNotStartedError({
          message: "Video has not been exported",
        });
      }
      const reports = yield* reportPost(ctx);
      const result = yield* postSkillsChangelogToAiHero({
        filePath,
        title: params.title,
        slug: params.slug,
        body: params.body,
        description: params.description.trim(),
        newsletterSubject: params.newsletterSubject,
        newsletterPreviewText: params.newsletterPreviewText.trim(),
        newsletterCopy: params.newsletterCopy,
        onProgress: (percent) => reports.onProgress("uploading", percent),
      }).pipe(
        Effect.tap((r) =>
          Effect.sync(() =>
            reports.posted({
              slug: r.slug,
              url: `https://www.aihero.dev/skills/${r.slug}`,
            })
          )
        ),
        Effect.ensuring(reports.flush)
      );
      yield* Effect.logInfo("skills-changelog: published", {
        slug: result.slug,
      });
    }),
  /**
   * AI Hero picks a changelog's final slug itself, so there is nothing safe
   * to look it up by: say so, rather than guess.
   */
  checkPosted: () =>
    Effect.succeed({
      verdict: "unknown",
      detail:
        "AI Hero picks a Skills Changelog's slug itself, so the CVM cannot look it up: check aihero.dev/skills and Kit before retrying.",
      url: "https://www.aihero.dev/skills",
    } satisfies PostCheck),
});
