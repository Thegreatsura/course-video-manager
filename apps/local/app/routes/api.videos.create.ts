import { Effect, Schema } from "effect";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { makeAction } from "@/services/route-action.server";
import { data, redirect } from "react-router";
import { DEFAULT_VIDEO_FORMAT } from "@/features/videos/video-format";
import { VIDEO_RECORDERS } from "@cvm/core/features/videos/recorder";

const createVideoSchema = Schema.Struct({
  title: Schema.String,
  format: Schema.optional(
    Schema.Union(Schema.Literal("landscape"), Schema.Literal("short"))
  ),
  redirectTo: Schema.optional(Schema.String),
  recorder: Schema.optional(
    Schema.Union(Schema.Literal(...VIDEO_RECORDERS), Schema.Literal(""))
  ),
});

export const action = makeAction({
  input: "formData",
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(createVideoSchema)(payload);

      const videoOps = yield* VideoOperationsService;

      const video = yield* videoOps.createStandaloneVideo({
        title: result.title,
        format: result.format ?? DEFAULT_VIDEO_FORMAT,
        recorder: result.recorder || null,
      });

      if (
        result.redirectTo &&
        result.redirectTo.startsWith("/") &&
        !result.redirectTo.includes("//")
      ) {
        return redirect(result.redirectTo.replace("{id}", video.id)) as never;
      }

      return data({ id: video.id });
    }),
});
