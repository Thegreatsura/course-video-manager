import { Data, Effect } from "effect";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";

export class CloudinaryUrlNotSetError extends Data.TaggedError(
  "CloudinaryUrlNotSetError"
)<{
  message: string;
}> {}

export class CouldNotParseCloudinaryUrlError extends Data.TaggedError(
  "CouldNotParseCloudinaryUrlError"
)<{
  message: string;
  url: string;
}> {}

export class ImageUploadError extends Data.TaggedError("ImageUploadError")<{
  cause: unknown;
  message: string;
  filePath: string;
}> {}

export class CloudinaryService extends Effect.Service<CloudinaryService>()(
  "CloudinaryService",
  {
    effect: Effect.gen(function* () {
      const configure = Effect.gen(function* () {
        const cloudinaryUrl = process.env.CLOUDINARY_URL;
        if (!cloudinaryUrl) {
          return yield* new CloudinaryUrlNotSetError({
            message:
              "CLOUDINARY_URL is not set in environment variables. Format: cloudinary://<api-key>:<api-secret>@<cloud-name>",
          });
        }

        // The cloud name ends at a query string: the SDK reads options such
        // as `upload_prefix` from CLOUDINARY_URL's query itself (a
        // verify-cvm clone points it at a loopback stub that way).
        const match = cloudinaryUrl.match(
          /cloudinary:\/\/([^:]+):([^@]+)@([^?/]+)/
        );
        if (!match) {
          return yield* new CouldNotParseCloudinaryUrlError({
            message: `Could not parse CLOUDINARY_URL. Expected format: cloudinary://<api-key>:<api-secret>@<cloud-name>`,
            url: cloudinaryUrl,
          });
        }

        const [, apiKey, apiSecret, cloudName] = match;

        cloudinary.config({
          cloud_name: cloudName,
          api_key: apiKey,
          api_secret: apiSecret,
        });
      });

      /**
       * Upload one file. Its public id is a hash of its bytes, and an asset
       * already there is never overwritten, so uploading the same image again
       * (a run cut off after Cloudinary answered but before the upload was
       * recorded) lands on the same asset rather than a second one.
       */
      const upload = Effect.fn("upload")(function* (filePath: string) {
        yield* configure;

        const result = yield* Effect.tryPromise({
          try: async () => {
            const bytes = await readFile(filePath);
            const publicId = createHash("sha256")
              .update(bytes)
              .digest("hex")
              .slice(0, 32);
            return (await cloudinary.uploader.upload(filePath, {
              resource_type: "auto",
              folder: "ai-hero-images",
              public_id: publicId,
              overwrite: false,
            })) as UploadApiResponse;
          },
          catch: (e) =>
            new ImageUploadError({
              cause: e,
              message: `Failed to upload ${filePath} to Cloudinary: ${e}`,
              filePath,
            }),
        });

        return result.secure_url;
      });

      return { upload };
    }),
  }
) {}
