import { Effect } from "effect";
import { makeLoader } from "@/services/route-action.server";
import { VideoEditorLoggerService } from "@/services/video-editor-logger-service";
import path from "node:path";

export const loader = makeLoader({
  effect: ({ params }) => {
    const videoId = params.videoId!;

    return Effect.gen(function* () {
      const logger = yield* VideoEditorLoggerService;
      const logPath = logger.getLogPath(videoId);
      const absolutePath = path.resolve(logPath);
      return new Response(absolutePath, {
        headers: { "Content-Type": "text/plain" },
      });
    });
  },
});
