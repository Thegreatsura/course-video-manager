import { Either, Schema } from "effect";

/**
 * Uploading a body's local images to Cloudinary, as both ends name it: the
 * tab enqueues an `upload-images` Job and reads its Job Events back
 * (`image-upload-reducer.ts`), and the Sidecar runs it
 * (`sidecar/kinds/upload-images.ts`).
 *
 * The rule that keeps every image: a local file is removed only once its
 * upload is confirmed, recorded as an `image-uploaded` Job Event, AND its
 * Cloudinary URL is in a body whose save is confirmed, and that saved body
 * no longer names the file in any form.
 * The upload Job never deletes anything. The tab swaps the URLs into the
 * CURRENT body (never a copy from when the Job started), saves it, and only
 * once that save is confirmed asks for the files the saved body no longer
 * names to go, as a `remove-local-images` Job.
 */
export const UPLOAD_IMAGES_JOB_KIND = "upload-images";
export const REMOVE_LOCAL_IMAGES_JOB_KIND = "remove-local-images";

/** Both kinds: no Upload Manager row, and a toast only on failure. */
export const isImageUploadJobKind = (kind: string) =>
  kind === UPLOAD_IMAGES_JOB_KIND || kind === REMOVE_LOCAL_IMAGES_JOB_KIND;

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
 * A reference in one canonical form, so every way of writing the same path
 * reads the same: `./a.png`, `a.png` and `img/../a.png` all read `a.png`.
 * A leading `..` that cannot be folded stays.
 */
export const normaliseImageRef = (ref: string): string => {
  const absolute = ref.startsWith("/");
  const segments: string[] = [];
  for (const segment of ref.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      const last = segments[segments.length - 1];
      if (last !== undefined && last !== "..") {
        segments.pop();
        continue;
      }
      if (absolute) continue;
    }
    segments.push(segment);
  }
  return (absolute ? "/" : "") + segments.join("/");
};

/**
 * Swap each uploaded image's URL in for its local reference, in `body` as it
 * is now. A reference matches an upload in any form that names the same file
 * (`./a.png` and `a.png`; an absolute path and the file it names). Only an
 * image's `(ref)` changes: its alt text and everything around it stay byte
 * for byte. A reference the author has since deleted is not put back, and
 * one already swapped is left alone, so swapping twice is a no-op.
 *
 * `swappedFilePaths` is every file whose URL went into the body: the only
 * files that may be removed, and only once that body is saved
 * (`filesSafeToRemove`).
 */
export const swapImageUploads = (
  body: string,
  uploads: ReadonlyArray<ImageUploaded>
): { body: string; swappedFilePaths: string[] } => {
  const byRef = new Map<string, ImageUploaded>();
  for (const upload of uploads) {
    byRef.set(normaliseImageRef(upload.ref), upload);
    byRef.set(normaliseImageRef(upload.filePath), upload);
  }
  const swapped = new Set<string>();
  const next = body.replace(IMAGE_REGEX, (whole, alt: string, ref: string) => {
    if (isHosted(ref)) return whole;
    const upload = byRef.get(normaliseImageRef(ref));
    if (!upload) return whole;
    swapped.add(upload.filePath);
    return `![${alt}](${upload.url})`;
  });
  return { body: next, swappedFilePaths: [...swapped] };
};

/**
 * Could `ref` name `filePath`? An absolute reference must be that file. A
 * relative one is resolved against a folder the tab does not know, so it
 * counts if the file's path ends with it: that errs towards keeping a file.
 */
const mayName = (ref: string, filePath: string): boolean => {
  const file = normaliseImageRef(filePath);
  const normalised = normaliseImageRef(ref);
  if (normalised.startsWith("/")) return normalised === file;
  const tail = normalised.replace(/^(\.\.\/)+/, "");
  return file === tail || file.endsWith(`/${tail}`);
};

/**
 * The files among `filePaths` that `savedBody` no longer names, in any form.
 * `savedBody` must be the body as confirmed saved: a file it still names, or
 * might name, stays on disk.
 */
export const filesSafeToRemove = (
  savedBody: string,
  filePaths: ReadonlyArray<string>
): string[] => {
  const refs = localImageRefs(savedBody);
  return filePaths.filter(
    (filePath) => !refs.some((ref) => mayName(ref, filePath))
  );
};
