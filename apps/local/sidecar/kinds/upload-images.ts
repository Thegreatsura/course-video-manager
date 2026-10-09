import path from "node:path";
import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { CloudinaryMarkdownService } from "@/services/cloudinary-markdown-service";
import { getVideoFilePath } from "@/services/video-files";
import { removeUnderBestEffort } from "@/services/remove-best-effort";
import {
  IMAGE_UPLOADED_EVENT,
  UPLOAD_IMAGES_JOB_KIND,
  imageUploadsOf,
  localImageRefs,
} from "@/features/image-upload/image-upload-job";
import { defineJobKind } from "../job-kind";
import { JOB_PARAMS } from "../job-params";
import { IMAGE_UPLOAD_POLICY } from "../retry-policy";

/** Every image any `upload-images` Job recorded for this Video. */
const recordedForVideo = (videoId: string) =>
  Effect.flatMap(JobOperationsService, (ops) =>
    ops.listSubjectJobEvents({
      kind: UPLOAD_IMAGES_JOB_KIND,
      subjectType: "video",
      subjectId: videoId,
      type: IMAGE_UPLOADED_EVENT,
    })
  ).pipe(Effect.map(imageUploadsOf));

const videoFolder = (videoId: string) =>
  Effect.gen(function* () {
    const videoOps = yield* VideoOperationsService;
    const video = yield* videoOps.getVideoDeepById(videoId);
    return path.resolve(getVideoFilePath(video.lineageId));
  });

/**
 * **Image upload** (Cloudinary), enqueued by the Article Writer's Apply and
 * the Skills Changelog's "Upload Images": each local image the body names
 * goes to Cloudinary, one at a time, and is recorded as an `image-uploaded`
 * Job Event before the next starts. The tab hears those events and swaps the
 * URLs into the body as it is when the Job settles.
 *
 * It never writes the body and never deletes a file. A run put back by a
 * deliberate stop reads its own Job's `image-uploaded` events first and
 * uploads only what no earlier run recorded. 1 attempt, in the default lane
 * (`IMAGE_UPLOAD_POLICY`).
 */
export const uploadImagesJobKind = defineJobKind({
  ...IMAGE_UPLOAD_POLICY,
  params: JOB_PARAMS["upload-images"],
  run: (params, ctx) =>
    Effect.gen(function* () {
      const ops = yield* JobOperationsService;
      const markdown = yield* CloudinaryMarkdownService;
      const recorded = imageUploadsOf(yield* ops.listJobEvents(ctx.jobId));
      const recordedEarlier = new Map(
        (yield* recordedForVideo(params.videoId)).map((u) => [
          u.filePath,
          u.url,
        ])
      );
      const baseDir = yield* videoFolder(params.videoId);
      const total = localImageRefs(params.body).length;
      let done = recorded.length;
      yield* Effect.logInfo("upload-images: started", {
        images: total,
        alreadyRecorded: recorded.length,
      });
      const { uploaded } = yield* markdown.uploadLocalImages(
        params.body,
        baseDir,
        {
          recorded,
          recordedEarlier,
          // Straight to the table, so a failed write fails the run: nothing
          // may act on an upload that was not recorded. `progress` then wakes
          // the feed, so the tab hears it now.
          record: (image) =>
            ops
              .appendJobEvent({
                jobId: ctx.jobId,
                type: IMAGE_UPLOADED_EVENT,
                data: { ...image },
              })
              .pipe(
                Effect.zipRight(
                  Effect.suspend(() => {
                    done++;
                    return ctx.emit("progress", {
                      stage: "uploading",
                      percent: Math.round((done / Math.max(total, 1)) * 100),
                    });
                  })
                )
              ),
        }
      );
      yield* Effect.logInfo("upload-images: done", { uploaded });
    }),
});

/**
 * Remove local image files the tab has swapped Cloudinary URLs in for. A
 * file is removed only if an `upload-images` Job recorded it for this Video,
 * and only inside the Video's folder (`removeUnderBestEffort`); any other is
 * left alone with a warning. A file already gone is the goal reached, so a
 * second run is harmless.
 */
export const removeLocalImagesJobKind = defineJobKind({
  ...IMAGE_UPLOAD_POLICY,
  params: JOB_PARAMS["remove-local-images"],
  run: (params) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const uploaded = new Set(
        (yield* recordedForVideo(params.videoId)).map((u) => u.filePath)
      );
      const baseDir = yield* videoFolder(params.videoId);
      for (const filePath of params.filePaths) {
        if (!uploaded.has(filePath)) {
          yield* Effect.logWarning(
            "remove-local-images: not removing a file no upload recorded",
            { filePath }
          );
          continue;
        }
        yield* removeUnderBestEffort(fs, baseDir, filePath);
      }
      yield* Effect.logInfo("remove-local-images: done", {
        files: params.filePaths.length,
      });
    }),
});
