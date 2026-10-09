import { Config, Effect, Schema } from "effect";
import { FileSystem } from "@effect/platform";
import { VideoPostOperationsService } from "@/services/db-video-post-operations.server";
import { getValidAccessToken } from "@/services/youtube-auth-service";
import { uploadVideoToYouTube } from "@/services/youtube-upload-service";
import { definePostingJobKind } from "../job-kind";
import { reportPost } from "./post-events";
import { PostNotStartedError } from "./youtube";
import { checkYouTubePost } from "./youtube-post-check";

export const shortUrl = (youtubeVideoId: string) =>
  `https://youtube.com/shorts/${youtubeVideoId}`;

/**
 * **YouTube Shorts post** (#3 in docs/plans/background-jobs-sidecar.md): the
 * rendered vertical Short, uploaded public without notifying subscribers,
 * and recorded as a `video_post` — the same steps the `post-youtube-shorts`
 * route ran. A POSTING kind (decision 5): one attempt, never re-queued, and
 * only the author's Retry runs it again.
 */
export const youtubeShortsJobKind = definePostingJobKind({
  params: Schema.Struct({
    videoId: Schema.String,
    title: Schema.Trim.pipe(Schema.nonEmptyString()),
    description: Schema.Trim.pipe(Schema.nonEmptyString()),
  }),
  run: (params, ctx) =>
    Effect.gen(function* () {
      const finishedDir = yield* Config.string("FINISHED_VIDEOS_DIRECTORY");
      const fs = yield* FileSystem.FileSystem;
      const filePath = `${finishedDir}/${params.videoId}.mp4`;
      if (!(yield* fs.exists(filePath))) {
        return yield* new PostNotStartedError({
          message: "Exported vertical video not found. Export it first.",
        });
      }
      const videoPosts = yield* VideoPostOperationsService;
      const post = yield* videoPosts.createVideoPost({
        videoId: params.videoId,
        platform: "youtube-shorts",
      });
      const accessToken = yield* getValidAccessToken;

      const reports = yield* reportPost(ctx);
      reports.onStage("uploading");
      const uploaded = yield* uploadVideoToYouTube({
        accessToken,
        filePath,
        title: params.title,
        description: params.description,
        privacyStatus: "public",
        notifySubscribers: false,
        onProgress: (percent) => reports.onProgress("uploading", percent),
      }).pipe(
        Effect.tap((result) =>
          Effect.sync(() =>
            reports.posted({
              youtubeVideoId: result.videoId,
              url: shortUrl(result.videoId),
            })
          )
        ),
        Effect.ensuring(reports.flush)
      );
      const remoteUrl = shortUrl(uploaded.videoId);
      yield* videoPosts.updateRemoteInfo({
        id: post.id,
        remoteId: uploaded.videoId,
        remoteUrl,
      });
      yield* videoPosts.markPosted(post.id);
      yield* Effect.logInfo("youtube-shorts: done", { remoteUrl });
    }),
  checkPosted: (params, post) =>
    checkYouTubePost({ title: params.title, post, linkTo: shortUrl }),
});
