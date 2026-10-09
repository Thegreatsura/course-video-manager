import { Effect } from "effect";
import { getValidAccessToken } from "@/services/youtube-auth-service";
import { findRecentUpload } from "@/services/youtube-upload-service";
import type { InterruptedPost, PostCheck } from "../job-kind";

/**
 * Did a cut-off YouTube post (an upload or a Short) go out? Read-only: looks
 * for an upload with its title among the channel's latest, published since
 * the run started. Never uploads anything.
 */
export const checkYouTubePost = (opts: {
  title: string;
  post: InterruptedPost;
  linkTo: (youtubeVideoId: string) => string;
}) =>
  Effect.gen(function* () {
    const accessToken = yield* getValidAccessToken;
    const found = yield* findRecentUpload({
      accessToken,
      title: opts.title,
      since: opts.post.startedAt,
    });
    return found
      ? ({
          verdict: "posted",
          detail: `It went out: YouTube has an upload titled "${opts.title}" (${found.videoId}) from this run.`,
          url: opts.linkTo(found.videoId),
        } satisfies PostCheck)
      : ({
          verdict: "not-posted",
          detail: `It did not go out: no upload titled "${opts.title}" among the channel's latest since this run started.`,
          url: null,
        } satisfies PostCheck);
  });
