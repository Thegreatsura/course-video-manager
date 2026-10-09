import { FileSystem } from "@effect/platform";
import { Data, Effect, Config } from "effect";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

export class ObjectStoreError extends Data.TaggedError("ObjectStoreError")<{
  message: string;
}> {}

const createObjectStoreOperations = (opts: {
  bucket: string;
  region: string;
  /** A local stand-in for S3 (`S3_ENDPOINT`), path-style; `null` for AWS. */
  endpoint: string | null;
}) => {
  const client = new S3Client({
    region: opts.region,
    ...(opts.endpoint ? { endpoint: opts.endpoint, forcePathStyle: true } : {}),
  });

  return {
    upload: (uploadOpts: {
      pathname: string;
      filePath: string;
      onProgress?: (percentage: number) => void;
    }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;

        yield* fs.stat(uploadOpts.filePath).pipe(
          Effect.mapError(
            () =>
              new ObjectStoreError({
                message: `File not found: ${uploadOpts.filePath}`,
              })
          )
        );

        uploadOpts.onProgress?.(0);

        const fileContent = yield* fs.readFile(uploadOpts.filePath).pipe(
          Effect.mapError(
            () =>
              new ObjectStoreError({
                message: `Failed to read file: ${uploadOpts.filePath}`,
              })
          )
        );

        yield* Effect.tryPromise({
          try: (signal) =>
            client.send(
              new PutObjectCommand({
                Bucket: opts.bucket,
                Key: uploadOpts.pathname,
                Body: fileContent,
                ContentType: "video/mp4",
              }),
              { abortSignal: signal }
            ),
          catch: (e) =>
            new ObjectStoreError({
              message: e instanceof Error ? e.message : String(e),
            }),
        });

        uploadOpts.onProgress?.(100);

        const url = opts.endpoint
          ? `${opts.endpoint}/${opts.bucket}/${uploadOpts.pathname}`
          : `https://${opts.bucket}.s3.${opts.region}.amazonaws.com/${uploadOpts.pathname}`;
        return { url };
      }),
  };
};

export class ObjectStoreService extends Effect.Service<ObjectStoreService>()(
  "ObjectStoreService",
  {
    effect: Effect.gen(function* () {
      const bucket = yield* Config.string("S3_BUCKET");
      const region = yield* Config.string("AWS_REGION");
      // Overridable so a verification run uploads to a local stub; nothing
      // sets it day to day. verify-cvm defaults it to a dead port.
      const endpoint = yield* Config.string("S3_ENDPOINT").pipe(
        Config.option,
        Config.map((o) =>
          o._tag === "Some" ? o.value.replace(/\/+$/, "") : null
        )
      );
      return createObjectStoreOperations({ bucket, region, endpoint });
    }),
    dependencies: [],
  }
) {}
