import { Effect } from "effect";
import { createSSEResponse } from "@/lib/create-sse-response.server";
import {
  streamStorageScan,
  windowsDirtyBitReader,
} from "@/packages/storage/scan";
import { DrizzleService } from "@/services/drizzle-service.server";
import { runtimeLive } from "@/services/layer.server";
import {
  exportScratchDirectory,
  storageRootsConfig,
} from "@/services/storage-roots";

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
          scratchDir: exportScratchDirectory(),
          // Read-only: asks Windows whether each drive is Dirty.
          readDirtyBit: windowsDirtyBitReader,
          emit: (message) => sendEvent(message.type, message),
        });
      }),
    fallbackMessage: "The storage scan failed",
  });
