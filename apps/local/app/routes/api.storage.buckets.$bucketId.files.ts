import os from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { createSSEResponse } from "@/lib/create-sse-response.server";
import {
  streamStorageBucketFiles,
  windowsDirtyBitReader,
} from "@/packages/storage/scan";
import { DrizzleService } from "@/services/drizzle-service.server";
import { runtimeLive } from "@/services/layer.server";
import { storageRootsConfig } from "@/services/storage-roots";
import type { Route } from "./+types/api.storage.buckets.$bucketId.files";

/**
 * The per-bucket page's listing (#2108), streamed as
 * `StorageBucketFilesMessage`s, one SSE event each, named by its `type`. The
 * Storage page's walk, kept to one Storage Bucket. Read-only and never saved;
 * leaving the page closes the stream, which interrupts the walk.
 */
export const loader = ({ params }: Route.LoaderArgs) =>
  createSSEResponse({
    runtime: runtimeLive,
    program: (sendEvent) =>
      Effect.gen(function* () {
        const db = yield* DrizzleService;
        const roots = yield* storageRootsConfig;
        yield* streamStorageBucketFiles({
          db,
          roots,
          bucketId: params.bucketId,
          // Where exports are encoded before they reach finished-videos/.
          scratchDir: path.join(os.tmpdir(), "video-processing"),
          // Read-only: asks Windows whether each drive is Dirty.
          readDirtyBit: windowsDirtyBitReader,
          emit: (message) => sendEvent(message.type, message),
        });
      }),
    fallbackMessage: "Listing the Storage Bucket failed",
  });
