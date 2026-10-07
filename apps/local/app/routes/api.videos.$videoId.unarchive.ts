import { Effect } from "effect";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { makeAction } from "@/services/route-action.server";

/** The undo of /api/videos/delete: puts the Video back where it was. */
export const action = makeAction({
  errors: { NotFoundError: 404, VideoTitleTakenError: 409 },
  effect: ({ params }) =>
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      yield* videoOps.unarchiveVideo(params.videoId!);
      return { success: true };
    }),
});
