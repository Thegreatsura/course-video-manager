import { Effect } from "effect";
import {
  createClipService,
  type ClipService,
  type ClipServiceEvent,
} from "@/services/clip-service";
import {
  handleClipServiceEvent,
  type LoggerAdapter,
  type VideoProcessingAdapter,
} from "@/services/clip-service-handler";
import { noopLogger } from "@/services/clip-service-handler.helpers";
import type { Database } from "@/services/drizzle-service.server";

/**
 * Creates a ClipService that calls the handler directly with the provided
 * database instance. Used for testing with PGlite.
 *
 * @param db - Drizzle database instance
 * @param videoProcessing - VideoProcessingService adapter for OBS functionality
 */
export function createDirectClipService(
  db: Database,
  videoProcessing: VideoProcessingAdapter,
  logger?: LoggerAdapter
): ClipService {
  const send = (event: ClipServiceEvent): Promise<unknown> => {
    return Effect.runPromise(
      handleClipServiceEvent(db, event, videoProcessing, logger ?? noopLogger)
    );
  };

  return createClipService(send);
}
