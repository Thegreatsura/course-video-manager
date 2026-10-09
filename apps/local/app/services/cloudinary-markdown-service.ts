import { Effect } from "effect";
import { CloudinaryService, ImageUploadError } from "./cloudinary-service";
import fs from "node:fs";
import path from "node:path";
import {
  localImageRefs,
  type ImageUploaded,
} from "@/features/image-upload/image-upload-job";

/** What `uploadLocalImages` already knows, and how it records what it does. */
export interface UploadLocalImagesOptions<E> {
  /**
   * This Job's earlier runs' uploads: a reference here is done, and a file
   * here is never uploaded again.
   */
  readonly recorded: ReadonlyArray<ImageUploaded>;
  /**
   * Uploads an earlier Job recorded for the same Video, by file: used only
   * for a file that is no longer on disk (it was uploaded, then removed), so
   * a body that still names it gets its URL rather than a failure.
   */
  readonly recordedEarlier: ReadonlyMap<string, string>;
  /**
   * Record one image as uploaded — durably, before anything may act on it.
   * A failure here stops the run.
   */
  readonly record: (image: ImageUploaded) => Effect.Effect<void, E>;
}

export class CloudinaryMarkdownService extends Effect.Service<CloudinaryMarkdownService>()(
  "CloudinaryMarkdownService",
  {
    effect: Effect.gen(function* () {
      const cloudinary = yield* CloudinaryService;

      /**
       * Upload every local image `body` references, one at a time, and
       * `record` each. Never touches `body` and never deletes a file: the
       * tab swaps the URLs into the body as it is by then, and only a file
       * it swapped in is removed (`features/image-upload/image-upload-job.ts`).
       *
       * Safe to run again: a reference already recorded is skipped, and a
       * file already uploaded is not uploaded twice.
       */
      const uploadLocalImages = <E>(
        body: string,
        baseDir: string,
        options: UploadLocalImagesOptions<E>
      ) =>
        Effect.gen(function* () {
          const doneRefs = new Set(options.recorded.map((r) => r.ref));
          const urlByFile = new Map(
            options.recorded.map((r) => [r.filePath, r.url])
          );
          let uploaded = 0;

          for (const ref of localImageRefs(body)) {
            if (doneRefs.has(ref)) continue;
            const filePath = path.isAbsolute(ref)
              ? ref
              : path.resolve(baseDir, ref);

            let url = urlByFile.get(filePath);
            if (url === undefined && !fs.existsSync(filePath)) {
              url = options.recordedEarlier.get(filePath);
              if (url === undefined) {
                return yield* new ImageUploadError({
                  cause: null,
                  message: `Image file not found: ${filePath} (referenced as ${ref})`,
                  filePath,
                });
              }
            }
            if (url === undefined) {
              url = yield* cloudinary.upload(filePath);
              uploaded++;
            }

            yield* options.record({ ref, filePath, url });
            doneRefs.add(ref);
            urlByFile.set(filePath, url);
          }
          return { uploaded };
        });

      return { uploadLocalImages };
    }),
  }
) {}
