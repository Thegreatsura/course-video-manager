import { Either, Schema } from "effect";

/**
 * Uploading a body's local images to Cloudinary, as both ends name it: the
 * tab enqueues an `upload-images` Job and reads its Job Events back
 * (`image-upload-reducer.ts`), and the Sidecar runs it
 * (`sidecar/kinds/upload-images.ts`).
 *
 * The rule that keeps every image: a local file is removed only once its
 * upload is confirmed, recorded as an `image-uploaded` Job Event, AND its
 * Cloudinary URL has been swapped into the body the author is looking at.
 * The upload Job never deletes anything. The tab swaps the URLs into the
 * CURRENT body (never a copy from when the Job started), and only then asks
 * for the files it swapped to go, as a `remove-local-images` Job.
 */
export const UPLOAD_IMAGES_JOB_KIND = "upload-images";
export const REMOVE_LOCAL_IMAGES_JOB_KIND = "remove-local-images";

/** One image is on Cloudinary, and recorded: `{ ref, filePath, url }`. */
export const IMAGE_UPLOADED_EVENT = "image-uploaded";

export const ImageUploaded = Schema.Struct({
  /** The reference as the body wrote it: `./diagram.png`. */
  ref: Schema.String,
  /** The file it named, resolved against the Video's folder. */
  filePath: Schema.String,
  url: Schema.String,
});
export type ImageUploaded = typeof ImageUploaded.Type;

/** `![alt](ref)`: the one shape of image a body may hold. */
const IMAGE_REGEX = /!\[([^\]]*)\]\(([^)]+)\)/g;

const isHosted = (ref: string) =>
  ref.startsWith("http://") || ref.startsWith("https://");

/** The local image references in `body`, each once, in order. */
export const localImageRefs = (body: string): string[] => [
  ...new Set(
    Array.from(body.matchAll(IMAGE_REGEX), (m) => m[2]!).filter(
      (ref) => !isHosted(ref)
    )
  ),
];

/** The `image-uploaded` events among a Job's events, decoded. */
export const imageUploadsOf = (
  events: ReadonlyArray<{ readonly type: string; readonly data: unknown }>
): ImageUploaded[] =>
  events.flatMap((event) => {
    if (event.type !== IMAGE_UPLOADED_EVENT) return [];
    const decoded = Schema.decodeUnknownEither(ImageUploaded)(event.data);
    return Either.isRight(decoded) ? [decoded.right] : [];
  });

/**
 * Swap each uploaded image's URL in for its local reference, in `body` as it
 * is now. Only an image's `(ref)` changes: its alt text and everything around
 * it stay byte for byte. A reference the author has since deleted is not put
 * back, and one already swapped is left alone, so swapping twice is a no-op.
 *
 * `swappedFilePaths` is every file whose URL went into the body: the only
 * files that may now be removed.
 */
export const swapImageUploads = (
  body: string,
  uploads: ReadonlyArray<ImageUploaded>
): { body: string; swappedFilePaths: string[] } => {
  const byRef = new Map(uploads.map((upload) => [upload.ref, upload]));
  const swapped = new Set<string>();
  const next = body.replace(IMAGE_REGEX, (whole, alt: string, ref: string) => {
    const upload = byRef.get(ref);
    if (!upload) return whole;
    swapped.add(upload.filePath);
    return `![${alt}](${upload.url})`;
  });
  return { body: next, swappedFilePaths: [...swapped] };
};
