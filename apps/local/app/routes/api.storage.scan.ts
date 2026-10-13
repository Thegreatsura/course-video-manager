import os from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { createSSEResponse } from "@/lib/create-sse-response.server";
import { streamStorageScan } from "@/packages/storage/scan";
import { DrizzleService } from "@/services/drizzle-service.server";
import { runtimeLive } from "@/services/layer.server";
import { storageRootsConfig } from "@/services/storage-roots";

/**
 * The Storage page's scan (#2107), streamed as `StorageScanMessage`s, one SSE
 * event each, named by its `type`. Counted fresh on every visit; nothing is
 * saved. Leaving the page closes the stream, which interrupts the walk.
 */
export const loader = () =>
  createSSEResponse({
    runtime: runtimeLive,
    program: (sendEvent) =>
      Effect.gen(function* () {
        const db = yield* DrizzleService;
        const roots = yield* storageRootsConfig;
        yield* streamStorageScan({
          db,
          roots,
          // Where exports are encoded before they reach finished-videos/.
          scratchDir: path.join(os.tmpdir(), "video-processing"),
          emit: (message) => sendEvent(message.type, message),
        });
      }),
    fallbackMessage: "The storage scan failed",
  });
